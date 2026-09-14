const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RANGE_RE = /(\d{1,2}:\d{2}\s*[AP]M)\s*[-\u2013\u2014]\s*(\d{1,2}:\d{2}\s*[AP]M)/gi;
const DAY_INDEX = { sun: 6, mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5 };
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const addDays = (iso, days) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function time(value) {
  const raw = text(value);
  const iso = raw.match(/(?:T|\b)([01]\d|2[0-3]):([0-5]\d)/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const twelve = raw.match(/^(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!twelve) return raw.slice(0, 5);
  let hour = Number(twelve[1]) % 12;
  if (twelve[3].toUpperCase() === 'P') hour += 12;
  return `${String(hour).padStart(2, '0')}:${twelve[2]}`;
}

function roleFor(rawRole, primaryJob) {
  const explicit = text(rawRole);
  if (explicit && !/^employee$/i.test(explicit)) return explicit;
  const job = text(primaryJob);
  if (/\b(cel|manager|management|supervisor)\b/i.test(job)) return 'CEL';
  if (/\b(shipment|stock|inventory|boh)\b/i.test(job)) return 'BOH';
  if (job) return 'Stylist';
  throw new Error('Shift missing primary job/role');
}

export function parseShiftTitle(title) {
  return [...text(title).matchAll(RANGE_RE)].map(match => ({ start_time: time(match[1]), end_time: time(match[2]) }));
}

export function normalizeShift(raw) {
  const primaryJob = text(raw.primary_job || raw.primaryJob || raw.job);
  const shift = {
    employee_name: text(raw.employee_name || raw.employeeName || raw.employee),
    primary_job: primaryJob,
    date: text(raw.date).slice(0, 10),
    start_time: time(raw.start_time || raw.startTime),
    end_time: time(raw.end_time || raw.endTime),
    role: roleFor(raw.role, primaryJob),
  };
  if (!shift.employee_name || !DATE_RE.test(shift.date) || !TIME_RE.test(shift.start_time) || !TIME_RE.test(shift.end_time)) throw new Error(`Invalid shift: ${JSON.stringify(shift)}`);
  if (shift.end_time <= shift.start_time) throw new Error(`Shift end must follow start for ${shift.employee_name}`);
  return shift;
}

function isoFromParts(year, month, day) {
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  if (candidate.getUTCFullYear() !== Number(year) || candidate.getUTCMonth() !== Number(month) - 1 || candidate.getUTCDate() !== Number(day)) return null;
  return candidate.toISOString().slice(0, 10);
}

export function parseHeaderDate(label, expectedMonday) {
  const raw = text(label);
  const iso = raw.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return isoFromParts(iso[1], iso[2], iso[3]);
  const numeric = raw.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : Number(expectedMonday.slice(0, 4));
    if (year < 100) year += 2000;
    let value = isoFromParts(year, numeric[1], numeric[2]);
    if (value && value < addDays(expectedMonday, -3)) value = isoFromParts(year + 1, numeric[1], numeric[2]);
    if (value && value > addDays(expectedMonday, 10)) value = isoFromParts(year - 1, numeric[1], numeric[2]);
    return value;
  }
  const weekday = raw.slice(0, 3).toLowerCase();
  return Object.hasOwn(DAY_INDEX, weekday) ? addDays(expectedMonday, DAY_INDEX[weekday]) : null;
}

export function detectVisibleWeekStart(snapshots, expectedMonday) {
  const inferred = new Set();
  for (const snapshot of snapshots || []) {
    for (const header of snapshot.headers || []) {
      const label = text(header.label);
      if (!/\d{1,2}[\/-]\d{1,2}/.test(label)) continue;
      const date = parseHeaderDate(label, expectedMonday);
      const dayIndex = DAY_INDEX[label.slice(0, 3).toLowerCase()];
      if (date && Number.isInteger(dayIndex)) inferred.add(addDays(date, -dayIndex));
    }
  }
  if (!inferred.size) throw new Error('Cannot verify visible Kronos week from date headers.');
  if (inferred.size !== 1) throw new Error('Kronos date headers do not describe one complete week.');
  return [...inferred][0];
}

export function parseGridSnapshots(snapshots, expectedMonday) {
  const headers = new Map();
  const stitched = new Map();
  for (const snapshot of snapshots) {
    for (const header of snapshot.headers || []) {
      const date = parseHeaderDate(header.label, expectedMonday);
      if (header.colId && date) headers.set(header.colId, date);
    }
    for (const fragment of snapshot.rows || []) {
      const rowKey = text(fragment.rowId ?? fragment.rowIndex);
      if (!rowKey) continue;
      const row = stitched.get(rowKey) || { employee_name: '', primary_job: '', cells: new Map() };
      row.employee_name ||= text(fragment.employee_name);
      row.primary_job ||= text(fragment.primary_job);
      for (const cell of fragment.cells || []) {
        if (!cell.colId) continue;
        const titles = row.cells.get(cell.colId) || new Map();
        for (const [index, rawTitle] of (cell.titles || []).entries()) {
          const title = text(typeof rawTitle === 'object' ? rawTitle.text : rawTitle);
          if (!title) continue;
          const occurrence = typeof rawTitle === 'object' && Number.isInteger(rawTitle.occurrence) ? rawTitle.occurrence : index;
          titles.set(`${occurrence}:${title}`, title);
        }
        row.cells.set(cell.colId, titles);
      }
      stitched.set(rowKey, row);
    }
  }
  const shifts = [];
  for (const row of stitched.values()) {
    if (!row.employee_name || !row.primary_job) continue;
    for (const [colId, titles] of row.cells) {
      const date = headers.get(colId);
      if (!date) continue;
      for (const title of titles.values()) for (const range of parseShiftTitle(title)) shifts.push(normalizeShift({ ...range, employee_name: row.employee_name, primary_job: row.primary_job, date }));
    }
  }
  return shifts;
}

export function validateWeek(rawShifts, expectedMonday) {
  if (!DATE_RE.test(expectedMonday)) throw new Error('Invalid expected week start');
  if (!Array.isArray(rawShifts) || !rawShifts.length) throw new Error(`No shifts extracted for week ${expectedMonday}`);
  const end = addDays(expectedMonday, 6);
  const shifts = rawShifts.map(normalizeShift);
  for (const shift of shifts) if (shift.date < expectedMonday || shift.date > end) throw new Error(`Shift ${shift.date} outside ${expectedMonday}..${end}`);
  return { week_start: expectedMonday, week_end: end, shifts };
}

export function mondayForEdmonton(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const iso = `${values.year}-${values.month}-${values.day}`;
  const date = new Date(`${iso}T12:00:00Z`);
  const offset = date.getUTCDay() === 0 ? -6 : 1 - date.getUTCDay();
  return addDays(iso, offset);
}
