import { isDateKey, parseQuickEntry } from '../src/schedule.js';

export async function POST(request) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const text = await request.text();
    if (text.length > 4096) return Response.json({ error: '输入内容过长。' }, { status: 413, headers });
    const payload = JSON.parse(text);
    if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 120 || !isDateKey(payload.baseDate)) {
      return Response.json({ error: '请提供 1–120 字的内容和有效的基准日期。' }, { status: 400, headers });
    }
    return Response.json({ draft: parseQuickEntry(payload.text, payload.baseDate) }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return Response.json({ error: '请求格式不正确。' }, { status: 400, headers });
    }
    console.error('parse_failed', { name: error.name });
    return Response.json({ error: '暂时无法识别。' }, { status: 500, headers });
  }
}
