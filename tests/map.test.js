import test from 'node:test';
import assert from 'node:assert/strict';
import { exampleEntries } from '../src/schedule.js';
import { normalizeSchedule } from '../src/data/repository.js';
import { DAY_WIDTH, layoutSchedule } from '../src/map/layout.js';

const today = '2026-11-09';
const entries = normalizeSchedule({ entries: exampleEntries(today) }).entries;

test('地图覆盖全部事项，关联待办在父日程下方并有连接', () => {
  const layout = layoutSchedule(entries, today);
  assert.deepEqual(layout.nodes.map(({ entry }) => entry.id).sort(), entries.map(({ id }) => id).sort());
  const parent = layout.nodes.find(({ entry }) => entry.id === 'demo-exam');
  const child = layout.nodes.find(({ entry }) => entry.id === 'demo-words');
  assert.ok(child.y > parent.y + parent.height);
  assert.ok(child.day < parent.day, 'preparation can happen before the exam');
  assert.deepEqual(layout.links, [{ from: 'demo-exam', to: 'demo-words' }]);
  assert.ok(layout.start <= Math.min(...layout.nodes.map((node) => node.day)));
  assert.ok(layout.end >= Math.max(...layout.nodes.map((node) => node.day + node.width / DAY_WIDTH)));
});

test('同时发生的安排与待办家族不互相遮挡', () => {
  const many = [];
  for (let index = 0; index < 40; index++) {
    many.push({ ...entries[0], id: `event-${index}`, category: index % 2 ? '备考' : '课程', start: '09:00', end: '11:00' });
    for (let child = 0; child < 3; child++) many.push({ ...entries[3], id: `task-${index}-${child}`, category: '生活', linkId: `event-${index}` });
  }
  const layout = layoutSchedule(many, today);
  assert.equal(layout.nodes.length, many.length);
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      const overlapsX = a.day < b.day + b.width / DAY_WIDTH && b.day < a.day + a.width / DAY_WIDTH;
      const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
      assert.ok(!(overlapsX && overlapsY), `${a.entry.id} / ${b.entry.id}`);
    }
  }
  for (let i = 1; i < layout.groups.length; i++) assert.ok(layout.groups[i].y >= layout.groups[i - 1].y + layout.groups[i - 1].height);
});

test('空地图有有效范围和可用的二维空间', () => {
  const layout = layoutSchedule([], today);
  assert.equal(layout.nodes.length, 0);
  assert.ok(layout.end > layout.start);
  assert.ok(layout.height > 0);
});
