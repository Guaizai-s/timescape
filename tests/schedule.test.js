import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daySegment, isDateKey, parseQuickEntry } from '../src/schedule.js';
import { entriesOnDate, loadSchedule, normalizeEntry, normalizeSchedule, saveSchedule, STORAGE_KEY, validateEntry } from '../src/data/repository.js';

const today = '2026-11-09';
const entry = (changes = {}) => normalizeEntry({ id: 'event-1', title: '安排', kind: 'event', category: '生活', date: today, start: '15:00', end: '16:00', ...changes });

for (const [text, expected] of [
  ['下午3点上课', { title: '上课', start: '15:00', end: '', date: today, endDate: today, kind: 'event', allDay: false }],
  ['下午三点十分到四点四十上课', { title: '上课', start: '15:10', end: '16:40', date: today, endDate: today }],
  ['明天下午三点半到五点开会', { title: '开会', date: '2026-11-10', endDate: '2026-11-10', start: '15:30', end: '17:00' }],
  ['今天晚上十一点到明天凌晨一点值班', { title: '值班', date: today, endDate: '2026-11-10', start: '23:00', end: '01:00' }],
  ['23:00到01:00值班', { title: '值班', date: today, endDate: '2026-11-10', start: '23:00', end: '01:00' }],
  ['明天到后天校运会', { title: '校运会', date: '2026-11-10', endDate: '2026-11-11', allDay: true }],
  ['12月31日到1月2日旅行', { title: '旅行', date: '2026-12-31', endDate: '2027-01-02', allDay: true }],
  ['下周三上午九点考试', { title: '考试', date: '2026-11-18', start: '09:00' }],
  ['2026-11-12全天会议', { title: '会议', date: '2026-11-12', allDay: true, kind: 'event' }],
  ['仅知晓 明天到后天校运会', { title: '校运会', date: '2026-11-10', endDate: '2026-11-11', kind: 'notice', allDay: true }],
  ['待办 下午三点背单词', { title: '背单词', kind: 'task', start: '15:00', allDay: false }],
  ['背单词', { title: '背单词', kind: 'task', allDay: true, start: '' }],
]) {
  test(`识别：${text}`, () => {
    const draft = parseQuickEntry(text, today);
    for (const [key, value] of Object.entries(expected)) assert.equal(draft[key], value, key);
    assert.equal(draft.warning, '');
  });
}

test('无效日期和时间不会被悄悄当成有效时间', () => {
  assert.equal(isDateKey('2026-02-29'), false);
  assert.equal(isDateKey('2028-02-29'), true);
  assert.equal(isDateKey('0000-01-01'), false);
  assert.equal(isDateKey('0001-01-01'), true);
  assert.equal(isDateKey('9999-12-31'), true);
  assert.equal(parseQuickEntry('2月30日上课', today).date, '');
  assert.ok(parseQuickEntry('25:00上课', today).warning);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('未写日期使用所选日，今天和明天仍以实际今天为准', () => {
  assert.equal(parseQuickEntry('下午3点上课', today, '2026-12-01').date, '2026-12-01');
  assert.equal(parseQuickEntry('明天下午3点上课', today, '2026-12-01').date, '2026-11-10');
});

test('跨天日程每天可见，00:00 结束不占用下一天', () => {
  const span = entry({ date: '2026-11-09', endDate: '2026-11-12', start: '23:00', end: '01:00' });
  for (const day of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) assert.equal(entriesOnDate([span], day).length, 1);
  for (const day of ['2026-11-08', '2026-11-13']) assert.equal(entriesOnDate([span], day).length, 0);
  assert.deepEqual(daySegment(span, '2026-11-10'), { allDay: false, start: '00:00', end: '24:00', continuesBefore: true, continuesAfter: true });
  const midnight = entry({ endDate: '2026-11-10', start: '23:00', end: '00:00' });
  assert.equal(entriesOnDate([midnight], '2026-11-10').length, 0);
  assert.equal(entriesOnDate([midnight], today).length, 1);
});

test('全天结束日期包含在范围内；无结束时间仅落在开始日', () => {
  const span = entry({ allDay: true, endDate: '2026-11-11' });
  assert.equal(entriesOnDate([span], '2026-11-11').length, 1);
  assert.equal(entriesOnDate([span], '2026-11-12').length, 0);
  const point = entry({ start: '23:59', end: '' });
  assert.equal(entriesOnDate([point], today).length, 1);
  assert.equal(entriesOnDate([point], '2026-11-10').length, 0);
});

test('跨天时间和日期校验', () => {
  assert.ok(validateEntry(entry({ endDate: '2026-11-08' })));
  assert.ok(validateEntry(entry({ end: '14:00' })));
  assert.ok(validateEntry(entry({ endDate: '2026-11-10', end: '' })));
  assert.ok(validateEntry(entry({ start: '24:00' })));
  assert.equal(validateEntry(entry({ endDate: '2026-11-10', start: '23:00', end: '01:00' })), '');
  assert.equal(validateEntry(entry({ allDay: true, start: '', end: '' })), '');
});

test('原有数据无损升级，保留 ID、关联、完成状态和配色', () => {
  const old = { theme: 'dark', entries: [
    { id: 'exam', title: '四级考试', kind: 'event', category: '备考', date: today, start: '09:00', end: '11:20', demo: true },
    { id: 'words', title: '背单词', kind: 'task', category: '备考', date: today, start: '', end: '', linkId: 'exam', done: true },
  ] };
  const stored = new Map([[STORAGE_KEY, JSON.stringify(old)]]);
  const storage = { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  const loaded = loadSchedule(today, storage);
  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.theme, 'dark');
  assert.equal(loaded.entries[0].endDate, today);
  assert.equal(loaded.entries[1].allDay, true);
  assert.equal(loaded.entries[1].done, true);
  assert.equal(loaded.entries[1].linkId, 'exam');
  assert.equal(stored.get(STORAGE_KEY), JSON.stringify(old), 'reading does not overwrite storage');
  saveSchedule(loaded, storage);
  assert.deepEqual(loadSchedule(today, storage), loaded);
});

test('损坏或未知版本数据不被覆盖，非法导入被拒绝', () => {
  let writes = 0;
  const storage = { getItem: () => '{bad', setItem: () => writes++ };
  assert.throws(() => loadSchedule(today, storage));
  assert.equal(writes, 0);
  assert.throws(() => saveSchedule({ entries: [entry(), entry()] }, storage));
  assert.equal(writes, 0);
  assert.throws(() => normalizeSchedule({ schemaVersion: 99, entries: [] }));
  const schedule = normalizeSchedule({ entries: [entry({ kind: 'task', linkId: 'missing' })] });
  assert.equal(schedule.entries[0].linkId, '');
});
