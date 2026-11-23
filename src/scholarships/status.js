// Date/status logic for scholarships. All dates are plain 'YYYY-MM-DD' strings
// and compared as local calendar days, so a deadline of "2026-09-30" stays
// active through the end of Sep 30 regardless of time zone.

const DAY = 86400000;

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function daysBetween(fromISO, toISO) {
  return Math.round((toDay(toISO) - toDay(fromISO)) / DAY);
}

/**
 * 'active' | 'upcoming' | 'passed'
 *  - statusOverride 'closed' → passed; 'open' → active (for rolling/unknown windows)
 *  - deadline < today → passed
 *  - opens > today → upcoming
 *  - otherwise, with a deadline or an open date already reached → active
 *  - no dates at all → upcoming (shown with a "dates TBA" flag)
 */
export function getStatus(s, today = todayISO()) {
  if (s.statusOverride === 'closed') return 'passed';
  if (s.statusOverride === 'open') return 'active';
  if (s.deadline && s.deadline < today) return 'passed';
  if (s.opens && s.opens > today) return 'upcoming';
  if (s.deadline || s.opens) return 'active';
  return 'upcoming';
}

export function hasDates(s) {
  return Boolean(s.opens || s.deadline);
}

/** Human countdown for the card's date line. */
export function describeTiming(s, today = todayISO()) {
  const status = getStatus(s, today);
  if (status === 'active') {
    if (!s.deadline) return { text: 'Open now · no deadline listed', urgency: 'none' };
    const left = daysBetween(today, s.deadline);
    if (left === 0) return { text: 'Due today', urgency: 'urgent' };
    return {
      text: `${left} day${left === 1 ? '' : 's'} left · due ${formatDate(s.deadline)}`,
      urgency: left <= 7 ? 'urgent' : left <= 30 ? 'soon' : 'none',
    };
  }
  if (status === 'upcoming') {
    if (!hasDates(s)) return { text: 'Dates TBA — check sponsor page', urgency: 'none' };
    const opensIn = daysBetween(today, s.opens);
    return { text: `Opens ${formatDate(s.opens)} · in ${opensIn} day${opensIn === 1 ? '' : 's'}`, urgency: 'none' };
  }
  // passed
  const next = nextCycleEstimate(s, today);
  if (s.statusOverride === 'closed' && !s.deadline) {
    return { text: 'Applications closed — next cycle TBA', urgency: 'none' };
  }
  return {
    text: `Closed ${s.deadline ? formatDate(s.deadline) : ''}${next ? ` · next cycle est. ${formatDate(next.opens || next.deadline)}` : ''}`.trim(),
    urgency: 'none',
  };
}

/** For annual programs that have passed, project the same window one year on. */
export function nextCycleEstimate(s, today = todayISO()) {
  if (s.recurring !== 'annual' || !s.deadline) return null;
  const shift = (iso) => {
    if (!iso) return null;
    let [y, m, d] = iso.split('-');
    let n = Number(y);
    let out;
    do { n += 1; out = `${n}-${m}-${d}`; } while (out < today);
    return out;
  };
  const deadline = shift(s.deadline);
  let opens = null;
  if (s.opens) {
    // keep the same opens→deadline gap
    const gap = daysBetween(s.opens, s.deadline);
    const dl = new Date(toDay(deadline) - gap * DAY);
    opens = todayISO(dl);
  }
  return { opens, deadline };
}

export function formatDate(iso) {
  if (!iso) return '';
  return new Date(toDay(iso)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Largest dollar value a scholarship could pay out, for sorting / totals. */
export function maxAmount(s) {
  return Number(s.amountMax || s.amountMin || 0);
}
