// Per-student, per-device state: eligibility checklist ticks, the optional
// "My profile" used to pre-check criteria, saved (starred) scholarships, the
// application tracker and private notes. Kept in localStorage only — nothing a
// student enters leaves their browser.

const KEY = 'ncsuAgScholarships.student.v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { profile: {}, checks: {}, saved: {}, tracker: {}, notes: {}, ...JSON.parse(raw) };
  } catch { /* private mode / corrupted — start fresh */ }
  return { profile: {}, checks: {}, saved: {}, tracker: {}, notes: {} };
}

const state = load();
const listeners = new Set();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  listeners.forEach((fn) => fn());
}

export const TRACKER_STAGES = [
  { id: 'none', label: 'Not started' },
  { id: 'drafting', label: 'Drafting' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'awarded', label: 'Awarded' },
  { id: 'declined', label: 'Not selected' },
];

export const studentStore = {
  get state() { return state; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  setProfile(profile) { state.profile = profile; persist(); },

  /** value: true | false | undefined (undefined clears the manual choice → falls back to profile). */
  setCheck(sid, cid, value) {
    state.checks[sid] = state.checks[sid] || {};
    if (value === undefined) delete state.checks[sid][cid];
    else state.checks[sid][cid] = value;
    persist();
  },
  resetChecks(sid) { delete state.checks[sid]; persist(); },

  toggleSaved(sid) {
    if (state.saved[sid]) delete state.saved[sid]; else state.saved[sid] = true;
    persist();
  },
  setTracker(sid, stage) {
    if (stage === 'none') delete state.tracker[sid]; else state.tracker[sid] = stage;
    persist();
  },
  setNote(sid, text) {
    if (text.trim()) state.notes[sid] = text; else delete state.notes[sid];
    persist();
  },
};

/** true / false when the profile answers the rule, null when it can't. */
export function evaluateRule(rule, profile) {
  if (!rule || !profile) return null;
  const results = [];
  if (rule.gpaMin != null) {
    const gpa = parseFloat(profile.gpa);
    results.push(Number.isFinite(gpa) ? gpa >= rule.gpaMin : null);
  }
  for (const k of ['citizen', 'cals', 'ncResident', 'farmBureau', 'agCareer']) {
    if (rule[k] != null) results.push(profile[k] == null || profile[k] === '' ? null : profile[k] === rule[k]);
  }
  if (rule.level) results.push(profile.level ? rule.level.includes(profile.level) : null);
  if (rule.age) {
    const age = parseInt(profile.age, 10);
    results.push(Number.isFinite(age) ? age >= rule.age[0] && age <= rule.age[1] : null);
  }
  if (!results.length || results.includes(null)) return results.includes(false) ? false : null;
  return results.every(Boolean);
}

/** Effective state of one criterion: manual tick wins, else profile, else unchecked. */
export function criterionState(s, c) {
  const manual = state.checks[s.id]?.[c.id];
  if (manual !== undefined) return { checked: manual, source: 'manual' };
  const auto = evaluateRule(c.rule, state.profile);
  if (auto !== null) return { checked: auto, source: 'profile' };
  return { checked: false, source: 'none' };
}

/**
 * Overall fit for a scholarship.
 *  - 'eligible'  every required criterion checked
 *  - 'ineligible' a required criterion the profile says you DON'T meet
 *  - 'partial'   some progress
 *  - 'unknown'   nothing checked yet
 */
export function eligibility(s) {
  const crit = s.criteria || [];
  const req = crit.filter((c) => c.required);
  let met = 0;
  let blocked = false;
  for (const c of crit) {
    const st = criterionState(s, c);
    if (st.checked) met += 1;
    if (c.required && !st.checked && st.source === 'profile') blocked = true;
  }
  const reqMet = req.filter((c) => criterionState(s, c).checked).length;
  let level = 'unknown';
  if (req.length && reqMet === req.length) level = 'eligible';
  else if (blocked) level = 'ineligible';
  else if (met > 0) level = 'partial';
  return { level, met, total: crit.length, reqMet, reqTotal: req.length };
}
