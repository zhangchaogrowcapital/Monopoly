// 启动入口
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;

const { server, auth, rooms } = createApp({ dataDir: DATA_DIR });

server.listen(PORT, () => {
  console.log(`🎲 3D 大富翁已启动：http://localhost:${PORT}`);
});

const shutdown = () => {
  rooms.dispose();
  auth.store.flush();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
