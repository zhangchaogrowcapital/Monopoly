// 对局界面（HUD）：玩家面板、操作按钮、地产卡、资产管理、交易、日志聊天、表情、结算
import { h, $, modal, toast, confirmBox, money } from './util.js';
import { TILES, GROUPS, STATION_RENT, JAIL_FINE, isOwnable, mortgageValue, unmortgageCost } from '/shared/board.js';
import { EXPRESSIONS } from '/shared/characters.js';
import * as rules from '/shared/rules.js';
import { lookFor, renderIcon } from './three/faces.js';
import { Game3D } from './three/game3d.js';
import { sfx } from './sfx.js';

const TURN_TIMEOUT = 60_000;
const HOUSE_LABELS = ['空地', '1 栋房', '2 栋房', '3 栋房', '4 栋房', '酒店'];

export class GameUI {
  constructor(app) {
    this.app = app;
    this.net = app.net;
    this.myId = app.me.id;
    this.view = null;
    this.busy = false;
    this.pending = false;
    this.deadline = { turnDeadline: 0, actorId: null };
    this.cards = new Map();
    this.displayMoney = new Map();
    this.openPanels = new Set();
    this.tradeModal = null;
    this.overModal = null;
    this.overShown = false;
    this.seatFlags = new Map();
  }

  // ---------- 生命周期 ----------
  mount(room) {
    this.root = $('#screen-game');
    this.room = room;
    this.updateSeatFlags(room);
    const g = room.game;
    this.deadline = { turnDeadline: room.turnDeadline, actorId: g.trade ? g.trade.to : g.players[g.current]?.id };
    this.game3d = new Game3D($('#game-canvas'), {
      myId: this.myId,
      onTileClick: (i) => this.showTile(i),
      onState: (s) => this.onState(s),
      onEvent: (ev, fast) => this.onEvent(ev, fast),
      onBusy: (b) => { this.busy = b; this.renderActions(); },
    });
    this.buildStatic();
    $('#hud-log').replaceChildren();
    for (const l of room.game.log.slice(-30)) this.appendLog(l.text);
    $('#hud-chat').replaceChildren();
    for (const m of room.chat || []) this.appendChat(m);
    this.game3d.enqueue({ state: room.game, events: [] });
    this.timer = setInterval(() => this.renderTimer(), 250);
  }

  destroy() {
    clearInterval(this.timer);
    this.game3d?.destroy();
    this.game3d = null;
    this.tradeModal?.close();
    this.overModal?.close();
    for (const p of this.openPanels) p.close();
    $('#hud-players').replaceChildren();
    $('#hud-actions').replaceChildren();
    $('#hud-deed').replaceChildren();
    this.cards.clear();
  }

  buildStatic() {
    const emotes = $('#hud-emotes');
    emotes.replaceChildren(
      h('button.emote-toggle', { onclick: () => emotes.classList.toggle('open'), title: '表情' }, '😀'),
      h('div.emote-list', Object.entries(EXPRESSIONS).map(([id, e]) => h('button.emo', {
        title: e.name,
        onclick: () => {
          this.net.request('game:emote', { expr: id }).catch((err) => toast(err.message, 'error'));
          emotes.classList.remove('open');
        },
      }, e.emoji))),
    );
    const feed = $('#hud-feed');
    feed.classList.toggle('open', window.innerWidth > 820);
    feed.querySelectorAll('.feed-tabs button').forEach((b) => {
      b.onclick = () => {
        feed.dataset.tab = b.dataset.tab;
        feed.classList.add('open');
        if (b.dataset.tab === 'chat') feed.querySelector('.chat-dot')?.classList.remove('on');
      };
    });
    feed.querySelector('.feed-collapse').onclick = () => feed.classList.toggle('open');
    const form = $('#hud-chat-form');
    form.onsubmit = (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      this.net.request('chat:send', { text }).catch((err) => toast(err.message, 'error'));
      input.value = '';
    };
    $('#btn-follow').onclick = (e) => {
      const on = !this.game3d.follow;
      this.game3d.setFollow(on);
      e.currentTarget.classList.toggle('off', !on);
      toast(on ? '镜头跟随：开' : '镜头跟随：关');
    };
    $('#btn-view').onclick = () => this.game3d.resetView();
    $('#btn-sound').onclick = (e) => {
      const on = sfx.toggle();
      e.currentTarget.textContent = on ? '🔊' : '🔇';
    };
    $('#btn-sound').textContent = sfx.enabled ? '🔊' : '🔇';
    $('#btn-menu').onclick = () => this.showMenu();
  }

