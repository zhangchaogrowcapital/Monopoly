// 房间、大厅与 Socket.IO 实时同步
import crypto from 'node:crypto';
import { Game } from './game/engine.js';
import { botAction } from './game/bot.js';
import { CHARACTERS, CUSTOM_ID, EXPRESSION_IDS, MAX_PLAYERS, MIN_PLAYERS } from '../shared/characters.js';

// 时间参数（毫秒），测试时可以调小
export const DEFAULT_TIMING = {
  turnTimeout: 60_000, // 每步操作的超时时间，超时自动托管
  disconnectGrace: 15_000, // 掉线多久后由电脑代打
  waitingKick: 30_000, // 等待中掉线多久后移出房间
  emptyRoomTtl: 10 * 60_000, // 所有真人都掉线后房间保留多久
  botThink: 900, // 电脑玩家的“思考”时间
  animScale: 1, // 等待客户端动画的比例
};
const BOT_NAMES = ['阿福', '小美', '大壮', '旺财', '招财', '如意', '吉祥'];
const ROUND_OPTIONS = [0, 20, 30, 50, 80];

const ACTIONS = new Set([
  'roll', 'buy', 'decline', 'endTurn', 'payFine', 'useCard', 'build', 'sell', 'mortgage', 'unmortgage',
  'bankrupt', 'tradePropose', 'tradeAccept', 'tradeReject', 'tradeCancel',
]);

const safeAck = (ack) => (typeof ack === 'function' ? ack : () => {});

/** 根据事件估算客户端动画时长，用于给电脑玩家留出观看时间 */
export function animDelay(events) {
  let ms = 0;
  for (const e of events) {
    if (e.type === 'dice') ms += 1400;
    else if (e.type === 'move') ms += Math.abs(e.steps) * 230 + 400;
    else if (e.type === 'jail') ms += 1200;
    else if (e.type === 'card') ms += 2200;
    else if (e.type === 'build' || e.type === 'buy') ms += 300;
  }
  return ms;
}

