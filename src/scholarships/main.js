import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/scholarships.css';

import { dataStore, SHARED_MODE } from './data-store.js';
import { studentStore, criterionState, eligibility, TRACKER_STAGES } from './student-store.js';
import { getStatus, describeTiming, maxAmount, hasDates, formatDate, todayISO, daysBetween } from './status.js';
import { openEditor, CATEGORIES, BASES } from './editor-form.js';
import { buildIcs, downloadFile } from './ics.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { SEED_SCHOLARSHIPS } from './seed-data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = import.meta.env.BASE_URL;

// ---------- view state (tab/filter remembered per viewer) ----------
const VIEW_KEY = 'ncsuAgScholarships.view.v1';
const view = (() => {
  const d = { tab: 'active', q: '', category: 'all', basis: 'all', sort: 'deadline', studentsOnly: false, eligibleOnly: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'), q: '' }; } catch { return d; }
})();
function saveView() { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* ignore */ } }
const openCards = new Set();

// ---------- shell ----------
const app = document.getElementById('app');
app.innerHTML = `
  <header>
    <div class="nc-university-bar">
      <strong>NC State University</strong>
      <span>Unofficial student resource</span>
    </div>
    <div class="brand-header">
      <div class="brand-header-inner">
        <div class="header-brand">
          <img class="brand-badge" src="${BASE}nc-state-abm-badge.png" alt="NC State Agribusiness Management badge" />
          <div>
            <h1 class="brand-title"><span class="brand-title-main">Scholarships &amp; Grants</span></h1>
            <div class="brand-subtitle">College of Agriculture &amp; Life Sciences · NC State University · Funding Dashboard</div>
          </div>
        </div>
        <div class="credit-summary" id="sch-summary"></div>
      </div>
    </div>
    <div class="toolbar sch-toolbar" id="sch-toolbar"></div>
  </header>
  <main class="sch-main">
    <div id="sch-banner"></div>
    <div class="sch-tabs" role="tablist" id="sch-tabs"></div>
    <div id="sch-results-meta" class="sch-results-meta" aria-live="polite"></div>
    <div id="sch-grid" class="sch-grid"></div>
    <footer class="sch-footer">
      <p>Unofficial tool. Always confirm amounts, eligibility and deadlines on the sponsor's page before applying.
      Your checklist, profile, saved list and notes stay in this browser only.</p>
      <p id="sch-editor-foot"></p>
    </footer>
  </main>`;

const $ = (id) => document.getElementById(id);

// ---------- derived data ----------
function withStatus() {
  const today = todayISO();
  return dataStore.state.list.map((s) => ({ s, status: getStatus(s, today) }));
}