  // ---------- 外部输入 ----------
  updateRoom(room) {
    this.room = room;
    this.updateSeatFlags(room);
    if (!this.busy && this.view && room.game) {
      // 同步在线/托管等标记
      for (const p of room.game.players) {
        const v = this.view.players.find((x) => x.id === p.id);
        if (v) { v.connected = p.connected; v.auto = p.auto; }
      }
    }
    this.renderPlayers();
    this.renderActions();
  }

  updateSeatFlags(room) {
    for (const s of room.seats) this.seatFlags.set(s.id, { connected: s.connected, auto: s.auto, isBot: s.isBot, left: s.left });
  }

  onGameUpdate(update) { this.game3d?.enqueue(update); }

  onDeadline(d) { this.deadline = d; this.renderTimer(); }

  onEmote({ playerId, expr }) {
    this.game3d?.emote(playerId, expr);
    this.updateIcon(playerId, expr);
  }

  onChat(msg) {
    this.appendChat(msg);
    const feed = $('#hud-feed');
    if (feed.dataset.tab !== 'chat' || !feed.classList.contains('open')) feed.querySelector('.chat-dot')?.classList.add('on');
  }

  // ---------- 状态与事件 ----------
  me(state = this.view) { return state?.players.find((p) => p.id === this.myId); }

  player(id, state = this.view) { return state?.players.find((p) => p.id === id); }

  onEvent(ev, fast) {
    switch (ev.type) {
      case 'money': {
        const cur = this.displayMoney.get(ev.playerId) ?? 0;
        this.displayMoney.set(ev.playerId, cur + ev.delta);
        this.renderMoney(ev.playerId, ev.delta);
        break;
      }
      case 'expr':
        this.updateIcon(ev.playerId, ev.expr);
        break;
      case 'card':
        if (!fast) this.showCard(ev);
        break;
      case 'log':
        this.appendLog(ev.text);
        break;
      case 'trade':
        if (ev.status === 'rejected' && ev.from === this.myId) toast('对方拒绝了你的交易', 'error');
        if (ev.status === 'accepted' && ev.from === this.myId) toast('对方接受了你的交易 🤝', 'success');
        break;
      default:
        break;
    }
  }

  onState(state) {
    const first = !this.view;
    this.view = state;
    for (const p of state.players) this.displayMoney.set(p.id, p.money);
    if (first) this.renderPlayers(true);
    this.renderPlayers();
    this.renderActions();
    this.renderRound();
    this.syncTradeModal();
    for (const p of this.openPanels) p.refresh?.();
    if (state.phase === 'ended' && !this.overShown) {
      this.overShown = true;
      setTimeout(() => this.showGameOver(), 800);
    }
  }

  async act(type, extra = {}) {
    if (this.pending) return;
    sfx.unlock();
    this.pending = true;
    this.renderActions();
    try {
      await this.net.request('game:action', { type, ...extra });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      this.pending = false;
      this.renderActions();
    }
  }

  canManage() {
    const s = this.view;
    return s && s.phase === 'playing' && !this.busy && s.players[s.current].id === this.myId
      && ['roll', 'buy', 'end'].includes(s.stage);
  }

