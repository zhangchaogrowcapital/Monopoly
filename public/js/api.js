// REST API 与 Socket.IO 封装
const TOKEN_KEY = 'monopoly_token';

export const session = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set token(v) {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* 隐私模式下忽略 */ }
  },
};

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await res.json(); } catch { data = { ok: false, error: `服务器错误 (${res.status})` }; }
  if (!data.ok) {
    const err = new Error(data.error || '请求失败');
    err.status = res.status;
    throw err;
  }
  return data;
}

export class Net {
  constructor() {
    this.socket = null;
    this.handlers = new Map();
  }

  connect(token) {
    this.disconnect();
    this.socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    for (const [ev, fns] of this.handlers) for (const fn of fns) this.socket.on(ev, fn);
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, []);
    this.handlers.get(ev).push(fn);
    this.socket?.on(ev, fn);
  }

  /** 发送并等待服务器确认，失败时抛出错误 */
  request(ev, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket) { reject(new Error('未连接服务器')); return; }
      const timer = setTimeout(() => reject(new Error('服务器无响应')), 8000);
      this.socket.emit(ev, payload, (res) => {
        clearTimeout(timer);
        if (res?.ok) resolve(res);
        else reject(new Error(res?.error || '操作失败'));
      });
    });
  }
}