function filtered(tab = view.tab) {
  const q = view.q.trim().toLowerCase();
  let rows = withStatus().filter(({ s, status }) => {
    if (tab === 'saved') { if (!studentStore.state.saved[s.id]) return false; }
    else if (tab !== 'all' && status !== tab) return false;
    if (view.category !== 'all' && s.category !== view.category) return false;
    if (view.basis !== 'all' && !(s.basis || []).includes(view.basis)) return false;
    if (view.studentsOnly && s.audience === 'institution') return false;
    if (view.eligibleOnly && eligibility(s).level === 'ineligible') return false;
    if (q) {
      const hay = [s.name, s.sponsor, s.notes, s.amountText, ...(s.criteria || []).map((c) => c.text)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Active (soonest deadline) → upcoming (soonest opening, TBA last) → passed (most recent first).
  // Plain code-unit comparison, not localeCompare: collation would reorder the '~' / digit prefixes.
  const RANK = { active: '0', upcoming: '1', passed: '2' };
  const dateKey = ({ s, status }) => {
    if (status === 'active') return RANK.active + (s.deadline || '9999');
    if (status === 'upcoming') return RANK.upcoming + (s.opens || s.deadline || '9999');
    return RANK.passed + (s.deadline ? invert(s.deadline) : '9999');
  };
  const cmp = {
    deadline: (a, b) => { const x = dateKey(a); const y = dateKey(b); return x < y ? -1 : x > y ? 1 : 0; },
    amount: (a, b) => maxAmount(b.s) - maxAmount(a.s),
    name: (a, b) => a.s.name.localeCompare(b.s.name),
    fit: (a, b) => fitScore(b.s) - fitScore(a.s),
  }[view.sort] || (() => 0);
  return rows.sort((a, b) => cmp(a, b) || a.s.name.localeCompare(b.s.name));
}
const invert = (iso) => iso.replace(/\d/g, (d) => String(9 - Number(d)));
function fitScore(s) {
  const e = eligibility(s);
  return ({ eligible: 3, partial: 2, unknown: 1, ineligible: 0 }[e.level]) + (e.total ? e.met / e.total : 0) / 2;
}

// ---------- summary + tabs ----------
function renderSummary() {
  const today = todayISO();
  const rows = withStatus();
  const active = rows.filter((r) => r.status === 'active');
  const closingSoon = active.filter((r) => r.s.deadline && daysBetween(today, r.s.deadline) <= 30).length;
  const likely = rows.filter((r) => r.status !== 'passed' && eligibility(r.s).level === 'eligible').length;
  const saved = Object.keys(studentStore.state.saved).filter((id) => rows.some((r) => r.s.id === id)).length;
  $('sch-summary').innerHTML = [
    ['Open now', active.length, ''],
    ['Due ≤ 30 days', closingSoon, closingSoon ? 'warning' : ''],
    ['You qualify', likely, 'transferred'],
    ['Saved', saved, ''],
  ].map(([l, v, c]) => `<div class="credit-box"><div class="cb-label">${l}</div><div class="cb-value ${c}">${v}</div></div>`).join('');

  const counts = { active: 0, upcoming: 0, passed: 0 };
  rows.forEach((r) => { counts[r.status] += 1; });
  const tabs = [
    ['active', 'Active', counts.active],
    ['upcoming', 'Upcoming', counts.upcoming],
    ['passed', 'Passed', counts.passed],
    ['all', 'All', rows.length],
    ['saved', '★ Saved', saved],
  ];
  $('sch-tabs').innerHTML = tabs.map(([id, label, n]) => `
    <button type="button" role="tab" class="sch-tab ${view.tab === id ? 'is-active' : ''}" aria-selected="${view.tab === id}" data-tab="${id}">
      ${label}<span class="sch-tab-count">${n}</span>
    </button>`).join('');
}

// ---------- toolbar ----------
function renderToolbar() {
  const ds = dataStore.state;
  const sel = (name, opts, cur) => `<select data-view="${name}" aria-label="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  $('sch-toolbar').innerHTML = `
    <input type="search" class="sch-search" data-view="q" placeholder="Search scholarships, sponsors, requirements…" value="${esc(view.q)}" aria-label="Search" />
    ${sel('category', [['all', 'All categories'], ...CATEGORIES.map((c) => [c.id, c.label])], view.category)}
    ${sel('basis', [['all', 'Any basis'], ...BASES.map((b) => [b.id, b.label])], view.basis)}
    ${sel('sort', [['deadline', 'Sort: deadline'], ['amount', 'Sort: amount'], ['fit', 'Sort: best fit'], ['name', 'Sort: A–Z']], view.sort)}
    <label class="sch-toggle"><input type="checkbox" data-view="studentsOnly" ${view.studentsOnly ? 'checked' : ''} /> Hide institution grants</label>
    <label class="sch-toggle"><input type="checkbox" data-view="eligibleOnly" ${view.eligibleOnly ? 'checked' : ''} /> Hide ones I don't qualify for</label>
    <span class="toolbar-spacer"></span>
    <button type="button" class="btn" data-act="profile">My profile</button>
    <button type="button" class="btn" data-act="ics" title="Download deadlines for the scholarships shown">📅 Add to calendar</button>
    ${ds.isEditor ? `
      <button type="button" class="btn btn-primary" data-act="add">+ Add scholarship</button>
      <details class="toolbar-menu">
        <summary class="btn">Editor ▾</summary>
        <div class="toolbar-menu-panel sch-menu-right">
          <button type="button" class="btn btn-menu" data-act="export">Export list (JSON)</button>
          <button type="button" class="btn btn-menu" data-act="import">Import list (JSON)…</button>
          ${SHARED_MODE ? `<button type="button" class="btn btn-menu" data-act="publish-seed">Publish starter list</button>` : `<button type="button" class="btn btn-menu btn-menu-danger" data-act="reset-local">Discard local edits</button>`}
          <button type="button" class="btn btn-menu" data-act="signout">Leave editor mode</button>
        </div>
      </details>` : ''}`;
}

function renderBanner() {
  const ds = dataStore.state;
  const parts = [];
  if (ds.error) parts.push(`<div class="panel panel-warn">${esc(ds.error)}</div>`);
  if (ds.isEditor && !SHARED_MODE) {
    parts.push(`<div class="panel panel-warn"><strong>Local editor mode.</strong> Shared editing isn't connected yet, so changes save to this browser only.
      Use <em>Editor ▾ → Export list</em> to hand changes off, or connect Supabase (see <code>supabase/README.md</code>) so everyone with access edits one shared list.</div>`);
  }
  if (ds.isEditor && SHARED_MODE && ds.remoteEmpty) {
    parts.push(`<div class="panel panel-info">The shared list is empty, so students currently see the built-in starter list. Use <em>Editor ▾ → Publish starter list</em> to copy it into the shared database.</div>`);
  }
  if (SHARED_MODE && ds.user && !ds.isEditor) {
    parts.push(`<div class="panel panel-warn">Signed in as ${esc(ds.user.email)}, but this address isn't on the editor list. Ask an existing editor to add you. <button type="button" class="btn" data-act="signout">Sign out</button></div>`);
  }
  $('sch-banner').innerHTML = parts.join('');

  $('sch-editor-foot').innerHTML = ds.isEditor
    ? `Editing as ${esc(ds.user?.email || 'local draft')}.`
    : `<button type="button" class="linklike" data-act="signin">Editor sign-in</button> — for staff and students with access to maintain this list.`;
}

// ---------- cards ----------
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
const BASIS_LABEL = Object.fromEntries(BASES.map((b) => [b.id, b.label]));
const ELIG_LABEL = {
  eligible: 'You meet all required criteria',
  partial: 'Partly checked',
  ineligible: "Profile says you don't meet a requirement",
  unknown: 'Check off what applies to you',
};

function cardHtml(s, status) {
  const st = studentStore.state;
  const timing = describeTiming(s);
  const e = eligibility(s);
  const pct = e.total ? Math.round((e.met / e.total) * 100) : 0;
  const open = openCards.has(s.id);
  const stage = st.tracker[s.id] || 'none';
  const saved = Boolean(st.saved[s.id]);
  const isEditor = dataStore.state.isEditor;

  const crit = (s.criteria || []).map((c) => {
    const cs = criterionState(s, c);
    const cbId = `cb-${s.id}-${c.id}`;
    return `<li class="crit ${cs.checked ? 'is-met' : ''}">
      <input type="checkbox" id="${cbId}" data-crit="${esc(c.id)}" ${cs.checked ? 'checked' : ''} />
      <label for="${cbId}">${esc(c.text)}${c.required ? '' : ' <span class="crit-pref">preferred</span>'}</label>
      ${cs.source === 'profile' ? `<span class="crit-src" title="Filled from My profile — tick or untick to override">${cs.checked ? 'from profile' : 'profile: not met'}</span>` : ''}
    </li>`;
  }).join('');

  return `
  <article class="sch-card status-${status} elig-${e.level} ${saved ? 'is-saved' : ''}" data-id="${esc(s.id)}">
    <div class="sch-card-top">
      <div class="sch-chips">
        <span class="chip chip-cat chip-${esc(s.category)}">${esc(CAT_LABEL[s.category] || s.category)}</span>
        ${(s.basis || []).map((b) => `<span class="chip">${esc(BASIS_LABEL[b] || b)}</span>`).join('')}
        ${s.audience === 'institution' ? '<span class="chip chip-inst" title="The university applies, not individual students">University applies</span>' : ''}
      </div>
      <button type="button" class="star ${saved ? 'on' : ''}" data-act="save" aria-pressed="${saved}" aria-label="${saved ? 'Remove from saved' : 'Save'} ${esc(s.name)}">${saved ? '★' : '☆'}</button>
    </div>
    <h2 class="sch-name">${esc(s.name)}</h2>
    <div class="sch-sponsor">${esc(s.sponsor || '')}</div>
    <div class="sch-amount">${esc(s.amountText || 'Amount varies')}${s.awards ? `<span class="sch-awards"> · ${s.awards} awards</span>` : ''}</div>
    <div class="sch-timing urgency-${timing.urgency}">
      <span class="status-dot"></span>${esc(timing.text)}
      ${!s.verified && hasDates(s) ? '<span class="chip chip-warn" title="Dates not yet confirmed on the sponsor page">unconfirmed</span>' : ''}
    </div>
    ${s.notes ? `<p class="sch-notes">${esc(s.notes)}</p>` : ''}

    <div class="elig-bar" title="${e.met} of ${e.total} criteria checked">
      <div class="elig-fill" style="width:${pct}%"></div>
    </div>
    <div class="elig-line"><strong>${e.met}/${e.total}</strong> · ${ELIG_LABEL[e.level]}</div>

    <details class="sch-check" data-act="toggle" ${open ? 'open' : ''}>
      <summary>Eligibility checklist</summary>
      <ul class="crit-list-view">${crit || '<li class="crit-empty">No criteria listed — see the sponsor page.</li>'}</ul>
      <div class="sch-check-foot">
        <button type="button" class="linklike" data-act="reset-checks">Reset my ticks</button>
      </div>
      <label class="sch-note-label">My notes (private)
        <textarea data-act="note" rows="2" placeholder="Essay ideas, recommender, docs to gather…">${esc(st.notes[s.id] || '')}</textarea>
      </label>
    </details>

    <div class="sch-card-foot">
      <select data-act="tracker" aria-label="Application progress for ${esc(s.name)}" class="tracker tracker-${stage}">
        ${TRACKER_STAGES.map((t) => `<option value="${t.id}" ${t.id === stage ? 'selected' : ''}>${t.label}</option>`).join('')}
      </select>
      <span class="toolbar-spacer"></span>
      ${hasDates(s) ? '<button type="button" class="btn btn-sm" data-act="ics-one" title="Add this deadline to your calendar">📅</button>' : ''}
      ${isEditor ? '<button type="button" class="btn btn-sm" data-act="edit">Edit</button>' : ''}
      ${s.url ? `<a class="btn btn-sm btn-primary" href="${esc(s.url)}" target="_blank" rel="noopener">Details ↗</a>` : ''}
    </div>
    ${s.updatedAt ? `<div class="sch-updated">Updated ${esc(formatDate(s.updatedAt.slice(0, 10)))}</div>` : ''}
  </article>`;
}

function renderGrid() {
  const ds = dataStore.state;
  if (ds.loading) { $('sch-grid').innerHTML = '<p class="sch-empty">Loading scholarships…</p>'; return; }
  const rows = filtered();
  const tabLabel = { active: 'open now', upcoming: 'upcoming', passed: 'passed', all: 'total', saved: 'saved' }[view.tab];
  $('sch-results-meta').textContent = `${rows.length} ${tabLabel}${view.q ? ` matching “${view.q}”` : ''}`;
  if (!rows.length) {
    const hint = view.tab === 'saved' ? 'Tap ☆ on any scholarship to save it here.'
      : view.tab === 'active' ? 'Nothing is open right now — check the Upcoming tab.'
        : 'Try clearing the search or filters.';
    $('sch-grid').innerHTML = `<p class="sch-empty">No scholarships here. ${hint}</p>`;
    return;
  }
  $('sch-grid').innerHTML = rows.map(({ s, status }) => cardHtml(s, status)).join('');
}

function rerenderCard(id, focusSelector) {
  const s = dataStore.state.list.find((x) => x.id === id);
  const old = $('sch-grid').querySelector(`.sch-card[data-id="${CSS.escape(id)}"]`);
  if (!s || !old) return renderAll();
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(s, getStatus(s)).trim();
  old.replaceWith(tmp.firstElementChild);
  if (focusSelector) $('sch-grid').querySelector(`.sch-card[data-id="${CSS.escape(id)}"] ${focusSelector}`)?.focus();
  renderSummary();
}

function renderAll() {
  renderSummary();
  renderToolbar();
  renderBanner();
  renderGrid();
}

// ---------- profile ----------
function openProfile() {
  const p = studentStore.state.profile;
  const yn = (name, label) => `<label>${label}
    <select name="${name}">
      <option value="" ${p[name] == null ? 'selected' : ''}>Not set</option>
      <option value="yes" ${p[name] === true ? 'selected' : ''}>Yes</option>
      <option value="no" ${p[name] === false ? 'selected' : ''}>No</option>
    </select></label>`;
  const form = document.createElement('form');
  form.className = 'sch-form';
  form.innerHTML = `
    <p class="form-hint">Fill in what you're comfortable with. Matching checklist items are ticked for you; you can still override any box.
    Saved only in this browser.</p>
    <div class="form-grid">
      <label>GPA<input name="gpa" type="number" min="0" max="4.5" step="0.01" value="${esc(p.gpa)}" /></label>
      <label>Age<input name="age" type="number" min="13" max="99" step="1" value="${esc(p.age)}" /></label>
      <label class="span-2">Current level
        <select name="level">
          <option value="" ${!p.level ? 'selected' : ''}>Not set</option>
          <option value="hs-senior" ${p.level === 'hs-senior' ? 'selected' : ''}>High school senior / rising freshman</option>
          <option value="undergrad" ${p.level === 'undergrad' ? 'selected' : ''}>Undergraduate</option>
          <option value="grad" ${p.level === 'grad' ? 'selected' : ''}>Graduate student</option>
        </select></label>
      ${yn('cals', 'CALS major')}
      ${yn('citizen', 'U.S. citizen / permanent resident')}
      ${yn('ncResident', 'North Carolina resident')}
      ${yn('farmBureau', 'NC Farm Bureau member')}
      ${yn('agCareer', 'Planning a career in food / ag / natural resources')}
    </div>`;
  const save = () => {
    const fd = new FormData(form);
    const b = (k) => (fd.get(k) === 'yes' ? true : fd.get(k) === 'no' ? false : null);
    studentStore.setProfile({
      gpa: fd.get('gpa') || '', age: fd.get('age') || '', level: fd.get('level') || '',
      cals: b('cals'), citizen: b('citizen'), ncResident: b('ncResident'), farmBureau: b('farmBureau'), agCareer: b('agCareer'),
    });
    renderSummary();
    renderGrid();
    showToast('Profile saved — checklists updated.', { kind: 'success' });
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); closeModal(); });
  openModal({
    title: 'My profile',
    bodyEl: form,
    actions: [
      { label: 'Clear profile', kind: 'danger', onClick: () => { studentStore.setProfile({}); renderSummary(); renderGrid(); showToast('Profile cleared.'); } },
      { label: 'Cancel' },
      { label: 'Save', kind: 'primary', onClick: save },
    ],
  });
}

// ---------- editor sign-in ----------
function openSignIn() {
  const form = document.createElement('form');
  form.className = 'sch-form';
  form.innerHTML = SHARED_MODE
    ? `<p class="form-hint">Enter the email address you were given editor access with. We'll email you a one-time sign-in link.</p>
       <label>Email<input name="email" type="email" required autocomplete="email" /></label>`
    : `<p class="form-hint">Shared editing isn't connected on this site yet. You can still enter <strong>local editor mode</strong>:
       add and edit scholarships in this browser, then export the list as JSON to share it.</p>`;
  const go = async () => {
    if (SHARED_MODE && !form.reportValidity()) return false;
    const res = await dataStore.signIn(new FormData(form).get('email'));
    if (!res.ok) { showToast(res.message, { kind: 'error', duration: 6000 }); return false; }
    closeModal();
    showToast(res.local ? 'Local editor mode on.' : 'Check your email for the sign-in link.', { kind: 'success', duration: 6000 });
    return false;
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); go(); });
  openModal({
    title: 'Editor sign-in',
    bodyEl: form,
    actions: [{ label: 'Cancel' }, { label: SHARED_MODE ? 'Email me a link' : 'Enter local editor mode', kind: 'primary', onClick: () => { go(); return false; } }],
  });
}