  // ---------- 玩家面板 ----------
  renderPlayers(rebuild = false) {
    const s = this.view;
    if (!s) return;
    const box = $('#hud-players');
    if (rebuild) { box.replaceChildren(); this.cards.clear(); }
    s.players.forEach((p, idx) => {
      let card = this.cards.get(p.id);
      if (!card) {
        const canvas = h('canvas.pic', { width: 96, height: 96 });
        card = h('div.pcard', { onclick: () => this.showPlayer(p.id) },
          h('div.avatar', { style: { borderColor: p.color } }, canvas),
          h('div.pinfo', h('div.pname'), h('div.pmoney')),
          h('div.badges'));
        card.canvas = canvas;
        card.look = lookFor(p);
        renderIcon(canvas, card.look, 'neutral');
        this.cards.set(p.id, card);
        box.append(card);
      }
      const flags = this.seatFlags.get(p.id) || {};
      const isCur = s.phase === 'playing' && idx === s.current;
      card.classList.toggle('current', isCur);
      card.classList.toggle('bankrupt', p.bankrupt);
      card.classList.toggle('me', p.id === this.myId);
      card.style.setProperty('--pc', p.color);
      card.querySelector('.pname').textContent = `${p.name}${p.id === this.myId ? '（我）' : ''}`;
      card.querySelector('.pmoney').textContent = p.bankrupt ? '已破产' : money(this.displayMoney.get(p.id) ?? p.money);
      card.querySelector('.pmoney').classList.toggle('neg', (this.displayMoney.get(p.id) ?? p.money) < 0);
      const owned = s.tiles.filter((t) => t.owner === p.id).length;
      const badges = [];
      if (s.winner === p.id) badges.push(['🏆', '胜利者']);
      if (p.inJail) badges.push(['🔒', '在监狱中']);
      if (p.jailCards) badges.push([`🎫${p.jailCards > 1 ? p.jailCards : ''}`, '出狱卡']);
      if (flags.isBot || p.isBot) badges.push(['💻', '电脑玩家']);
      else if (p.auto) badges.push(['🤖', '托管中']);
      if (!flags.isBot && flags.connected === false && !p.bankrupt) badges.push(['📴', '掉线']);
      if (owned) badges.push([`🏠${owned}`, `${owned} 块地产`]);
      card.querySelector('.badges').replaceChildren(...badges.map(([t, title]) => h('span', { title }, t)));
    });
  }

  renderMoney(playerId, delta) {
    const card = this.cards.get(playerId);
    if (!card) return;
    const m = card.querySelector('.pmoney');
    const v = this.displayMoney.get(playerId);
    m.textContent = money(v);
    m.classList.toggle('neg', v < 0);
    m.classList.remove('up', 'down');
    void m.offsetWidth;
    m.classList.add(delta > 0 ? 'up' : 'down');
  }

  updateIcon(playerId, expr) {
    const card = this.cards.get(playerId);
    if (!card) return;
    renderIcon(card.canvas, card.look, expr);
    clearTimeout(card.exprT);
    card.exprT = setTimeout(() => renderIcon(card.canvas, card.look, this.player(playerId)?.bankrupt ? 'sad' : 'neutral'), 3200);
  }

  renderRound() {
    const s = this.view;
    const el = $('#hud-round');
    el.textContent = s.maxRounds ? `第 ${Math.min(s.round, s.maxRounds)} / ${s.maxRounds} 轮` : `第 ${s.round} 轮`;
  }

  renderTimer() {
    const el = $('#hud-timer');
    const { turnDeadline, actorId } = this.deadline;
    const left = turnDeadline - Date.now();
    if (!turnDeadline || left <= 0 || !this.view || this.view.phase !== 'playing') {
      el.classList.remove('show');
      return;
    }
    el.classList.add('show');
    const mine = actorId === this.myId;
    el.classList.toggle('mine', mine);
    el.classList.toggle('urgent', left < 10_000);
    el.querySelector('i').style.width = `${Math.max(0, Math.min(1, left / TURN_TIMEOUT)) * 100}%`;
    const who = mine ? '你' : this.player(actorId)?.name || '';
    el.querySelector('span').textContent = `${who} 剩余 ${Math.ceil(left / 1000)} 秒`;
  }

