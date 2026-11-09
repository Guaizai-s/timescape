export function GET() {
  return Response.json({
    status: 'ok',
    app: 'TimeScape',
    version: '0.2.0',
    schemaVersion: 2,
    persistence: 'browser-local',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