// ---------- import / export ----------
function exportJson() {
  const list = dataStore.state.list.map(({ updatedAt, updatedBy, ...rest }) => rest);
  downloadFile(`scholarships-${todayISO()}.json`, JSON.stringify(list, null, 2), 'application/json');
}

function importJson() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const list = JSON.parse(await file.text());
      if (!Array.isArray(list) || !list.every((x) => x && typeof x.name === 'string')) throw new Error('Expected a JSON array of scholarships with names.');
      if (!confirm(`Import ${list.length} scholarships? Entries with the same id are replaced; others are added.`)) return;
      const merged = [...dataStore.state.list];
      for (const s of list) {
        const i = merged.findIndex((x) => x.id === s.id);
        if (i >= 0) merged[i] = s; else merged.push(s);
      }
      await dataStore.publishAll(SHARED_MODE ? list : merged);
      showToast(`Imported ${list.length} scholarships.`, { kind: 'success' });
    } catch (e) {
      showToast(`Import failed: ${e.message}`, { kind: 'error', duration: 6000 });
    }
  });
  input.click();
}

function exportIcs(list, name) {
  const ics = buildIcs(list);
  if (!ics) { showToast('None of these have dates yet.', { kind: 'error' }); return; }
  downloadFile(name, ics, 'text/calendar');
  showToast('Calendar file downloaded — open it to add the deadlines.', { kind: 'success' });
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { view.tab = tabBtn.dataset.tab; saveView(); renderSummary(); renderGrid(); return; }

  const actEl = e.target.closest('[data-act]');
  if (!actEl || actEl.tagName === 'DETAILS' || actEl.tagName === 'TEXTAREA' || actEl.tagName === 'SELECT') return;
  const act = actEl.dataset.act;
  const card = actEl.closest('.sch-card');
  const s = card && dataStore.state.list.find((x) => x.id === card.dataset.id);
  actEl.closest('details.toolbar-menu')?.removeAttribute('open');

  switch (act) {
    case 'profile': return openProfile();
    case 'signin': return openSignIn();
    case 'signout': return dataStore.signOut();
    case 'add': return openEditor(null);
    case 'edit': return s && openEditor(s);
    case 'export': return exportJson();
    case 'import': return importJson();
    case 'ics': return exportIcs(filtered().map((r) => r.s), 'scholarship-deadlines.ics');
    case 'ics-one': return s && exportIcs([s], `${s.id}.ics`);
    case 'save': studentStore.toggleSaved(s.id); return view.tab === 'saved' ? renderAll() : rerenderCard(s.id, '.star');
    case 'reset-checks': studentStore.resetChecks(s.id); return rerenderCard(s.id);
    case 'publish-seed':
      if (!confirm(`Copy the ${SEED_SCHOLARSHIPS.length} starter scholarships into the shared list? Existing entries with the same id are overwritten.`)) return;
      try { await dataStore.publishAll(SEED_SCHOLARSHIPS); showToast('Starter list published.', { kind: 'success' }); }
      catch (err) { showToast(`Publish failed: ${err.message}`, { kind: 'error' }); }
      return;
    case 'reset-local':
      if (confirm('Discard all local edits and go back to the built-in list?')) dataStore.resetLocalDraft();
      return;
    default:
  }
});