  // ---------- 操作区 ----------
  renderActions() {
    const s = this.view;
    const box = $('#hud-actions');
    const status = $('#hud-status');
    const deedBox = $('#hud-deed');
    if (!s) return;
    const me = this.me();
    const cur = s.players[s.current];
    const myTurn = cur?.id === this.myId && s.phase === 'playing';
    const disabled = this.busy || this.pending;
    const btns = [];
    let text = '';
    deedBox.replaceChildren();

    const B = (label, onclick, cls = '', opts = {}) => h(`button.btn.act${cls}`, { onclick, disabled: disabled || opts.disabled, title: opts.title || '' }, label);

    if (s.phase === 'ended') {
      const w = this.player(s.winner);
      text = w ? `🏆 ${w.name} 获得胜利！` : '游戏结束';
      btns.push(B('📊 查看结算', () => this.showGameOver(), '.primary'));
    } else if (s.trade && s.trade.to === this.myId) {
      text = `${this.player(s.trade.from)?.name} 向你发起了交易`;
      btns.push(B('查看交易', () => this.syncTradeModal(true), '.primary'));
    } else if (s.trade) {
      const from = this.player(s.trade.from);
      const to = this.player(s.trade.to);
      text = `${from?.name} 向 ${to?.name} 发起交易，等待回应…`;
      if (s.trade.from === this.myId) btns.push(B('取消交易', () => this.act('tradeCancel')));
    } else if (myTurn && me) {
      const neg = me.money < 0;
      switch (s.stage) {
        case 'roll':
          if (neg) {
            text = '⚠️ 你的资金为负！请抵押地产/卖房筹钱，或宣告破产';
          } else if (me.inJail) {
            text = `你在监狱中（第 ${me.jailTurns + 1} 次尝试）：掷出双数即可出狱`;
            btns.push(B('🎲 掷骰子（求双数）', () => this.act('roll'), '.primary.big'));
            btns.push(B(`交保释金 ¥${JAIL_FINE}`, () => this.act('payFine'), '', { disabled: me.money < JAIL_FINE }));
            if (me.jailCards > 0) btns.push(B('🎫 使用出狱卡', () => this.act('useCard')));
          } else {
            text = s.extraRoll ? '掷出了双数，再掷一次！' : '轮到你了，掷骰子吧！';
            btns.push(B('🎲 掷骰子', () => this.act('roll'), '.primary.big'));
          }
          break;
        case 'buy': {
          const tile = TILES[s.pendingTile];
          text = `要买下 ${tile.name} 吗？`;
          deedBox.append(this.deed(s.pendingTile, true));
          btns.push(B(`💰 购买 ${money(tile.price)}`, () => this.act('buy'), '.primary.big', {
            disabled: me.money < tile.price, title: me.money < tile.price ? '钱不够，可以先抵押其他地产' : '',
          }));
          btns.push(B('放弃', () => this.act('decline')));
          break;
        }
        case 'end':
          text = neg ? '⚠️ 你的资金为负！请抵押地产/卖房筹钱，或宣告破产' : '可以建房、交易，或结束回合';
          btns.push(B('✅ 结束回合', () => this.act('endTurn'), '.primary.big', { disabled: neg }));
          break;
        default:
          break;
      }
      if (neg) btns.push(B('💥 宣告破产', async () => {
        if (await confirmBox('确定要宣告破产吗？你的资产会归债主所有，并退出本局。', { danger: true, ok: '宣告破产' })) this.act('bankrupt');
      }, '.danger'));
      btns.push(B('🏠 资产', () => this.showAssets()));
      btns.push(B('🤝 交易', () => this.showTrade()));
    } else if (cur) {
      const tile = s.pendingTile != null ? TILES[s.pendingTile] : null;
      text = {
        roll: `等待 ${cur.name} 掷骰子…`,
        buy: `${cur.name} 正在考虑是否购买 ${tile?.name || ''}`,
        end: `${cur.name} 的回合`,
      }[s.stage] || `${cur.name} 的回合`;
      if (s.stage === 'buy' && tile) deedBox.append(this.deed(s.pendingTile, true));
      if (me && !me.bankrupt) btns.push(B('🏠 资产', () => this.showAssets()));
    }
    if (me && !me.bankrupt && s.phase === 'playing') {
      btns.push(h(`button.btn.act.ghost${me.auto ? '.on' : ''}`, {
        onclick: () => this.net.request('game:auto', { on: !me.auto }).catch((e) => toast(e.message, 'error')),
        title: '托管后由电脑代你操作',
      }, me.auto ? '🤖 取消托管' : '🤖 托管'));
    }
    if (me?.bankrupt && s.phase === 'playing') text = `${text}（你已破产，正在观战）`;
    status.textContent = text;
    box.replaceChildren(...btns);
  }

