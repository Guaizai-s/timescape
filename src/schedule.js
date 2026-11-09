export const categories = ['课程', '备考', '校园', '生活'];
export const weekdays = '日一二三四五六';
export const DAY_MS = 86_400_000;
const pad = (number) => String(number).padStart(2, '0');

export function dateKey(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function civilDate(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  return result;
}

export function isDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key) || key < '0001-01-01') return false;
  const value = civilDate(key);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === key;
}

export const dayNumber = (key) => civilDate(key).getTime() / DAY_MS;
export const dateFromDay = (day) => new Date(Math.floor(day) * DAY_MS).toISOString().slice(0, 10);
export const addDays = (key, amount) => dateFromDay(dayNumber(key) + amount);
export const startOfWeek = (key) => addDays(key, -((civilDate(key).getUTCDay() + 6) % 7));

export function displayDate(key, withWeekday = false) {
  const value = civilDate(key);
  const label = `${value.getUTCMonth() + 1}月${value.getUTCDate()}日`;
  return withWeekday ? `${label} · 星期${weekdays[value.getUTCDay()]}` : label;
}

const minuteOf = (time) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

// Civil dates stay independent of DST. Timed ends are exclusive; all-day ends
// are inclusive in the editor and converted to an exclusive interval here.
export function entryInterval(entry) {
  const first = dayNumber(entry.date);
  const last = dayNumber(entry.endDate || entry.date);
  if (entry.allDay || entry.kind === 'notice' || !entry.start) return { start: first, end: last + 1 };
  const start = first + minuteOf(entry.start) / 1440;
  const end = entry.end ? last + minuteOf(entry.end) / 1440 : start + 1 / 1440;
  return { start, end };
}

export function daySegment(entry, day) {
  const allDay = entry.allDay || entry.kind === 'notice' || !entry.start;
  return {
    allDay,
    start: allDay ? '' : entry.date < day ? '00:00' : entry.start,
    end: allDay ? '' : (entry.endDate || entry.date) > day ? '24:00' : entry.end,
    continuesBefore: entry.date < day,
    continuesAfter: (entry.endDate || entry.date) > day,
  };
}

export function timeLabel(entry) {
  const endDate = entry.endDate || entry.date;
  const allDay = entry.allDay || entry.kind === 'notice' || !entry.start;
  if (endDate !== entry.date) {
    return allDay
      ? `${displayDate(entry.date)}–${displayDate(endDate)}，全天`
      : `${displayDate(entry.date)} ${entry.start}–${displayDate(endDate)} ${entry.end}`;
  }
  if (allDay) return '全天';
  return entry.end ? `${entry.start}–${entry.end}` : entry.start;
}

const numeral = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (tens ? numeral[tens] : 1) * 10 + (ones ? numeral[ones] : 0);
  }
  return Number([...value].map((digit) => numeral[digit]).join(''));
}

const clock = /^(?:(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)\s*)?(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})(?::(\d{2})|点(?:(半|一刻|三刻)|(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})分|(\d{2}|[一二三四五]?十[一二三四五六七八九]?|[零〇][一二三四五六七八九]))?)/;
const afternoon = new Set(['下午', '傍晚', '晚上', '夜里']);
function readClock(text, inheritedPeriod = '') {
  const match = clock.exec(text);
  if (!match) return null;
  const [, explicitPeriod, rawHour, numericMinute, quarter, markedMinute, bareMinute] = match;
  const period = explicitPeriod || inheritedPeriod;
  const originalHour = chineseNumber(rawHour);
  let hour = originalHour;
  const minute = quarter ? ({ 半: 30, 一刻: 15, 三刻: 45 })[quarter] : chineseNumber(numericMinute || markedMinute || bareMinute || '0');
  if ((afternoon.has(period) && hour < 12) || (period === '中午' && hour >= 1 && hour <= 3)) hour += 12;
  if (period === '凌晨' && hour === 12) hour = 0;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return null;
  return { hour, minute, originalHour, period, explicitPeriod, length: match[0].length };
}
const clockLabel = ({ hour, minute }) => `${pad(hour)}:${pad(minute)}`;

function readDate(text, baseDate) {
  const relative = /^(今天|明天|后天|昨天|今晚|明晚|今早|明早)/.exec(text);
  const week = /^(下周|本周|这周|周|下星期|星期)([一二三四五六日天])/.exec(text);
  const calendar = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(text);
  const matched = relative || week || calendar || iso;
  if (!matched) return null;
  let date = baseDate;
  let period = '';
  if (relative) {
    const offsets = { 今天: 0, 明天: 1, 后天: 2, 昨天: -1, 今晚: 0, 明晚: 1, 今早: 0, 明早: 1 };
    date = addDays(baseDate, offsets[relative[1]]);
    period = relative[1].endsWith('晚') ? '晚上' : relative[1].endsWith('早') ? '早上' : '';
  } else if (week) {
    const day = week[2] === '天' ? 6 : (weekdays.indexOf(week[2]) + 6) % 7;
    date = addDays(startOfWeek(baseDate), day + (week[1].startsWith('下') ? 7 : 0));
    if (['周', '星期'].includes(week[1]) && date < baseDate) date = addDays(date, 7);
  } else {
    const [, year = baseDate.slice(0, 4), month, day] = calendar || iso;
    date = `${year}-${pad(Number(month))}-${pad(Number(day))}`;
  }
  return { date: isDateKey(date) ? date : '', length: matched[0].length, period, implicitYear: Boolean(calendar && !calendar[1]) };
}

