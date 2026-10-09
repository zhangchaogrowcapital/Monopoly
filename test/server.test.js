// 联网集成测试：注册登录、头像、房间、开局、同步、表情聊天、断线重连、托管、退出
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as connect } from 'socket.io-client';
import { createApp } from '../server/app.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(timing = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monopoly-test-'));
  const ctx = createApp({ dataDir, timing: { botThink: 5, animScale: 0, turnTimeout: 60_000, ...timing } });
  await new Promise((r) => ctx.server.listen(0, r));
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  const clients = [];
  const api = async (method, url, body, token) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };
  const user = async (name) => {
    const r = await api('POST', '/api/register', { username: name, password: 'secret123', nickname: name });
    assert.equal(r.ok, true, r.error);
    return r;
  };
  const client = async (token) => {
    const socket = connect(base, { auth: { token }, transports: ['websocket'], forceNew: true });
    const c = {
      socket,
      room: null,
      updates: [],
      emotes: [],
      chats: [],
      req: (ev, payload = {}) => new Promise((resolve) => socket.emit(ev, payload, resolve)),
      waitFor: async (pred, ms = 3000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          if (pred(c)) return true;
          await sleep(15);
        }
        throw new Error('waitFor timeout');
      },
    };
    socket.on('room:state', (r) => { c.room = r; });
    socket.on('game:update', (u) => { c.updates.push(u); if (c.room) c.room.game = u.state; });
    socket.on('emote', (e) => c.emotes.push(e));
    socket.on('chat', (m) => c.chats.push(m));
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    clients.push(c);
    return c;
  };
  const close = async () => {
    for (const c of clients) c.socket.disconnect();
    ctx.rooms.dispose();
    ctx.auth.store.flush();
    ctx.io.close();
    await new Promise((r) => ctx.server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  return { ...ctx, base, api, user, client, close };
}

test('注册、登录、资料与头像', async () => {
  const s = await setup();
  try {
    const reg = await s.user('alice');
    assert.equal((await s.api('POST', '/api/register', { username: 'alice', password: 'secret123' })).ok, false, '重复注册');
    assert.equal((await s.api('POST', '/api/login', { username: 'alice', password: 'wrongpass' })).ok, false);
    const login = await s.api('POST', '/api/login', { username: 'ALICE', password: 'secret123' });
    assert.equal(login.ok, true);
    const me = await s.api('GET', '/api/me', null, login.token);
    assert.equal(me.user.username, 'alice');
    assert.equal(me.user.passwordHash, undefined, '不能泄露密码哈希');
    assert.equal((await s.api('GET', '/api/me', null, 'bad-token')).ok, false);

    // 没有照片不能选照片角色
    assert.equal((await s.api('PUT', '/api/profile', { characterId: 'custom' }, reg.token)).ok, false);
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]).toString('base64');
    const up = await s.api('POST', '/api/avatar', { image: `data:image/jpeg;base64,${fakeJpeg}` }, reg.token);
    assert.equal(up.ok, true, up.error);
    assert.equal(up.user.characterId, 'custom');
    assert.match(up.user.avatar, /^\/avatars\/.+\.jpg\?v=\d+$/);
    const file = await fetch(s.base + up.user.avatar.split('?')[0]);
    assert.equal(file.status, 200);
    // 伪造的图片会被拒绝
    const bad = await s.api('POST', '/api/avatar', { image: `data:image/png;base64,${Buffer.from('hello').toString('base64')}` }, reg.token);
    assert.equal(bad.ok, false);
    const prof = await s.api('PUT', '/api/profile', { nickname: '爱丽丝', custom: { bodyColor: '#123456', hat: 'tophat' } }, reg.token);
    assert.equal(prof.user.nickname, '爱丽丝');
    assert.equal(prof.user.custom.hat, 'tophat');
    assert.equal((await s.api('PUT', '/api/profile', { custom: { hat: '<script>' } }, reg.token)).ok, false);
  } finally {
    await s.close();
  }
});