  // ---------- 地产卡 ----------
  deed(i, compact = false) {
    const s = this.view;
    const tile = TILES[i];
    const ts = s.tiles[i];
    const owner = ts.owner ? this.player(ts.owner) : null;
    const rows = [];
    if (tile.type === 'property') {
      const full = owner && rules.ownsGroup(s, owner.id, tile.group);
      tile.rent.forEach((r, k) => {
        const active = owner && !ts.mortgaged && ts.houses === k;
        const label = k === 0 ? (full ? '租金（同色全收集 ×2）' : '租金') : HOUSE_LABELS[k];
        rows.push(h(`div.rent-row${active ? '.active' : ''}`, h('span', label), h('b', money(k === 0 && full ? r * 2 : r))));
      });
      if (!compact) rows.push(h('div.rent-row.sub', h('span', '每栋房造价'), h('b', money(tile.houseCost))));
    } else if (tile.type === 'station') {
      const n = owner ? rules.countOwned(s, owner.id, 'station') : 0;
      STATION_RENT.forEach((r, k) => rows.push(h(`div.rent-row${n === k + 1 ? '.active' : ''}`, h('span', `拥有 ${k + 1} 个车站`), h('b', money(r)))));
    } else if (tile.type === 'utility') {
      const n = owner ? rules.countOwned(s, owner.id, 'utility') : 0;
      rows.push(h(`div.rent-row${n === 1 ? '.active' : ''}`, h('span', '拥有 1 个'), h('b', '骰子点数 ×4')));
      rows.push(h(`div.rent-row${n === 2 ? '.active' : ''}`, h('span', '拥有 2 个'), h('b', '骰子点数 ×10')));
    } else {
      const desc = {
        go: '每次经过或停在起点，领取 ¥200 工资。',
        jail: '路过只是探监。坐牢时可以掷双数、交 ¥50 或用出狱卡出狱，最多关 3 轮。',
        parking: '免费休息一下，什么也不会发生。',
        gotojail: '直接进监狱，不经过起点，不领工资！',
        chance: '抽一张机会卡，可能是好运也可能是厄运。',
        fate: '抽一张命运卡，听天由命吧。',
        tax: `缴纳 ¥${tile.amount} 给银行。`,
      }[tile.type];
      rows.push(h('p.desc', desc));
    }
    const color = tile.group ? GROUPS[tile.group].color : '#8a8f98';
    return h(`div.deed${compact ? '.compact' : ''}`,
      h('div.deed-band', { style: { background: color } }, h('small', tile.type === 'property' ? '地产' : { station: '车站', utility: '公用事业' }[tile.type] || ''), h('strong', tile.name)),
      tile.price ? h('div.deed-price', `价格 ${money(tile.price)}`) : null,
      ...rows,
      isOwnable(tile) && !compact ? h('div.rent-row.sub', h('span', '抵押可得'), h('b', money(mortgageValue(tile)))) : null,
      isOwnable(tile) ? h('div.deed-owner', owner
        ? h('span', h('i', { style: { background: owner.color } }), `主人：${owner.name}${ts.mortgaged ? '（已抵押）' : ''}`)
        : '无主地产，可以购买') : null);
  }

  manageButtons(i, onDone) {
    const s = this.view;
    const tile = TILES[i];
    const ts = s.tiles[i];
    if (ts.owner !== this.myId) return null;
    const can = this.canManage();
    const why = can ? null : '只能在自己的回合操作';
    const mk = (label, type, err) => h('button.btn.small', {
      disabled: !can || !!err || this.pending,
      title: why || err || '',
      onclick: async () => { await this.act(type, { tile: i }); onDone?.(); },
    }, label);
    const btns = [];
    if (tile.type === 'property') {
      btns.push(mk(`🏠 建房 -${money(tile.houseCost)}`, 'build', rules.checkBuild(s, this.myId, i)));
      btns.push(mk(`卖房 +${money(Math.floor(tile.houseCost / 2))}`, 'sell', rules.checkSell(s, this.myId, i)));
    }
    if (ts.mortgaged) btns.push(mk(`赎回 -${money(unmortgageCost(tile))}`, 'unmortgage', rules.checkUnmortgage(s, this.myId, i)));
    else btns.push(mk(`抵押 +${money(mortgageValue(tile))}`, 'mortgage', rules.checkMortgage(s, this.myId, i)));
    return h('div.manage', btns);
  }