document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('sch-check')) return;
  const id = d.closest('.sch-card').dataset.id;
  if (d.open) openCards.add(id); else openCards.delete(id);
}, true);

document.addEventListener('change', (e) => {
  const t = e.target;
  const card = t.closest('.sch-card');
  if (card && t.dataset.crit) {
    studentStore.setCheck(card.dataset.id, t.dataset.crit, t.checked);
    return rerenderCard(card.dataset.id, `[data-crit="${CSS.escape(t.dataset.crit)}"]`);
  }
  if (card && t.dataset.act === 'tracker') {
    studentStore.setTracker(card.dataset.id, t.value);
    t.className = `tracker tracker-${t.value}`;
    return;
  }
  if (card && t.dataset.act === 'note') { studentStore.setNote(card.dataset.id, t.value); return; }
  if (t.dataset.view && t.dataset.view !== 'q') {
    view[t.dataset.view] = t.type === 'checkbox' ? t.checked : t.value;
    saveView();
    renderSummary();
    renderGrid();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.view === 'q') { view.q = e.target.value; renderGrid(); }
});

// Card-level student actions re-render just that card (see handlers above);
// profile changes re-render from openProfile.
// On page load, if the Active tab would be empty, open on Upcoming instead so
// visitors don't land on "nothing here". Only the first load — a tab the viewer
// clicks afterwards is left alone.
let landed = false;
dataStore.subscribe(() => {
  if (!landed && !dataStore.state.loading) {
    landed = true;
    const counts = withStatus().reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {});
    if (view.tab === 'active' && !counts.active && counts.upcoming) view.tab = 'upcoming';
  }
  renderAll();
});

renderAll();
dataStore.init();
