// 服务端：Express（REST API + 静态文件）+ Socket.IO（实时对局）
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { Auth } from './auth.js';
import { RoomManager } from './rooms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 创建服务（不监听端口）
 * @param {{dataDir:string, timing?:object}} opts
 */
export function createApp({ dataDir, timing }) {
  const auth = new Auth(dataDir);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '3mb' }));

  const staticOpts = { maxAge: '1h' };
  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three'), staticOpts));
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use('/avatars', express.static(path.join(dataDir, 'avatars'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'public')));

  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  function requireUser(req, res, next) {
    const user = auth.verify(bearer(req));
    if (!user) return res.status(401).json({ ok: false, error: '请先登录' });
    req.user = user;
    return next();
  }

  const handle = (fn) => (req, res) => {
    try {
      res.json({ ok: true, ...fn(req) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  };

  // 简易登录频率限制：每个 IP 每分钟 20 次
  const attempts = new Map();
  function rateLimit(req, res, next) {
    const key = req.ip;
    const now = Date.now();
    const list = (attempts.get(key) || []).filter((t) => now - t < 60_000);
    if (list.length >= 20) return res.status(429).json({ ok: false, error: '操作太频繁，请稍后再试' });
    list.push(now);
    attempts.set(key, list);
    return next();
  }

  app.post('/api/register', rateLimit, handle((req) => auth.register(req.body?.username, req.body?.password, req.body?.nickname)));
  app.post('/api/login', rateLimit, handle((req) => auth.login(req.body?.username, req.body?.password)));
  app.post('/api/logout', requireUser, handle((req) => { auth.logout(bearer(req)); return {}; }));
  app.get('/api/me', requireUser, handle((req) => ({ user: Auth.publicUser(req.user) })));
  app.put('/api/profile', requireUser, handle((req) => ({ user: auth.updateProfile(req.user, req.body || {}) })));
  app.post('/api/avatar', requireUser, handle((req) => ({ user: auth.saveAvatar(req.user, req.body?.image) })));
  app.delete('/api/avatar', requireUser, handle((req) => ({ user: auth.removeAvatar(req.user) })));
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: '接口不存在' }));

  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 1e5, pingInterval: 10_000, pingTimeout: 8_000 });
  const rooms = new RoomManager(io, auth, timing);
  return { app, server, io, rooms, auth };
}