  /** 打开可自动刷新的面板 */
  panel(title, renderFn, opts = {}) {
    const body = h('div');
    const entry = {};
    const m = modal(title, body, { ...opts, onClose: () => this.openPanels.delete(entry) });
    entry.close = m.close;
    entry.refresh = () => body.replaceChildren(renderFn(m.close));
    entry.refresh();
    this.openPanels.add(entry);
    return entry;
  }

  showTile(i) {
    if (!this.view) return;
    this.game3d.board.setHighlight(i);
    this.panel(TILES[i].name, () => h('div', this.deed(i), this.manageButtons(i)));
  }

  showPlayer(id) {
    const s = this.view;
    if (!s) return;
    const p = this.player(id);
    this.panel(p.name, () => {
      const list = TILES.filter((t) => s.tiles[t.index].owner === id);
      return h('div.player-info',
        h('div.row', h('span', `现金 ${money(p.money)}`), h('span', `总资产 ${money(rules.netWorth(s, id))}`)),
        list.length ? h('div.asset-list', list.map((t) => this.assetRow(t.index, false))) : h('p.muted', '还没有地产'));
    });
  }

  assetRow(i, withManage) {
    const s = this.view;
    const t = TILES[i];
    const ts = s.tiles[i];
    const color = t.group ? GROUPS[t.group].color : '#8a8f98';
    return h('div.asset-row',
      h('i.dot', { style: { background: color } }),
      h('span.aname', { onclick: () => this.showTile(i) }, t.name),
      h('span.astate', ts.mortgaged ? '已抵押' : ts.houses === 5 ? '🏨 酒店' : ts.houses ? `🏠×${ts.houses}` : ''),
      withManage ? this.manageButtons(i) : null);
  }

  showAssets() {
    this.panel('我的资产', () => {
      const s = this.view;
      const me = this.me();
      const list = TILES.filter((t) => s.tiles[t.index].owner === this.myId);
      return h('div.assets',
        h('div.row', h('span', `现金 ${money(me.money)}`), h('span', `总资产 ${money(rules.netWorth(s, this.myId))}`)),
        h('p.muted', '集齐同色全部地产后才能建房，且需均衡建设。抵押可以快速换现金。'),
        list.length ? h('div.asset-list', list.map((t) => this.assetRow(t.index, true))) : h('p.muted', '你还没有地产'));
    }, { wide: true });
  }

