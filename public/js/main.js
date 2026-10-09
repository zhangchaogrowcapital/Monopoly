// 应用入口：登录 → 大厅 → 房间 → 对局
import { h, $, $$, toast, modal } from './util.js';
import { api, session, Net } from './api.js';
import { openEditor } from './editor.js';
import { GameUI, showRules } from './gameui.js';
import { lookFor, renderIcon } from './three/faces.js';
import { CHARACTERS, CUSTOM_ID, EXPRESSIONS, SEAT_COLORS, characterById, MAX_PLAYERS, MIN_PLAYERS } from '/shared/characters.js';
import { sfx } from './sfx.js';

const ROUND_OPTIONS = [[0, '不限回合'], [20, '20 轮'], [30, '30 轮'], [50, '50 轮'], [80, '80 轮']];

const app = {
  me: null,
  net: new Net(),
  room: null,
  rooms: [],
  screen: null,
  stage: null,
  stageKind: null,
  gameUI: null,
  pendingJoin: new URLSearchParams(location.search).get('room'),

  show(name) {
    if (this.screen === name) return;
    this.screen = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    if (name !== 'auth' && this.stageKind === 'auth') this.dropStage();
    if (name !== 'room' && this.stageKind === 'room') this.dropStage();
    if (name !== 'game' && this.gameUI) { this.gameUI.destroy(); this.gameUI = null; }
  },

  dropStage() {
    this.stage?.destroy();
    this.stage = null;
    this.stageKind = null;
  },

  async useStage(kind, container) {
    if (this.stageKind === kind && this.stage) return this.stage;
    this.dropStage();
    const { Stage } = await import('./three/stage.js');
    if (this.screen !== kind) return null; // 加载期间已经切换了界面
    if (this.stageKind === kind && this.stage) return this.stage;
    this.dropStage();
    this.stage = new Stage(container, { interactive: true, labels: true });
    this.stageKind = kind;
    return this.stage;
  },

  leaveRoom() {
    this.net.request('room:leave').catch(() => {});
    this.room = null;
    history.replaceState(null, '', location.pathname);
    this.showLobby();
  },
};
window.app = app;

// ---------- 登录 ----------
let authMode = 'login';
function showAuth() {
  app.show('auth');
  const form = $('#form-auth');
  $$('#screen-auth .tabs button').forEach((b) => {
    b.onclick = () => {
      authMode = b.dataset.tab;
      $$('#screen-auth .tabs button').forEach((x) => x.classList.toggle('active', x === b));
      form.classList.toggle('register', authMode === 'register');
      form.querySelector('button[type=submit]').textContent = authMode === 'login' ? '登录' : '注册并登录';
      form.password.autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    };
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector('.error');
    err.textContent = '';
    const body = { username: form.username.value.trim(), password: form.password.value, nickname: form.nickname.value.trim() };
    try {
      const r = await api('POST', authMode === 'login' ? '/api/login' : '/api/register', body);
      session.token = r.token;
      onLoggedIn(r.user, authMode === 'register');
    } catch (e2) {
      err.textContent = e2.message;
    }
  };
  // 角色展示
  app.useStage('auth', $('#auth-stage')).then((stage) => {
    if (!stage) return;
    stage.setCharacters(CHARACTERS.map((c, k) => ({ key: c.id, characterId: c.id, name: c.name, color: SEAT_COLORS[k] })));
    const ids = Object.keys(EXPRESSIONS);
    clearInterval(app.authTimer);
    app.authTimer = setInterval(() => {
      if (app.stageKind !== 'auth') { clearInterval(app.authTimer); return; }
      const c = CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
      stage.expression(c.id, ids[1 + Math.floor(Math.random() * (ids.length - 1))]);
    }, 1400);
  });
}

function onLoggedIn(user, isNew) {
  app.me = user;
  connectSocket();
  showLobby();
  if (isNew) {
    toast(`欢迎你，${user.nickname}！先来设计你的角色吧`, 'success', 3500);
    setTimeout(() => openEditor(app.me, onProfileSaved), 500);
  }
}

function onProfileSaved(user) {
  app.me = user;
  renderMe();
  if (app.room && app.room.status === 'waiting') {
    app.net.request('room:character', { characterId: user.characterId }).catch(() => app.net.request('room:character', {}).catch(() => {}));
  }
}

// ---------- Socket ----------
function connectSocket() {
  const socket = app.net.connect(session.token);
  socket.on('connect', () => {
    $('#conn-banner').classList.remove('show');
    app.net.request('room:sync').then((r) => {
      if (r.room) onRoomState(r.room);
      else if (app.pendingJoin) joinRoom(app.pendingJoin);
      app.pendingJoin = null;
    }).catch(() => {});
  });
  socket.on('disconnect', () => { if (app.me) $('#conn-banner').classList.add('show'); });
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') logout();
    else $('#conn-banner').classList.add('show');
  });
}