test('未登录不能连接 Socket', async () => {
  const s = await setup();
  try {
    const socket = connect(s.base, { auth: { token: 'nope' }, transports: ['websocket'], forceNew: true });
    const err = await new Promise((resolve) => socket.once('connect_error', resolve));
    assert.equal(err.message, 'unauthorized');
    socket.disconnect();
  } finally {
    await s.close();
  }
});

test('三名真人玩家：建房、加入、选角色、准备、开局、轮流行动', async () => {
  const s = await setup();
  try {
    const [ua, ub, uc] = [await s.user('aa'), await s.user('bb'), await s.user('cc')];
    const [a, b, c] = [await s.client(ua.token), await s.client(ub.token), await s.client(uc.token)];
    const created = await a.req('room:create', { name: '测试房', maxPlayers: 4, maxRounds: 20 });
    assert.equal(created.ok, true);
    const roomId = created.roomId;
    assert.equal((await b.req('room:join', { roomId: roomId.toLowerCase() })).ok, true, '房间号不区分大小写');
    assert.equal((await c.req('room:join', { roomId })).ok, true);
    await a.waitFor(() => a.room?.seats.length === 3);

    // 角色不能重复
    const taken = a.room.seats[0].characterId;
    assert.equal((await b.req('room:character', { characterId: taken })).ok, false);
    assert.equal((await b.req('room:character', { characterId: 'penguin' })).ok, true);
    const seatChars = new Set((await b.waitFor(() => b.room.seats[1].characterId === 'penguin'), b.room.seats.map((x) => x.characterId)));
    assert.equal(seatChars.size, 3);

    // 非房主不能开始；未准备不能开始
    assert.equal((await b.req('room:start')).ok, false);
    const notReady = await a.req('room:start');
    assert.equal(notReady.ok, false);
    assert.match(notReady.error, /未准备/);
    await b.req('room:ready', { ready: true });
    await c.req('room:ready', { ready: true });
    assert.equal((await a.req('room:start')).ok, true);
    await c.waitFor(() => c.room?.status === 'playing' && c.room.game);
    assert.equal(c.room.game.players.length, 3);

    // 游戏中不能再加入
    const ud = await s.user('dd');
    const d = await s.client(ud.token);
    assert.equal((await d.req('room:join', { roomId })).ok, false);

    // 只有当前玩家可以掷骰子，所有人都能收到事件
    const curId = a.room.game.players[a.room.game.current].id;
    const byId = { [ua.user.id]: a, [ub.user.id]: b, [uc.user.id]: c };
    const cur = byId[curId];
    const other = Object.values(byId).find((x) => x !== cur);
    assert.equal((await other.req('game:action', { type: 'roll' })).ok, false);
    assert.equal((await cur.req('game:action', { type: 'hack' })).ok, false);
    assert.equal((await cur.req('game:action', { type: 'roll' })).ok, true);
    for (const x of [a, b, c]) {
      await x.waitFor(() => x.updates.some((u) => u.events.some((e) => e.type === 'dice' && e.playerId === curId)));
    }
    // 状态一致
    assert.deepEqual(a.room.game.players.map((p) => p.position), c.room.game.players.map((p) => p.position));

    // 表情与聊天广播
    assert.equal((await b.req('game:emote', { expr: 'love' })).ok, true);
    assert.equal((await b.req('game:emote', { expr: 'nope' })).ok, false);
    await a.waitFor(() => a.emotes.some((e) => e.playerId === ub.user.id && e.expr === 'love'));
    await c.req('chat:send', { text: '  你好 <b>世界</b>  ' });
    await a.waitFor(() => a.chats.some((m) => m.text === '你好 <b>世界</b>' && m.from === uc.user.id));
  } finally {
    await s.close();
  }
});