  // ---------- 交易 ----------
  showTrade() {
    const s = this.view;
    const others = s.players.filter((p) => p.id !== this.myId && !p.bankrupt);
    if (!others.length) return;
    let target = others[0].id;
    const give = { money: 0, tiles: new Set() };
    const get = { money: 0, tiles: new Set() };
    const entry = this.panel('发起交易', (close) => {
      const st = this.view;
      const me = this.me(st);
      const them = this.player(target, st);
      const side = (owner, sel, title) => {
        const tiles = TILES.filter((t) => st.tiles[t.index].owner === owner.id);
        const moneyInput = h('input', { type: 'number', min: 0, max: Math.max(0, owner.money), step: 10, value: sel.money || '' });
        moneyInput.addEventListener('input', () => { sel.money = Math.max(0, Math.floor(Number(moneyInput.value) || 0)); });
        return h('div.trade-side',
          h('h4', title),
          h('label.field', `现金（最多 ${money(Math.max(0, owner.money))}）`, moneyInput),
          tiles.length ? h('div.trade-tiles', tiles.map((t) => {
            const ok = rules.tradable(st, t.index);
            const cb = h('input', { type: 'checkbox', checked: sel.tiles.has(t.index), disabled: !ok });
            cb.addEventListener('change', () => { if (cb.checked) sel.tiles.add(t.index); else sel.tiles.delete(t.index); });
            return h(`label.trade-tile${ok ? '' : '.disabled'}`, { title: ok ? '' : '同色地产上有房子，不能交易' },
              cb, h('i.dot', { style: { background: t.group ? GROUPS[t.group].color : '#8a8f98' } }), t.name,
              st.tiles[t.index].mortgaged ? h('small', '（已抵押）') : null);
          })) : h('p.muted', '没有地产'));
      };
      return h('div.trade',
        h('div.tabs', others.map((o) => h(`button${o.id === target ? '.active' : ''}`, {
          onclick: () => { target = o.id; give.tiles.clear(); get.tiles.clear(); give.money = 0; get.money = 0; entry.refresh(); },
        }, o.name))),
        h('div.trade-cols', side(me, give, '我给出'), side(them, get, `我想要（${them.name}）`)),
        h('div.row.end',
          h('button.btn', { onclick: close }, '取消'),
          h('button.btn.primary', {
            disabled: !this.canManage() || !!st.trade,
            onclick: async () => {
              await this.act('tradePropose', {
                to: target,
                give: { money: give.money, tiles: [...give.tiles] },
                get: { money: get.money, tiles: [...get.tiles] },
              });
              if (this.view.trade) { toast('交易请求已发送'); close(); }
            },
          }, '发送交易请求')));
    }, { wide: true });
  }

  syncTradeModal(force = false) {
    const t = this.view?.trade;
    if (!t || t.to !== this.myId) {
      this.tradeModal?.close();
      this.tradeModal = null;
      return;
    }
    if (this.tradeModal && !force) return;
    this.tradeModal?.close();
    const from = this.player(t.from);
    const list = (side) => h('ul.trade-list',
      side.money ? h('li', `💰 ${money(side.money)}`) : null,
      side.tiles.map((i) => h('li', h('i.dot', { style: { background: TILES[i].group ? GROUPS[TILES[i].group].color : '#8a8f98' } }), TILES[i].name,
        this.view.tiles[i].mortgaged ? '（已抵押）' : '')),
      !side.money && !side.tiles.length ? h('li.muted', '无') : null);
    sfx.card();
    this.tradeModal = modal('收到交易请求', (close) => h('div.trade-offer',
      h('p', `${from?.name} 想和你交易：`),
      h('div.trade-cols',
        h('div.trade-side', h('h4', '你将得到'), list(t.give)),
        h('div.trade-side', h('h4', '你需要给出'), list(t.get))),
      h('div.row.end',
        h('button.btn.danger', { onclick: () => { this.act('tradeReject'); close(); } }, '拒绝'),
        h('button.btn.primary', { onclick: () => { this.act('tradeAccept'); close(); } }, '接受'))), {
      onClose: () => { this.tradeModal = null; },
    });
  }

