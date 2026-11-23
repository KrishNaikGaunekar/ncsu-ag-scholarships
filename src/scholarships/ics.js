// Calendar export: all-day "opens" and "deadline" events, plus a reminder one
// week before each deadline. Works with Google Calendar, Outlook and Apple Calendar.

import { getStatus, nextCycleEstimate } from './status.js';

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
const ymd = (iso) => iso.replace(/-/g, '');
function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`;
}

function event(uid, date, summary, description, url, alarm) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}@ncsu-ag-scholarships`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')}`,
    `DTSTART;VALUE=DATE:${ymd(date)}`,
    `DTEND;VALUE=DATE:${nextDay(date)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    url ? `URL:${url}` : null,
    ...(alarm ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`, 'TRIGGER:-P7D', 'END:VALARM'] : []),
    'END:VEVENT',
  ].filter(Boolean).join('\r\n');
}

/** Returns null when none of the scholarships have usable dates. */
export function buildIcs(list) {
  const events = [];
  for (const s of list) {
    let { opens, deadline } = s;
    let est = '';
    if (getStatus(s) === 'passed') {
      const next = nextCycleEstimate(s);
      if (!next) continue;
      ({ opens, deadline } = next);
      est = ' (estimated — confirm on sponsor page)';
    }
    const desc = `${s.amountText || ''}${est}\n${s.url || ''}`.trim();
    if (opens) events.push(event(`${s.id}-open-${opens}`, opens, `Opens: ${s.name}`, desc, s.url, false));
    if (deadline) events.push(event(`${s.id}-due-${deadline}`, deadline, `DEADLINE: ${s.name}`, desc, s.url, true));
  }
  if (!events.length) return null;
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NCSU Ag Scholarships//Dashboard//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
}

export function downloadFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
