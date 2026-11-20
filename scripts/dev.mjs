// Development only: use Next's public custom-server API in one Node process.
// https://nextjs.org/docs/app/guides/custom-server
import { createServer } from 'node:http';
import next from 'next';

if (process.env.NODE_ENV === 'production') {
  console.error('Este iniciador é somente para desenvolvimento local. Em produção, use npm start.');
  process.exit(1);
}
process.env.NODE_ENV = 'development';
process.env.HUB_LOCAL_SERVER = '1';
const hostname = '127.0.0.1';
const port = 3000;
const server = createServer((request, response) => {
  void handle(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Não foi possível atender esta solicitação.');
  });
});
const app = next({ dev: true, hostname, port, httpServer: server, turbopack: true });
const handle = app.getRequestHandler();

try {
  await app.prepare();
  server.on('upgrade', (request, socket, head) => {
    void app.getUpgradeHandler()(request, socket, head).catch(() => socket.destroy());
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, resolve);
  });
  console.log(`Ready: http://${hostname}:${port}`);
} catch (error) {
  console.error(error?.code === 'EADDRINUSE' ? 'A porta 3000 já está em uso. Feche o outro servidor antes de iniciar.' : `O servidor não iniciou (${error?.code || 'falha de inicialização'}).`);
  await app.close().catch(() => {});
  process.exit(1);
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(0), 5000);
  timeout.unref();
  server.closeAllConnections();
  server.close();
  await app.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