app.net.on('lobby:rooms', (rooms) => { app.rooms = rooms; renderRoomList(); });
app.net.on('room:state', (room) => onRoomState(room));
app.net.on('game:update', (u) => app.gameUI?.onGameUpdate(u));
app.net.on('game:deadline', (d) => app.gameUI?.onDeadline(d));
app.net.on('chat', (m) => {
  if (app.room) {
    app.room.chat = [...(app.room.chat || []), m].slice(-60);
    if (app.gameUI) app.gameUI.onChat(m);
    else appendRoomChat(m);
  }
});
app.net.on('emote', (e) => {
  if (app.gameUI) app.gameUI.onEmote(e);
  else if (app.stageKind === 'room') { app.stage?.expression(e.playerId, e.expr); sfx.emote(); }
});
app.net.on('toast', (t) => toast(t));

function onRoomState(room) {
  const prev = app.room;
  app.room = room;
  if (!room) {
    if (app.screen === 'room' || app.screen === 'game') {
      if (prev) toast('你已离开房间');
      showLobby();
    }
    return;
  }
  if (new URLSearchParams(location.search).get('room') !== room.id) history.replaceState(null, '', `?room=${room.id}`);
  if (room.status === 'waiting') {
    showRoom(room);
  } else if (!app.gameUI) {
    app.show('game');
    app.gameUI = new GameUI(app);
    app.gameUI.mount(room);
  } else {
    app.gameUI.updateRoom(room);
  }
}

async function logout() {
  try { await api('POST', '/api/logout'); } catch { /* 忽略 */ }
  session.token = null;
  app.me = null;
  app.room = null;
  app.net.disconnect();
  history.replaceState(null, '', location.pathname);
  showAuth();
}

// ---------- 大厅 ----------
function iconCanvas(info, expr = 'neutral', size = 64) {
  const c = h('canvas', { width: size * 2, height: size * 2, style: { width: `${size}px`, height: `${size}px` } });
  renderIcon(c, lookFor(info), expr);
  return c;
}

function renderMe() {
  for (const el of $$('.me-chip')) {
    el.replaceChildren(iconCanvas(app.me, 'happy', 34), h('span', app.me.nickname));
    el.onclick = () => openEditor(app.me, onProfileSaved);
  }
}

function showLobby() {
  app.show('lobby');
  renderMe();
  renderRoomList();
  $('#btn-logout').onclick = logout;
  $('#btn-rules').onclick = showRules;
  $('#btn-editor').onclick = () => openEditor(app.me, onProfileSaved);
  const form = $('#form-create');
  if (!form.dataset.ready) {
    form.dataset.ready = '1';
    form.maxPlayers.replaceChildren(...Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, k) => {
      const n = k + MIN_PLAYERS;
      return h('option', { value: n, selected: n === 4 }, `${n} 人`);
    }));
    form.maxRounds.replaceChildren(...ROUND_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === 30 }, l)));
  }
  form.name.placeholder = `${app.me.nickname} 的房间`;
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await app.net.request('room:create', {
        name: form.name.value.trim(), maxPlayers: Number(form.maxPlayers.value), maxRounds: Number(form.maxRounds.value),
      });
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#btn-quick').onclick = async () => {
    try {
      await app.net.request('room:create', { name: `${app.me.nickname} 的练习赛`, maxPlayers: 4, maxRounds: 30 });
      for (let k = 0; k < 3; k++) await app.net.request('room:addBot');
      await app.net.request('room:start');
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#form-join').onsubmit = (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim().toUpperCase();
    if (code) joinRoom(code);
  };
  $('#btn-refresh').onclick = () => app.net.request('lobby:list').then((r) => { app.rooms = r.rooms; renderRoomList(); }).catch(() => {});
}