export class RoomManager {
  constructor(io, auth, timing = {}) {
    this.io = io;
    this.auth = auth;
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.rooms = new Map();
    this.userRoom = new Map();
    this.userSockets = new Map();
    this.lobbyTimer = null;

    io.use((socket, next) => {
      const user = auth.verify(socket.handshake.auth?.token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.userId = user.id;
      return next();
    });
    io.on('connection', (socket) => this.onConnection(socket));
  }

  user(socket) { return this.auth.users[socket.data.userId]; }

  /** 清理所有定时器（关闭服务时调用） */
  dispose() {
    this.disposed = true;
    clearTimeout(this.lobbyTimer);
    for (const room of this.rooms.values()) for (const t of Object.values(room.timers)) clearTimeout(t);
    this.rooms.clear();
  }

  // ---------- 连接管理 ----------
  onConnection(socket) {
    const uid = socket.data.userId;
    if (!this.userSockets.has(uid)) this.userSockets.set(uid, new Set());
    this.userSockets.get(uid).add(socket);

    const room = this.roomOf(uid);
    if (room) {
      socket.join(this.channel(room));
      this.setConnected(room, uid, true);
    }
    socket.emit('lobby:rooms', this.lobbyList());

    const on = (ev, fn) => socket.on(ev, (payload, ack) => {
      const reply = safeAck(typeof payload === 'function' ? payload : ack);
      try {
        const res = fn(typeof payload === 'function' ? {} : (payload || {}));
        reply(res || { ok: true });
      } catch (e) {
        reply({ ok: false, error: e.message || '出错了' });
      }
    });

    on('lobby:list', () => ({ ok: true, rooms: this.lobbyList() }));
    on('room:create', (p) => this.createRoom(socket, p));
    on('room:join', (p) => this.joinRoom(socket, String(p.roomId || '').toUpperCase()));
    on('room:leave', () => this.leaveRoom(uid));
    on('room:character', (p) => this.setCharacter(uid, p.characterId));
    on('room:ready', (p) => this.setReady(uid, !!p.ready));
    on('room:settings', (p) => this.setSettings(uid, p));
    on('room:addBot', () => this.addBot(uid));
    on('room:kick', (p) => this.kick(uid, String(p.seatId || '')));
    on('room:start', () => this.startGame(uid));
    on('room:reset', () => this.resetRoom(uid));
    on('room:sync', () => {
      const r = this.roomOf(uid);
      return { ok: true, room: r ? this.roomState(r) : null };
    });
    on('game:action', (p) => this.gameAction(uid, p));
    on('game:auto', (p) => this.setAuto(uid, !!p.on));
    on('game:emote', (p) => this.emote(uid, p.expr));
    on('chat:send', (p) => this.chat(uid, p.text));

    socket.on('disconnect', () => {
      const set = this.userSockets.get(uid);
      set?.delete(socket);
      if (set && set.size === 0) {
        this.userSockets.delete(uid);
        const r = this.roomOf(uid);
        if (r) this.setConnected(r, uid, false);
      }
    });
  }

  channel(room) { return `room:${room.id}`; }

  roomOf(uid) {
    const id = this.userRoom.get(uid);
    return id ? this.rooms.get(id) || null : null;
  }

  socketsOf(uid) { return [...(this.userSockets.get(uid) || [])]; }

  isOnline(uid) { return this.userSockets.has(uid); }

  // ---------- 大厅 ----------
  lobbyList() {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      host: r.seats.find((s) => s.id === r.hostId)?.name || '',
      players: r.seats.filter((s) => !s.left).length,
      maxPlayers: r.maxPlayers,
      status: r.status,
      maxRounds: r.maxRounds,
    })).sort((a, b) => (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1));
  }

  broadcastLobby() {
    if (this.disposed) return;
    clearTimeout(this.lobbyTimer);
    this.lobbyTimer = setTimeout(() => this.io.emit('lobby:rooms', this.lobbyList()), 200);
  }

  // ---------- 房间 ----------
  newRoomId() {
    let id;
    do { id = crypto.randomBytes(3).toString('hex').toUpperCase(); } while (this.rooms.has(id));
    return id;
  }

  pickCharacter(room, preferred, avatar) {
    const used = new Set(room.seats.filter((s) => !s.left).map((s) => s.characterId));
    if (preferred === CUSTOM_ID && avatar) return CUSTOM_ID;
    if (preferred && preferred !== CUSTOM_ID && !used.has(preferred)) return preferred;
    return CHARACTERS.find((c) => !used.has(c.id))?.id || CHARACTERS[0].id;
  }

  seatFromUser(room, user) {
    return {
      id: user.id,
      name: user.nickname,
      isBot: false,
      characterId: this.pickCharacter(room, user.characterId, user.avatar),
      custom: user.custom,
      avatar: user.avatar,
      ready: false,
      connected: true,
      auto: false,
      left: false,
      disconnectedAt: 0,
    };
  }

  createRoom(socket, { name, maxPlayers, maxRounds }) {
    const user = this.user(socket);
    if (this.roomOf(user.id)) this.leaveRoom(user.id);
    const room = {
      id: this.newRoomId(),
      name: String(name || `${user.nickname} 的房间`).trim().slice(0, 20) || `${user.nickname} 的房间`,
      hostId: user.id,
      maxPlayers: Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(maxPlayers) || 4)),
      maxRounds: ROUND_OPTIONS.includes(Number(maxRounds)) ? Number(maxRounds) : 30,
      status: 'waiting',
      seats: [],
      game: null,
      chat: [],
      timers: {},
      turnDeadline: 0,
      lastEmote: new Map(),
      emptySince: 0,
    };
    room.seats.push(this.seatFromUser(room, user));
    room.seats[0].ready = true;
    this.rooms.set(room.id, room);
    this.bindUser(user.id, room);
    this.systemChat(room, `${user.nickname} 创建了房间`);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true, roomId: room.id };
  }

  bindUser(uid, room) {
    this.userRoom.set(uid, room.id);
    for (const s of this.socketsOf(uid)) s.join(this.channel(room));
  }

  unbindUser(uid, room) {
    if (this.userRoom.get(uid) === room.id) this.userRoom.delete(uid);
    for (const s of this.socketsOf(uid)) {
      s.leave(this.channel(room));
      s.emit('room:state', null);
    }
  }

  joinRoom(socket, roomId) {
    const user = this.user(socket);
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('房间不存在');
    const current = this.roomOf(user.id);
    if (current && current.id === room.id) {
      this.broadcastRoom(room);
      return { ok: true, roomId: room.id };
    }
    const existing = room.seats.find((s) => s.id === user.id && !s.left);
    if (!existing) {
      if (room.status !== 'waiting') throw new Error('游戏已经开始，无法加入');
      if (room.seats.length >= room.maxPlayers) throw new Error('房间已满');
    }
    if (current) this.leaveRoom(user.id);
    if (!existing) {
      room.seats.push(this.seatFromUser(room, user));
      this.systemChat(room, `${user.nickname} 加入了房间`);
    }
    this.bindUser(user.id, room);
    this.setConnected(room, user.id, true);
    this.broadcastLobby();
    return { ok: true, roomId: room.id };
  }

  leaveRoom(uid) {
    const room = this.roomOf(uid);
    if (!room) return { ok: true };
    const seat = room.seats.find((s) => s.id === uid);
    this.unbindUser(uid, room);
    if (!seat) return { ok: true };
    if (room.status === 'playing') {
      seat.left = true;
      const r = room.game.forfeit(uid);
      this.systemChat(room, `${seat.name} 离开了游戏`);
      if (r.ok) this.afterGameChange(room, r.events);
    } else {
      room.seats = room.seats.filter((s) => s.id !== uid);
      this.systemChat(room, `${seat.name} 离开了房间`);
    }
    this.cleanupRoom(room);
    return { ok: true };
  }

  /** 房主转移 / 无人时删除房间 */
  cleanupRoom(room) {
    const humans = room.seats.filter((s) => !s.isBot && !s.left);
    if (!humans.length) {
      this.deleteRoom(room);
      return;
    }
    if (!humans.some((s) => s.id === room.hostId)) {
      const next = humans.find((s) => s.connected) || humans[0];
      room.hostId = next.id;
      next.ready = true;
      this.systemChat(room, `${next.name} 成为新房主`);
    }
    this.broadcastRoom(room);
    this.broadcastLobby();
  }

  deleteRoom(room) {
    for (const t of Object.values(room.timers)) clearTimeout(t);
    for (const s of room.seats) if (!s.isBot) this.unbindUser(s.id, room);
    this.rooms.delete(room.id);
    this.broadcastLobby();
  }

  hostRoom(uid) {
    const room = this.roomOf(uid);
    if (!room) throw new Error('你不在房间里');
    if (room.hostId !== uid) throw new Error('只有房主可以这样做');
    return room;
  }

  setConnected(room, uid, connected) {
    const seat = room.seats.find((s) => s.id === uid);
    if (!seat) return;
    seat.connected = connected;
    seat.disconnectedAt = connected ? 0 : Date.now();
    const gp = room.game?.player(uid);
    if (gp) gp.connected = connected;
    clearTimeout(room.timers[`dc:${uid}`]);
    if (!connected) {
      if (room.status === 'waiting') {
        room.timers[`dc:${uid}`] = setTimeout(() => {
          if (!seat.connected && this.roomOf(uid) === room) this.leaveRoom(uid);
        }, this.timing.waitingKick);
      } else if (room.status === 'playing') {
        room.timers[`dc:${uid}`] = setTimeout(() => this.schedule(room, []), this.timing.disconnectGrace + 50);
      }
    }
    // 所有真人都掉线：一段时间后清理房间
    const anyOnline = room.seats.some((s) => !s.isBot && !s.left && s.connected);
    clearTimeout(room.timers.empty);
    if (!anyOnline) room.timers.empty = setTimeout(() => this.rooms.has(room.id) && this.deleteRoom(room), this.timing.emptyRoomTtl);
    this.broadcastRoom(room);
    if (connected && room.status === 'playing') this.schedule(room, []);
  }

  setCharacter(uid, characterId) {
    const room = this.roomOf(uid);
    if (!room) throw new Error('你不在房间里');
    if (room.status !== 'waiting') throw new Error('游戏进行中不能换角色');
    const seat = room.seats.find((s) => s.id === uid);
    const user = this.auth.users[uid];
    // 同步最新的昵称、照片和定制
    seat.name = user.nickname;
    seat.avatar = user.avatar;
    seat.custom = user.custom;
    if (characterId !== undefined) {
      if (characterId === CUSTOM_ID) {
        if (!user.avatar) throw new Error('请先在“我的角色”里上传照片');
      } else {
        if (!CHARACTERS.some((c) => c.id === characterId)) throw new Error('无效的角色');
        if (room.seats.some((s) => s !== seat && !s.left && s.characterId === characterId)) throw new Error('这个角色已经被选了');
      }
      seat.characterId = characterId;
    } else if (seat.characterId === CUSTOM_ID && !user.avatar) {
      seat.characterId = this.pickCharacter(room, null, null);
    }
    this.broadcastRoom(room);
    return { ok: true };
  }

  setReady(uid, ready) {
    const room = this.roomOf(uid);
    if (!room || room.status !== 'waiting') throw new Error('现在不能准备');
    const seat = room.seats.find((s) => s.id === uid);
    seat.ready = ready || room.hostId === uid;
    this.broadcastRoom(room);
    return { ok: true };
  }

  setSettings(uid, { maxPlayers, maxRounds, name }) {
    const room = this.hostRoom(uid);
    if (room.status !== 'waiting') throw new Error('游戏已开始');
    if (maxPlayers !== undefined) {
      const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(maxPlayers) || 4));
      if (n < room.seats.length) throw new Error('人数上限不能小于当前人数');
      room.maxPlayers = n;
    }
    if (maxRounds !== undefined && ROUND_OPTIONS.includes(Number(maxRounds))) room.maxRounds = Number(maxRounds);
    if (name !== undefined && String(name).trim()) room.name = String(name).trim().slice(0, 20);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  addBot(uid) {
    const room = this.hostRoom(uid);
    if (room.status !== 'waiting') throw new Error('游戏已开始');
    if (room.seats.length >= room.maxPlayers) throw new Error('房间已满');
    const usedNames = new Set(room.seats.map((s) => s.name));
    const nick = BOT_NAMES.find((n) => !usedNames.has(`电脑·${n}`)) || `${room.seats.length}`;
    room.seats.push({
      id: `bot-${crypto.randomBytes(4).toString('hex')}`,
      name: `电脑·${nick}`,
      isBot: true,
      characterId: this.pickCharacter(room, null, null),
      custom: null,
      avatar: null,
      ready: true,
      connected: true,
      auto: true,
      left: false,
      disconnectedAt: 0,
    });
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  kick(uid, seatId) {
    const room = this.hostRoom(uid);
    if (room.status !== 'waiting') throw new Error('游戏已开始');
    if (seatId === uid) throw new Error('不能踢自己');
    const seat = room.seats.find((s) => s.id === seatId);
    if (!seat) throw new Error('玩家不存在');
    room.seats = room.seats.filter((s) => s.id !== seatId);
    if (!seat.isBot) {
      this.unbindUser(seatId, room);
      for (const s of this.socketsOf(seatId)) s.emit('toast', '你被房主移出了房间');
    }
    this.systemChat(room, `${seat.name} 被移出房间`);
    this.broadcastRoom(room);
    this.broadcastLobby();
    return { ok: true };
  }

  startGame(uid) {
    const room = this.hostRoom(uid);
    if (room.status !== 'waiting') throw new Error('游戏已开始');
    if (room.seats.length < MIN_PLAYERS) throw new Error(`至少需要 ${MIN_PLAYERS} 名玩家（可以添加电脑玩家）`);
    const notReady = room.seats.filter((s) => !s.ready && s.id !== room.hostId);
    if (notReady.length) throw new Error(`还有玩家未准备：${notReady.map((s) => s.name).join('、')}`);
    room.game = new Game(room.seats.map((s) => ({
      id: s.id, name: s.name, characterId: s.characterId, custom: s.custom, avatar: s.avatar, isBot: s.isBot,
    })), { maxRounds: room.maxRounds });
    for (const s of room.seats) {
      const gp = room.game.player(s.id);
      gp.connected = s.connected;
      gp.auto = s.isBot;
    }
    room.status = 'playing';
    this.systemChat(room, '游戏开始！祝大家好运 🎲');
    this.broadcastRoom(room);
    this.broadcastLobby();
    this.schedule(room, []);
    return { ok: true };
  }

  resetRoom(uid) {
    const room = this.hostRoom(uid);
    if (room.status !== 'ended') throw new Error('游戏还没结束');
    for (const t of Object.keys(room.timers)) if (!t.startsWith('dc:') && t !== 'empty') clearTimeout(room.timers[t]);
    room.game = null;
    room.status = 'waiting';
    room.turnDeadline = 0;
    room.seats = room.seats.filter((s) => !s.left && (s.isBot || s.connected));
    for (const s of room.seats) {
      if (!s.isBot) { s.ready = s.id === room.hostId; s.auto = false; }
    }
    this.systemChat(room, '房主开启了新的一局');
    this.cleanupRoom(room);
    return { ok: true };
  }

  roomState(room) {
    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      maxRounds: room.maxRounds,
      status: room.status,
      seats: room.seats.map(({ disconnectedAt, ...s }) => s),
      game: room.game ? room.game.state : null,
      turnDeadline: room.turnDeadline,
      chat: room.chat,
    };
  }

  broadcastRoom(room) {
    if (!this.rooms.has(room.id)) return;
    this.io.to(this.channel(room)).emit('room:state', this.roomState(room));
  }

  // ---------- 游戏 ----------
  gameAction(uid, payload) {
    const room = this.roomOf(uid);
    if (!room || room.status !== 'playing') throw new Error('游戏未在进行');
    const type = String(payload?.type || '');
    if (!ACTIONS.has(type)) throw new Error('未知操作');
    const action = { type };
    if (payload.tile !== undefined) action.tile = Number(payload.tile);
    if (type === 'tradePropose') {
      action.to = String(payload.to || '');
      action.give = { money: Number(payload.give?.money) || 0, tiles: (payload.give?.tiles || []).map(Number).slice(0, 40) };
      action.get = { money: Number(payload.get?.money) || 0, tiles: (payload.get?.tiles || []).map(Number).slice(0, 40) };
    }
    const r = room.game.act(uid, action);
    if (!r.ok) return r;
    // 玩家亲自操作，自动取消超时托管
    const gp = room.game.player(uid);
    const seat = room.seats.find((s) => s.id === uid);
    if (gp?.auto && seat && !seat.isBot && seat.autoByTimeout) {
      gp.auto = false;
      seat.auto = false;
      seat.autoByTimeout = false;
    }
    this.afterGameChange(room, r.events);
    return { ok: true };
  }

  setAuto(uid, on) {
    const room = this.roomOf(uid);
    if (!room || room.status !== 'playing') throw new Error('游戏未在进行');
    const seat = room.seats.find((s) => s.id === uid);
    const gp = room.game.player(uid);
    seat.auto = on;
    seat.autoByTimeout = false;
    gp.auto = on;
    this.systemChat(room, `${seat.name} ${on ? '开启' : '取消'}了托管`);
    this.broadcastRoom(room);
    this.schedule(room, []);
    return { ok: true };
  }

  afterGameChange(room, events) {
    this.io.to(this.channel(room)).emit('game:update', { state: room.game.state, events, turnDeadline: 0 });
    if (room.game.state.phase === 'ended') {
      room.status = 'ended';
      room.turnDeadline = 0;
      clearTimeout(room.timers.bot);
      clearTimeout(room.timers.deadline);
      const winner = room.game.player(room.game.state.winner);
      if (winner) this.systemChat(room, `🏆 恭喜 ${winner.name} 获得胜利！`);
      this.broadcastRoom(room);
      this.broadcastLobby();
      return;
    }
    this.schedule(room, events);
  }

  /** 由电脑代为操作的玩家：电脑、托管、掉线超过宽限期 */
  isBotControlled(room, playerId) {
    const gp = room.game.player(playerId);
    const seat = room.seats.find((s) => s.id === playerId);
    if (!gp || !seat) return true;
    if (seat.isBot || gp.auto || seat.left) return true;
    return !seat.connected && Date.now() - seat.disconnectedAt >= this.timing.disconnectGrace;
  }

  /** 安排下一步：电脑玩家延迟行动，真人玩家设置超时 */
  schedule(room, events) {
    if (this.disposed || !room.game || room.status !== 'playing') return;
    clearTimeout(room.timers.bot);
    clearTimeout(room.timers.deadline);
    const s = room.game.state;
    const actorId = s.trade ? s.trade.to : room.game.cur.id;
    const delay = animDelay(events) * this.timing.animScale;
    if (this.isBotControlled(room, actorId)) {
      room.turnDeadline = 0;
      room.timers.bot = setTimeout(() => this.botStep(room, actorId), delay + this.timing.botThink);
    } else {
      room.turnDeadline = Date.now() + delay + this.timing.turnTimeout;
      room.timers.deadline = setTimeout(() => this.onTimeout(room, actorId), delay + this.timing.turnTimeout);
    }
    this.io.to(this.channel(room)).emit('game:deadline', { turnDeadline: room.turnDeadline, actorId });
  }

  botStep(room, actorId) {
    if (!this.rooms.has(room.id) || room.status !== 'playing') return;
    const action = botAction(room.game, actorId);
    if (!action) { this.schedule(room, []); return; }
    let r = room.game.act(actorId, action);
    if (!r.ok) {
      // 兜底：防止 AI 卡死
      console.warn('[bot] action failed', action, r.error);
      r = room.game.act(actorId, { type: room.game.state.stage === 'buy' ? 'decline' : 'endTurn' });
      if (!r.ok) r = room.game.act(actorId, { type: 'bankrupt' });
      if (!r.ok) return;
    }
    this.afterGameChange(room, r.events);
  }

  onTimeout(room, actorId) {
    if (!this.rooms.has(room.id) || room.status !== 'playing') return;
    const seat = room.seats.find((s) => s.id === actorId);
    const gp = room.game.player(actorId);
    if (seat && gp && !seat.isBot) {
      seat.auto = true;
      seat.autoByTimeout = true;
      gp.auto = true;
      this.systemChat(room, `${seat.name} 操作超时，已自动托管`);
      this.broadcastRoom(room);
    }
    this.botStep(room, actorId);
  }

  // ---------- 表情与聊天 ----------
  emote(uid, expr) {
    const room = this.roomOf(uid);
    if (!room) throw new Error('你不在房间里');
    if (!EXPRESSION_IDS.includes(expr)) throw new Error('无效的表情');
    const last = room.lastEmote.get(uid) || 0;
    if (Date.now() - last < 500) return { ok: true };
    room.lastEmote.set(uid, Date.now());
    this.io.to(this.channel(room)).emit('emote', { playerId: uid, expr });
    return { ok: true };
  }

  chat(uid, text) {
    const room = this.roomOf(uid);
    if (!room) throw new Error('你不在房间里');
    text = String(text || '').trim().slice(0, 200);
    if (!text) return { ok: true };
    const key = `chat:${uid}`;
    const last = room.lastEmote.get(key) || 0;
    if (Date.now() - last < 400) throw new Error('说得太快了，歇一下');
    room.lastEmote.set(key, Date.now());
    const seat = room.seats.find((s) => s.id === uid);
    this.pushChat(room, { from: uid, name: seat?.name || '?', text, t: Date.now() });
    return { ok: true };
  }

  systemChat(room, text) {
    this.pushChat(room, { from: null, name: '系统', text, t: Date.now(), system: true });
  }

  pushChat(room, msg) {
    room.chat.push(msg);
    if (room.chat.length > 60) room.chat.splice(0, room.chat.length - 60);
    this.io.to(this.channel(room)).emit('chat', msg);
  }
}
