// Add / edit scholarship dialog for editors.

import { openModal, closeModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { dataStore } from './data-store.js';

export const CATEGORIES = [
  { id: 'ncag', label: 'NC + Ag' },
  { id: 'national', label: 'National' },
  { id: 'grant', label: 'Grant' },
];
export const BASES = [
  { id: 'merit', label: 'Merit' },
  { id: 'need', label: 'Need' },
  { id: 'essay', label: 'Essay' },
  { id: 'grant', label: 'Grant' },
];

// Profile-rule presets an editor can attach to a checklist line.
const RULE_OPTIONS = [
  { v: '', label: 'No auto-check' },
  { v: 'gpaMin', label: 'GPA at least…', needsValue: 'number' },
  { v: 'citizen', label: 'U.S. citizen / PR' },
  { v: 'cals', label: 'CALS major' },
  { v: 'ncResident', label: 'NC resident' },
  { v: 'farmBureau', label: 'NC Farm Bureau member' },
  { v: 'agCareer', label: 'Plans ag / food / natural-resources career' },
  { v: 'level:hs-senior', label: 'High school senior (rising freshman)' },
  { v: 'level:undergrad', label: 'Undergraduate' },
  { v: 'level:hs-senior,undergrad', label: 'HS senior or undergraduate' },
  { v: 'level:undergrad,grad', label: 'Undergraduate or graduate' },
  { v: 'age', label: 'Age range (e.g. 17-25)', needsValue: 'range' },
];

function ruleToForm(rule) {
  if (!rule) return { key: '', value: '' };
  if (rule.gpaMin != null) return { key: 'gpaMin', value: rule.gpaMin };
  if (rule.level) return { key: `level:${rule.level.join(',')}`, value: '' };
  if (rule.age) return { key: 'age', value: rule.age.join('-') };
  const k = ['citizen', 'cals', 'ncResident', 'farmBureau', 'agCareer'].find((x) => rule[x]);
  return { key: k || '', value: '' };
}

function formToRule(key, value) {
  if (!key) return undefined;
  if (key === 'gpaMin') { const n = parseFloat(value); return Number.isFinite(n) ? { gpaMin: n } : undefined; }
  if (key === 'age') {
    const m = String(value).match(/(\d+)\s*[-–]\s*(\d+)/);
    return m ? { age: [Number(m[1]), Number(m[2])] } : undefined;
  }
  if (key.startsWith('level:')) return { level: key.slice(6).split(',') };
  return { [key]: true };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function criterionRow(c = {}) {
  const r = ruleToForm(c.rule);
  const row = document.createElement('div');
  row.className = 'crit-edit-row';
  row.innerHTML = `
    <input class="ce-text" type="text" placeholder="Requirement, e.g. Minimum 3.0 GPA" value="${esc(c.text)}" aria-label="Requirement text" />
    <label class="ce-req"><input type="checkbox" class="ce-required" ${c.required === false ? '' : 'checked'} /> Required</label>
    <select class="ce-rule" aria-label="Auto-check from student profile">
      ${RULE_OPTIONS.map((o) => `<option value="${o.v}" ${o.v === r.key ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>
    <input class="ce-rule-value" type="text" placeholder="value" value="${esc(r.value)}" aria-label="Rule value" />
    <button type="button" class="btn ce-del" aria-label="Remove requirement">✕</button>`;
  row.dataset.cid = c.id || '';
  const sel = row.querySelector('.ce-rule');
  const val = row.querySelector('.ce-rule-value');
  const sync = () => { val.hidden = !RULE_OPTIONS.find((o) => o.v === sel.value)?.needsValue; };
  sel.addEventListener('change', sync);
  sync();
  row.querySelector('.ce-del').addEventListener('click', () => row.remove());
  return row;
}

export function openEditor(existing) {
  const s = existing ? structuredClone(existing) : {
    category: 'ncag', audience: 'student', basis: ['merit'], recurring: 'annual', verified: false, criteria: [],
  };

  const form = document.createElement('form');
  form.className = 'sch-form';
  form.innerHTML = `
    <div class="form-grid">
      <label class="span-2">Name<input name="name" required value="${esc(s.name)}" /></label>
      <label class="span-2">Sponsor / organization<input name="sponsor" value="${esc(s.sponsor)}" /></label>
      <label>Category
        <select name="category">${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === s.category ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
      </label>
      <label>Who applies
        <select name="audience">
          <option value="student" ${s.audience !== 'institution' ? 'selected' : ''}>Student</option>
          <option value="institution" ${s.audience === 'institution' ? 'selected' : ''}>Institution (university)</option>
        </select>
      </label>
      <fieldset class="span-2 basis-set"><legend>Basis</legend>
        ${BASES.map((b) => `<label><input type="checkbox" name="basis" value="${b.id}" ${(s.basis || []).includes(b.id) ? 'checked' : ''} /> ${b.label}</label>`).join('')}
      </fieldset>
      <label class="span-2">Amount (as shown to students)<input name="amountText" placeholder="$1,600 – $3,200" value="${esc(s.amountText)}" /></label>
      <label>Min $ (for sorting)<input name="amountMin" type="number" min="0" step="1" value="${esc(s.amountMin)}" /></label>
      <label>Max $ (for sorting)<input name="amountMax" type="number" min="0" step="1" value="${esc(s.amountMax)}" /></label>
      <label># of awards<input name="awards" type="number" min="0" step="1" value="${esc(s.awards)}" /></label>
      <label>Repeats
        <select name="recurring">
          <option value="annual" ${s.recurring === 'annual' ? 'selected' : ''}>Every year</option>
          <option value="once" ${s.recurring !== 'annual' ? 'selected' : ''}>One time</option>
        </select>
      </label>
      <label>Opens<input name="opens" type="date" value="${esc(s.opens)}" /></label>
      <label>Deadline<input name="deadline" type="date" value="${esc(s.deadline)}" /></label>
      <label>Status
        <select name="statusOverride">
          <option value="" ${!s.statusOverride ? 'selected' : ''}>Automatic from dates</option>
          <option value="open" ${s.statusOverride === 'open' ? 'selected' : ''}>Force open (rolling)</option>
          <option value="closed" ${s.statusOverride === 'closed' ? 'selected' : ''}>Force closed</option>
        </select>
      </label>
      <label class="check-inline"><input type="checkbox" name="verified" ${s.verified ? 'checked' : ''} /> Dates confirmed on sponsor page</label>
      <label class="span-2">Application link<input name="url" type="url" placeholder="https://" value="${esc(s.url)}" /></label>
      <label class="span-2">Notes for students<textarea name="notes" rows="3">${esc(s.notes)}</textarea></label>
    </div>
    <h3 class="crit-head">Eligibility checklist</h3>
    <p class="form-hint">Each line becomes a checkbox students tick. "Auto-check" pre-ticks it from the student's saved profile.</p>
    <div class="crit-list"></div>
    <button type="button" class="btn add-crit">+ Add requirement</button>`;

  const list = form.querySelector('.crit-list');
  (s.criteria || []).forEach((c) => list.appendChild(criterionRow(c)));
  if (!s.criteria?.length) list.appendChild(criterionRow());
  form.querySelector('.add-crit').addEventListener('click', () => {
    const row = criterionRow();
    list.appendChild(row);
    row.querySelector('.ce-text').focus();
  });

  const submit = async () => {
    if (!form.reportValidity()) return false;
    const fd = new FormData(form);
    const num = (k) => { const v = fd.get(k); return v === '' || v == null ? undefined : Number(v); };
    const str = (k) => (fd.get(k) || '').toString().trim() || null;
    let n = 1;
    const usedIds = new Set();
    const criteria = [...list.querySelectorAll('.crit-edit-row')].map((row) => {
      const text = row.querySelector('.ce-text').value.trim();
      if (!text) return null;
      // keep existing ids so students' ticks survive edits
      let id = row.dataset.cid;
      while (!id || usedIds.has(id)) id = `c${n++}`;
      usedIds.add(id);
      return {
        id,
        text,
        required: row.querySelector('.ce-required').checked,
        rule: formToRule(row.querySelector('.ce-rule').value, row.querySelector('.ce-rule-value').value),
      };
    }).filter(Boolean);

    const opens = str('opens');
    const deadline = str('deadline');
    if (opens && deadline && opens > deadline) {
      showToast('The open date is after the deadline.', { kind: 'error' });
      return false;
    }

    const record = {
      ...s,
      name: str('name'),
      sponsor: str('sponsor'),
      category: fd.get('category'),
      audience: fd.get('audience'),
      basis: fd.getAll('basis'),
      amountText: str('amountText'),
      amountMin: num('amountMin'),
      amountMax: num('amountMax'),
      awards: num('awards'),
      recurring: fd.get('recurring'),
      opens,
      deadline,
      statusOverride: fd.get('statusOverride') || undefined,
      verified: fd.get('verified') === 'on',
      url: str('url'),
      notes: str('notes') || '',
      criteria,
    };
    try {
      await dataStore.save(record);
      showToast(existing ? 'Scholarship updated.' : 'Scholarship added.', { kind: 'success' });
      closeModal();
    } catch (e) {
      showToast(`Save failed: ${e.message}`, { kind: 'error', duration: 6000 });
    }
    return false; // close only after the async save succeeds
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  const actions = [{ label: 'Cancel' }];
  if (existing) {
    actions.unshift({
      label: 'Delete', kind: 'danger',
      onClick: () => {
        if (!confirm(`Delete "${existing.name}"? Students' checklists for it will no longer show.`)) return false;
        dataStore.remove(existing.id)
          .then(() => { showToast('Scholarship deleted.'); closeModal(); })
          .catch((e) => showToast(`Delete failed: ${e.message}`, { kind: 'error' }));
        return false;
      },
    });
  }
  actions.push({ label: existing ? 'Save changes' : 'Add scholarship', kind: 'primary', onClick: () => { submit(); return false; } });

  const { dialog } = openModal({ title: existing ? 'Edit scholarship' : 'Add scholarship', bodyEl: form, actions });
  dialog.classList.add('modal-wide');
}
