import { categories, exampleEntries, isDateKey, entryInterval } from '../schedule.js';

export const STORAGE_KEY = 'timescape.v1'; // Keep the origin's existing records and theme.
export const SCHEMA_VERSION = 2;

export function normalizeEntry(entry) {
  const allDay = entry.kind === 'notice' || (typeof entry.allDay === 'boolean' ? entry.allDay : !entry.start);
  return {
    ...entry,
    title: typeof entry.title === 'string' ? entry.title.trim() : '',
    endDate: entry.endDate || entry.date,
    allDay,
    start: allDay ? '' : entry.start || '',
    end: allDay ? '' : entry.end || '',
    done: entry.kind === 'task' && Boolean(entry.done),
    linkId: entry.kind === 'task' ? entry.linkId || '' : '',
  };
}

export function validateEntry(entry) {
  if (!entry.title || entry.title.length > 120) return '请输入 1–120 字的安排名称。';
  if (!['event', 'task', 'notice'].includes(entry.kind) || !categories.includes(entry.category)) return '请选择有效的类型和主题。';
  if (!isDateKey(entry.date) || !isDateKey(entry.endDate)) return '请选择有效的开始和结束日期。';
  if (entry.endDate < entry.date) return '结束日期不能早于开始日期。';
  const isTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (!entry.allDay) {
    if (!isTime(entry.start)) return '请填写开始时间，或选择全天。';
    if (entry.end && !isTime(entry.end)) return '请填写有效的结束时间。';
    if (entry.endDate !== entry.date && !entry.end) return '跨天安排请填写结束时间，或选择全天。';
    if (entry.endDate === entry.date && entry.end && entry.end <= entry.start) return '结束时间须晚于开始时间；跨夜请调整结束日期。';
  }
  return '';
}

export function normalizeSchedule(input) {
  if (!input || !Array.isArray(input.entries) || input.entries.length > 10000) throw new Error('日程文件格式不正确。');
  if (input.schemaVersion > SCHEMA_VERSION) throw new Error('这份日程由更新版本创建，请先更新应用。');
  const ids = new Set();
  const entries = input.entries.map((raw) => {
    if (!raw || typeof raw.id !== 'string' || !/^[\w-]{1,128}$/.test(raw.id) || ids.has(raw.id)) throw new Error('日程编号无效或重复。');
    const entry = normalizeEntry(raw);
    const error = validateEntry(entry);
    if (error) throw new Error(error);
    ids.add(entry.id);
    return entry;
  });
  const events = new Set(entries.filter(({ kind }) => kind === 'event').map(({ id }) => id));
  for (const entry of entries) {
    if (entry.linkId && !events.has(entry.linkId)) entry.linkId = '';
  }
  return { ...input, schemaVersion: SCHEMA_VERSION, entries, theme: ['system', 'light', 'dark'].includes(input.theme) ? input.theme : 'system' };
}

export function loadSchedule(today, storage = globalThis.localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  return normalizeSchedule(raw ? JSON.parse(raw) : { entries: exampleEntries(today), theme: 'system' });
}

export function saveSchedule(data, storage = globalThis.localStorage) {
  const normalized = normalizeSchedule(data);
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function entriesOnDate(entries, date) {
  const day = entryInterval({ date, endDate: date, allDay: true });
  return entries.filter((entry) => {
    const span = entryInterval(entry);
    return span.start < day.end && span.end > day.start;
  });
}