export function parseQuickEntry(input, baseDate = dateKey(), selectedDate = baseDate) {
  let text = input.normalize('NFKC').trim();
  const kindPrefix = /^(仅知晓|知晓|待办)[：:\s]*/.exec(text);
  if (kindPrefix) text = text.slice(kindPrefix[0].length);
  const datePrefix = readDate(text, baseDate);
  let date = datePrefix ? datePrefix.date : selectedDate;
  let warning = date ? '' : '这一天不存在，请重新选择日期。';
  if (datePrefix) text = text.slice(datePrefix.length).trimStart();
  const explicitAllDay = /^全天\s*/.exec(text);
  if (explicitAllDay) text = text.slice(explicitAllDay[0].length);
  const first = explicitAllDay ? null : readClock(text, datePrefix?.period);
  if (first) text = text.slice(first.length).trimStart();
  let endDate = date;
  let end = '';
  let hasDateRange = false;
  const separator = /^(?:到|至|[-~—–])\s*/.exec(text);
  if (separator) {
    let tail = text.slice(separator[0].length);
    const relativeEnd = /^(?:今天|明天|后天|昨天|今晚|明晚|今早|明早|下周|本周|这周|周|下星期|星期)/.test(tail);
    const secondDate = readDate(tail, relativeEnd ? baseDate : date || baseDate);
    if (secondDate) {
      hasDateRange = true;
      endDate = secondDate.date;
      tail = tail.slice(secondDate.length).trimStart();
      if (secondDate.implicitYear && endDate && date && endDate < date) {
        const nextYear = `${Number(date.slice(0, 4)) + 1}${endDate.slice(4)}`;
        endDate = isDateKey(nextYear) ? nextYear : '';
      }
    }
    const second = first ? readClock(tail, secondDate ? secondDate.period : first.period) : null;
    if (second) {
      if (!secondDate && !second.explicitPeriod && second.originalHour < 12 && second.hour < first.hour && second.hour + 12 > first.hour && second.hour < 12) second.hour += 12;
      end = clockLabel(second);
      if (!secondDate && end <= clockLabel(first) && date) endDate = addDays(date, 1);
      text = tail.slice(second.length).trimStart();
    } else if (secondDate) {
      text = tail;
      if (first) warning ||= '已识别跨天日期，请补充结束时间。';
    }
    if (secondDate && !endDate) warning ||= '结束日期不存在，请重新选择。';
  }
  if (!first && !explicitAllDay && /^(?:凌晨|早上|上午|中午|下午|傍晚|晚上|夜里|\d{1,2}(?:点|:))/.test(text)) {
    warning ||= '没识别出具体时间，可以在下方补填。';
  }
  if (date && endDate && endDate < date) warning ||= '结束日期早于开始日期，请检查。';
  const kind = kindPrefix ? (kindPrefix[1] === '待办' ? 'task' : 'notice') : first || hasDateRange || explicitAllDay ? 'event' : 'task';
  const allDay = kind === 'notice' || !first;
  return {
    title: text.replace(/^[,，:：、\s]+/, ''), date, endDate, kind, allDay,
    start: allDay ? '' : clockLabel(first), end: allDay ? '' : end, warning,
  };
}

export function exampleEntries(today) {
  const base = { demo: true, done: false, start: '', end: '', linkId: '' };
  return [
    { ...base, id: 'demo-library', title: '图书馆自习', date: today, kind: 'event', category: '备考', start: '09:00', end: '10:30' },
    { ...base, id: 'demo-class', title: '上课', date: today, kind: 'event', category: '课程', start: '15:10', end: '16:40' },
    { ...base, id: 'demo-group', title: '小组讨论', date: today, kind: 'event', category: '课程', start: '15:30', end: '16:00' },
    { ...base, id: 'demo-words', title: '背单词', date: today, kind: 'task', category: '备考', linkId: 'demo-exam' },
    { ...base, id: 'demo-notes', title: '整理课堂笔记', date: today, kind: 'task', category: '课程' },
    { ...base, id: 'demo-games', title: '校运会', date: today, endDate: addDays(today, 2), allDay: true, kind: 'notice', category: '校园' },
    { ...base, id: 'demo-exam', title: '四级考试', date: addDays(today, 2), kind: 'event', category: '备考', start: '09:00', end: '11:20' },
  ];
}