async function joinRoom(id) {
  try {
    await app.net.request('room:join', { roomId: id });
  } catch (err) {
    toast(err.message, 'error');
    history.replaceState(null, '', location.pathname);
  }
}

function renderRoomList() {
  const list = $('#room-list');
  if (!list || app.screen !== 'lobby') return;
  if (!app.rooms.length) {
    list.replaceChildren(h('div.empty', h('p', '还没有房间'), h('small', '创建一个房间，把邀请链接发给朋友吧！')));
    return;
  }
  list.replaceChildren(...app.rooms.map((r) => {
    const full = r.players >= r.maxPlayers;
    const playing = r.status !== 'waiting';
    return h('div.room-card',
      h('div.room-main',
        h('strong', r.name),
        h('small', `房主 ${r.host} · 房间号 ${r.id} · ${r.maxRounds ? `${r.maxRounds} 轮` : '不限回合'}`)),
      h(`span.tag${playing ? '.playing' : ''}`, playing ? '游戏中' : '等待中'),
      h('span.count', `${r.players}/${r.maxPlayers}`),
      h('button.btn.primary.small', { disabled: playing || full, onclick: () => joinRoom(r.id) }, full ? '已满' : '加入'));
  }));
}

// ---------- 房间 ----------
function showRoom(room) {
  const entering = app.screen !== 'room';
  app.show('room');
  renderMe();
  $('#room-title').textContent = room.name;
  $('#room-code').textContent = room.id;
  $('#btn-invite').onclick = async () => {
    const link = `${location.origin}${location.pathname}?room=${room.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast('邀请链接已复制，发给朋友吧！', 'success');
    } catch {
      modal('邀请朋友', h('div', h('p', '复制下面的链接发给朋友：'), h('input.copy', { value: link, readonly: true, onclick: (e) => e.target.select() })));
    }
  };
  $('#btn-leave').onclick = () => app.leaveRoom();
  if (entering) {
    $('#room-chat').replaceChildren();
    for (const m of room.chat || []) appendRoomChat(m);
    const form = $('#room-chat-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      app.net.request('chat:send', { text }).catch((err) => toast(err.message, 'error'));
      form.text.value = '';
    };
    $('#room-emotes').replaceChildren(...Object.entries(EXPRESSIONS).map(([id, e]) => h('button.emo', {
      title: e.name, onclick: () => app.net.request('game:emote', { expr: id }).catch(() => {}),
    }, e.emoji)));
  }
  renderRoom(room);
}

function renderRoom(room) {
  const isHost = room.hostId === app.me.id;
  const mySeat = room.seats.find((s) => s.id === app.me.id);
  const seatsBox = $('#room-seats');
  const rows = room.seats.map((s, k) => {
    const c = s.characterId === CUSTOM_ID ? '照片角色' : characterById(s.characterId)?.name;
    const state = s.id === room.hostId ? '👑 房主' : s.ready ? '✅ 已准备' : '⏳ 未准备';
    return h(`div.seat${s.id === app.me.id ? '.me' : ''}`,
      h('i.seat-color', { style: { background: SEAT_COLORS[k] } }),
      iconCanvas(s, 'neutral', 40),
      h('div.seat-info', h('strong', s.name, s.isBot ? h('span.tag', '电脑') : null, !s.connected && !s.isBot ? h('span.tag.off', '掉线') : null), h('small', c)),
      h('span.seat-state', state),
      isHost && s.id !== app.me.id ? h('button.icon-btn.kick', {
        title: '移出房间', onclick: () => app.net.request('room:kick', { seatId: s.id }).catch((e) => toast(e.message, 'error')),
      }, '✕') : null);
  });
  for (let k = room.seats.length; k < room.maxPlayers; k++) {
    rows.push(h('div.seat.empty',
      h('i.seat-color', { style: { background: SEAT_COLORS[k] } }),
      h('span', '等待玩家加入…'),
      isHost ? h('button.btn.small', { onclick: () => app.net.request('room:addBot').catch((e) => toast(e.message, 'error')) }, '+ 电脑玩家') : null));
  }
  seatsBox.replaceChildren(...rows);
  $('#room-count').textContent = `${room.seats.length}/${room.maxPlayers}`;

  // 角色选择
  const taken = new Map(room.seats.filter((s) => s.id !== app.me.id).map((s) => [s.characterId, s.name]));
  const choices = CHARACTERS.map((c) => {
    const by = taken.get(c.id);
    return h(`button.char-pick${mySeat?.characterId === c.id ? '.active' : ''}`, {
      disabled: !!by,
      title: by ? `已被 ${by} 选择` : c.name,
      onclick: () => app.net.request('room:character', { characterId: c.id }).catch((e) => toast(e.message, 'error')),
    }, iconCanvas({ characterId: c.id }, 'happy', 40), h('span', c.name));
  });
  choices.push(h(`button.char-pick${mySeat?.characterId === CUSTOM_ID ? '.active' : ''}`, {
    title: app.me.avatar ? '我的照片角色' : '上传照片定制角色',
    onclick: () => {
      if (!app.me.avatar) { openEditor(app.me, onProfileSaved); return; }
      app.net.request('room:character', { characterId: CUSTOM_ID }).catch((e) => toast(e.message, 'error'));
    },
  }, app.me.avatar ? iconCanvas({ characterId: CUSTOM_ID, avatar: app.me.avatar, custom: app.me.custom }, 'happy', 40) : h('div.plus', '📷'), h('span', app.me.avatar ? '我的照片' : '照片定制')));
  $('#room-chars').replaceChildren(...choices);

  // 房主设置
  const settings = $('#room-settings');
  if (isHost) {
    const players = h('select', { onchange: (e) => app.net.request('room:settings', { maxPlayers: Number(e.target.value) }).catch((err) => toast(err.message, 'error')) },
      Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, k) => k + MIN_PLAYERS).map((n) => h('option', { value: n, selected: n === room.maxPlayers }, `${n} 人`)));
    const rounds = h('select', { onchange: (e) => app.net.request('room:settings', { maxRounds: Number(e.target.value) }).catch((err) => toast(err.message, 'error')) },
      ROUND_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === room.maxRounds }, l)));
    settings.replaceChildren(h('label', '人数上限', players), h('label', '回合上限', rounds));
  } else {
    settings.replaceChildren(h('span.muted', `人数上限 ${room.maxPlayers} · ${room.maxRounds ? `${room.maxRounds} 轮` : '不限回合'}`));
  }

  // 操作按钮
  const actions = $('#room-actions');
  if (isHost) {
    const notReady = room.seats.filter((s) => !s.ready && s.id !== room.hostId).length;
    actions.replaceChildren(
      h('button.btn.big.primary', {
        disabled: room.seats.length < MIN_PLAYERS || notReady > 0,
        title: room.seats.length < MIN_PLAYERS ? '至少需要 2 名玩家，可以添加电脑' : notReady ? '还有玩家未准备' : '',
        onclick: () => { sfx.unlock(); app.net.request('room:start').catch((e) => toast(e.message, 'error')); },
      }, room.seats.length < MIN_PLAYERS ? '至少需要 2 人' : notReady ? `等待 ${notReady} 人准备` : '🎲 开始游戏'));
  } else {
    actions.replaceChildren(h(`button.btn.big${mySeat?.ready ? '' : '.primary'}`, {
      onclick: () => { sfx.unlock(); app.net.request('room:ready', { ready: !mySeat?.ready }).catch((e) => toast(e.message, 'error')); },
    }, mySeat?.ready ? '取消准备' : '✋ 准备'));
  }

  // 3D 展示台
  app.useStage('room', $('#room-stage')).then((stage) => {
    if (!stage) return;
    stage.setCharacters(room.seats.map((s, k) => ({
      key: s.id, characterId: s.characterId, custom: s.custom, avatar: s.avatar, name: s.name, color: SEAT_COLORS[k],
    })));
  });
}

function appendRoomChat(m) {
  const box = $('#room-chat');
  if (!box) return;
  box.append(m.system ? h('div.chat-line.system', m.text) : h('div.chat-line', h('b', `${m.name}：`), m.text));
  while (box.children.length > 80) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

// ---------- 启动 ----------
async function boot() {
  if (!session.token) { showAuth(); return; }
  try {
    const r = await api('GET', '/api/me');
    onLoggedIn(r.user, false);
  } catch {
    session.token = null;
    showAuth();
  }
}

document.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
boot();
