import { createServer } from 'vite';

// Keep the original local entry point compatible with the Vite application.
const server = await createServer({
  server: { host: process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1', port: 4173, strictPort: true },
});
await server.listen();
server.printUrls();