  // ---------- 卡片 / 日志 / 聊天 ----------
  showCard(ev) {
    const el = $('#card-popup');
    const isChance = ev.deck === 'chance';
    el.className = `card-popup ${isChance ? 'chance' : 'fate'}`;
    el.replaceChildren(
      h('div.card-inner',
        h('div.card-title', isChance ? '❓ 机会' : '⭐ 命运'),
        h('div.card-text', ev.text),
        h('div.card-who', this.player(ev.playerId)?.name || '')),
    );
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.cardT);
    this.cardT = setTimeout(() => el.classList.remove('show'), 2600);
  }

  appendLog(text) {
    const log = $('#hud-log');
    log.append(h('div.log-line', text));
    while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  appendChat(m) {
    const chat = $('#hud-chat');
    const color = this.view?.players.find((p) => p.id === m.from)?.color || '#555';
    chat.append(m.system
      ? h('div.chat-line.system', m.text)
      : h('div.chat-line', h('b', { style: { color } }, `${m.name}：`), m.text));
    while (chat.children.length > 80) chat.firstChild.remove();
    chat.scrollTop = chat.scrollHeight;
  }

  // ---------- 菜单 / 结算 ----------
  showMenu() {
    modal('菜单', (close) => h('div.menu',
      h('button.btn.block', { onclick: () => { close(); showRules(); } }, '📖 游戏规则'),
      h('button.btn.block', { onclick: () => { close(); this.showAssets(); } }, '🏠 我的资产'),
      h('button.btn.block.danger', {
        onclick: async () => {
          close();
          const playing = this.view?.phase === 'playing' && !this.me()?.bankrupt;
          if (playing && !(await confirmBox('游戏进行中退出将视为认输（破产），确定退出吗？', { danger: true, ok: '退出' }))) return;
          this.app.leaveRoom();
        },
      }, '🚪 退出房间')));
  }

  showGameOver() {
    const s = this.view;
    if (!s) return;
    this.overModal?.close();
    const ranking = [...s.players].sort((a, b) => {
      if (a.id === s.winner) return -1;
      if (b.id === s.winner) return 1;
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      return rules.netWorth(s, b.id) - rules.netWorth(s, a.id);
    });
    const winner = this.player(s.winner);
    const isHost = this.room?.hostId === this.myId;
    const iconFor = (p, expr) => {
      const c = h('canvas', { width: 96, height: 96 });
      renderIcon(c, lookFor(p), expr);
      return c;
    };
    this.overModal = modal('游戏结束', (close) => h('div.gameover',
      winner ? h('div.winner', iconFor(winner, 'laugh'), h('h2', `🏆 ${winner.name} 获胜！`), winner.id === this.myId ? h('p', '恭喜你成为大富翁！') : null) : null,
      h('ol.ranking', ranking.map((p, k) => h('li', { class: p.id === this.myId ? 'me' : '' },
        h('span.rank', `${k + 1}`),
        iconFor(p, p.id === s.winner ? 'cool' : p.bankrupt ? 'sad' : 'neutral'),
        h('span.rname', p.name),
        h('span.rworth', p.bankrupt ? '破产' : money(rules.netWorth(s, p.id)))))),
      h('div.row.end',
        h('button.btn', { onclick: close }, '看看棋盘'),
        h('button.btn', { onclick: () => { close(); this.app.leaveRoom(); } }, '返回大厅'),
        isHost ? h('button.btn.primary', {
          onclick: () => this.net.request('room:reset').then(close).catch((e) => toast(e.message, 'error')),
        }, '再来一局') : h('span.muted', '等待房主开始新一局…'))), {
      onClose: () => { this.overModal = null; },
    });
  }
}

export function showRules() {
  const items = [
    ['🎯 目标', '买地、收租、建房，让其他玩家破产；或在回合上限到达时拥有最多的总资产。'],
    ['🎲 掷骰', '每回合掷两颗骰子前进。掷出双数可以再掷一次，但连续三次双数会因“超速”入狱。'],
    ['🏠 地产', '停在无主地产上可以购买。停在别人的地产上需要付租金。集齐同色全部地产后租金翻倍，并可以均衡建房，4 栋房后可升级为酒店。'],
    ['🚄 车站 / 公用事业', '车站租金随拥有数量增加；公用事业租金为骰子点数 ×4（集齐两个 ×10）。'],
    ['❓ 机会 / ⭐ 命运', '抽卡决定命运：可能领钱、罚款、前进、入狱……'],
    ['🔒 监狱', '入狱后可以掷出双数、缴纳 ¥50 或使用出狱卡出狱；三次没掷出双数则必须缴费出狱。坐牢期间照样收租。'],
    ['💸 抵押与破产', '缺钱时可以卖房（半价）或抵押地产；赎回需支付抵押值的 110%。实在付不起就破产，资产归债主所有。'],
    ['🤝 交易', '在自己的回合可以向其他玩家发起交易，交换现金和地产（有房子的同色地产不能交易）。'],
    ['🤖 托管', '超过 60 秒不操作会自动托管，掉线后也会由电脑代打。随时可以取消托管。'],
    ['😄 表情', '右下角的表情按钮可以让你的角色做出表情和动作，买地、收租、入狱时角色也会自动做出反应。'],
  ];
  modal('游戏规则', h('div.rules', items.map(([t, d]) => h('div.rule', h('h4', t), h('p', d)))), { wide: true });
}

