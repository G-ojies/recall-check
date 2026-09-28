/** Recall Check as a process that listens on a port: a laptop, a container, a virtual machine. */
import { fileURLToPath } from 'node:url';
import { createApp } from './http.ts';

const PORT = Number(process.env.PORT ?? 8787);
const REFRESH_MS = Number(process.env.RECALL_REFRESH_HOURS ?? 6) * 3600 * 1000;
// Where this server is reached from outside. Render sets RENDER_EXTERNAL_URL by itself.
const PUBLIC_URL = (process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, '');

const app = await createApp({
  publicUrl: PUBLIC_URL, mcpUrl: `http://127.0.0.1:${PORT}/mcp`,
  staticDir: fileURLToPath(new URL('../public', import.meta.url)),
});

app.http.listen(PORT, () => {
  console.log(`recall-check listening on :${PORT} as ${PUBLIC_URL}, ${app.recalls()} recalls loaded, store: ${app.store}`);
  if (!app.recalls() || app.dataAge() > REFRESH_MS) void app.refresh();
  setInterval(() => void app.refresh(), REFRESH_MS).unref();
});
