import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../api/health.js';
import { POST } from '../api/parse.js';

const request = (body) => new Request('http://localhost/api/parse', { method: 'POST', body });

test('健康接口如实报告浏览器持久化状态', async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).persistence, 'browser-local');
});

test('Vercel 识别接口与本地规则一致', async () => {
  const response = await POST(request(JSON.stringify({ text: '下午三点十分到四点四十上课', baseDate: '2026-11-09' })));
  assert.equal(response.status, 200);
  const { draft } = await response.json();
  assert.equal(draft.start, '15:10');
  assert.equal(draft.end, '16:40');
  assert.equal(draft.title, '上课');
});

test('API 拒绝畸形请求、无效基准日期和过长输入', async () => {
  for (const body of ['bad', 'null', '{}', JSON.stringify({ text: '上课', baseDate: '2026-02-30' }), JSON.stringify({ text: '课'.repeat(121), baseDate: '2026-11-09' })]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal((await POST(request('x'.repeat(4097)))).status, 413);
});
