import { defineConfig } from 'vite';
import { GET as health } from './api/health.js';
import { POST as parse } from './api/parse.js';

// The same Web Request/Response handlers run locally and as Vercel Functions.
function apiMiddleware(server) {
  server.middlewares.use(async (request, response, next) => {
    const url = new URL(request.url, 'http://localhost');
    const handlers = { '/api/health': ['GET', health], '/api/parse': ['POST', parse] };
    const route = handlers[url.pathname];
    if (!route) return next();
    if (request.method !== route[0]) {
      response.writeHead(405, { Allow: route[0] }).end();
      return;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size <= 16384) chunks.push(chunk);
      }
      if (size > 16384) return response.writeHead(413).end();
      const result = await route[1](new Request(url, {
        method: request.method,
        headers: request.headers,
        ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      console.error('local_api_failed', { name: error.name });
      response.writeHead(500).end();
    }
  });
}

export default defineConfig({
  plugins: [{ name: 'timescape-local-api', configureServer: apiMiddleware, configurePreviewServer: apiMiddleware }],
  build: { target: 'es2022', sourcemap: false },
});