test('与电脑对战可以自动进行，托管后由电脑代打', async () => {
  const s = await setup();
  try {
    const ua = await s.user('solo');
    const a = await s.client(ua.token);
    await a.req('room:create', { maxPlayers: 4, maxRounds: 0 });
    for (let k = 0; k < 3; k++) assert.equal((await a.req('room:addBot')).ok, true);
    assert.equal((await a.req('room:addBot')).ok, false, '房间已满');
    assert.equal((await a.req('room:start')).ok, true);
    await a.waitFor(() => a.room?.game);
    // 开启托管，整局由电脑推进
    assert.equal((await a.req('game:auto', { on: true })).ok, true);
    await a.waitFor(() => a.updates.length > 40, 8000);
    const g = a.room.game;
    assert.ok(g.turnNo > 5, `应该已经进行了多个回合 (turnNo=${g.turnNo})`);
    assert.equal((await a.req('game:auto', { on: false })).ok, true);
  } finally {
    await s.close();
  }
});

test('操作超时自动托管；掉线后电脑代打，重连可恢复', async () => {
  const s = await setup({ turnTimeout: 200, disconnectGrace: 150 });
  try {
    const [ua, ub] = [await s.user('p1'), await s.user('p2')];
    const a = await s.client(ua.token);
    let b = await s.client(ub.token);
    const { roomId } = await a.req('room:create', { maxPlayers: 2 });
    await b.req('room:join', { roomId });
    await b.req('room:ready', { ready: true });
    await a.req('room:start');
    await a.waitFor(() => a.room?.game);
    // 超时后自动托管
    await a.waitFor(() => a.chats.some((m) => m.system && m.text.includes('超时')), 3000);

    // b 掉线后重连，能拿回房间状态
    b.socket.disconnect();
    await a.waitFor(() => a.room.seats.find((x) => x.id === ub.user.id)?.connected === false);
    b = await s.client(ub.token);
    const sync = await b.req('room:sync');
    assert.equal(sync.room.id, roomId);
    assert.ok(sync.room.game);
    await a.waitFor(() => a.room.seats.find((x) => x.id === ub.user.id)?.connected === true);

    // 游戏中退出 = 认输，剩下一人获胜
    assert.equal((await b.req('room:leave')).ok, true);
    await a.waitFor(() => a.room.status === 'ended');
    assert.equal(a.room.game.winner, ua.user.id);
    // 房主可以再开一局
    assert.equal((await a.req('room:reset')).ok, true);
    await a.waitFor(() => a.room.status === 'waiting' && a.room.game === null);
    assert.equal(a.room.seats.length, 1);
  } finally {
    await s.close();
  }
});

test('真人之间交易', async () => {
  const s = await setup();
  try {
    const [ua, ub] = [await s.user('t1'), await s.user('t2')];
    const [a, b] = [await s.client(ua.token), await s.client(ub.token)];
    const { roomId } = await a.req('room:create', { maxPlayers: 2 });
    await b.req('room:join', { roomId });
    await b.req('room:ready', { ready: true });
    await a.req('room:start');
    const room = [...s.rooms.rooms.values()][0];
    const g = room.game;
    // 直接给两人分配地产，然后由当前玩家发起交易
    const curId = g.cur.id;
    const otherId = curId === ua.user.id ? ub.user.id : ua.user.id;
    const [cur, other] = curId === ua.user.id ? [a, b] : [b, a];
    g.state.tiles[1].owner = curId;
    g.state.tiles[3].owner = otherId;
    const r = await cur.req('game:action', { type: 'tradePropose', to: otherId, give: { money: 50, tiles: [1] }, get: { money: 0, tiles: [3] } });
    assert.equal(r.ok, true, r.error);
    await other.waitFor(() => other.room?.game?.trade?.to === otherId);
    assert.equal((await other.req('game:action', { type: 'tradeAccept' })).ok, true);
    await cur.waitFor(() => cur.room.game.trade === null && cur.room.game.tiles[3].owner === curId);
    assert.equal(cur.room.game.tiles[1].owner, otherId);
  } finally {
    await s.close();
  }
});
