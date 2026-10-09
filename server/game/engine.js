// 大富翁规则引擎（服务端权威，纯逻辑，不涉及网络）
import {
  TILES, BOARD_SIZE, JAIL_INDEX, GO_SALARY, JAIL_FINE, START_MONEY, MAX_HOUSES,
  isOwnable, mortgageValue, unmortgageCost,
} from '../../shared/board.js';
import * as rules from '../../shared/rules.js';
import { SEAT_COLORS } from '../../shared/characters.js';
import { CHANCE_CARDS, FATE_CARDS } from './cards.js';

export class GameError extends Error {}

const fail = (msg) => { throw new GameError(msg); };

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DECKS = { chance: CHANCE_CARDS, fate: FATE_CARDS };

export class Game {
  /**
   * @param {Array<{id:string,name:string,characterId:string,custom?:object,avatar?:string,isBot?:boolean}>} players
   * @param {{rng?:()=>number, startMoney?:number, maxRounds?:number}} opts
   */
  constructor(players, opts = {}) {
    this.rng = opts.rng || Math.random;
    this.events = [];
    this.decks = {
      chance: { order: shuffle([...CHANCE_CARDS.keys()], this.rng), pos: 0 },
      fate: { order: shuffle([...FATE_CARDS.keys()], this.rng), pos: 0 },
    };
    this.state = {
      phase: 'playing',
      players: players.map((p, seat) => ({
        id: p.id,
        name: p.name,
        seat,
        color: SEAT_COLORS[seat % SEAT_COLORS.length],
        characterId: p.characterId,
        custom: p.custom || null,
        avatar: p.avatar || null,
        isBot: !!p.isBot,
        auto: false,
        connected: true,
        money: opts.startMoney ?? START_MONEY,
        position: 0,
        inJail: false,
        jailTurns: 0,
        jailCards: 0,
        bankrupt: false,
        creditor: null,
        lastPaid: 0,
      })),
      tiles: TILES.map(() => ({ owner: null, houses: 0, mortgaged: false })),
      current: 0,
      stage: 'roll', // roll | buy | end
      dice: null,
      doubles: 0,
      extraRoll: false,
      pendingTile: null,
      lastCard: null,
      trade: null,
      turnNo: 1,
      round: 1,
      maxRounds: opts.maxRounds || 0, // 0 = 不限回合
      winner: null,
      log: [],
    };
    this._log(`游戏开始！${this.cur.name} 先手`);
  }

  // ---------- 查询 ----------
  get cur() { return this.state.players[this.state.current]; }

  player(id) { return this.state.players.find((p) => p.id === id); }

  alivePlayers() { return this.state.players.filter((p) => !p.bankrupt); }

  ownsGroup(playerId, group) { return rules.ownsGroup(this.state, playerId, group); }

  countOwned(playerId, type) { return rules.countOwned(this.state, playerId, type); }

  rentFor(index, diceTotal, special = null) { return rules.rentFor(this.state, index, diceTotal, special); }

  netWorth(playerId) { return rules.netWorth(this.state, playerId); }

  canBuild(playerId, index) { return !rules.checkBuild(this.state, playerId, index); }

  canSell(playerId, index) { return !rules.checkSell(this.state, playerId, index); }

  canMortgage(playerId, index) { return !rules.checkMortgage(this.state, playerId, index); }

  // ---------- 动作入口 ----------
  /**
   * 执行动作。成功返回 {ok:true, events}，失败返回 {ok:false, error}
   */
  act(playerId, action) {
    this.events = [];
    try {
      if (this.state.phase !== 'playing') fail('游戏已结束');
      const p = this.player(playerId);
      if (!p) fail('你不在这局游戏中');
      if (p.bankrupt) fail('你已经破产了');
      const handler = this[`_do_${action?.type}`];
      if (typeof handler !== 'function') fail('未知操作');
      handler.call(this, p, action);
      this._settleOutOfTurn();
      return { ok: true, events: this.events };
    } catch (e) {
      if (e instanceof GameError) return { ok: false, error: e.message, events: [] };
      throw e;
    }
  }

  /** 玩家离开/认输：按破产给银行处理 */
  forfeit(playerId) {
    this.events = [];
    const p = this.player(playerId);
    if (!p || p.bankrupt || this.state.phase !== 'playing') return { ok: false, events: [] };
    this._log(`${p.name} 离开了游戏`);
    this._bankrupt(p, null);
    return { ok: true, events: this.events };
  }

  _requireTurn(p, stages) {
    if (this.cur.id !== p.id) fail('还没轮到你');
    if (stages && !stages.includes(this.state.stage)) fail('现在不能这样操作');
  }

  // ---------- 掷骰与移动 ----------
  _do_roll(p) {
    this._requireTurn(p, ['roll']);
    if (p.money < 0) fail('资金为负，请先抵押/卖房或宣告破产');
    const d1 = 1 + Math.floor(this.rng() * 6);
    const d2 = 1 + Math.floor(this.rng() * 6);
    this._roll(p, d1, d2);
  }

  /** 测试用：指定点数 */
  _roll(p, d1, d2) {
    const s = this.state;
    const isDouble = d1 === d2;
    s.dice = [d1, d2];
    s.extraRoll = false;
    this._emit({ type: 'dice', playerId: p.id, dice: [d1, d2] });
    this._log(`${p.name} 掷出 ${d1} + ${d2} = ${d1 + d2}${isDouble ? '（双数！）' : ''}`);

    if (p.inJail) {
      if (isDouble) {
        p.inJail = false;
        p.jailTurns = 0;
        this._log(`${p.name} 掷出双数，出狱！`);
        this._expr(p, 'happy');
        this._moveSteps(p, d1 + d2);
      } else {
        p.jailTurns += 1;
        if (p.jailTurns >= 3) {
          this._log(`${p.name} 第三次未掷出双数，缴纳 ¥${JAIL_FINE} 出狱`);
          this._pay(p, null, JAIL_FINE, '保释金');
          p.inJail = false;
          p.jailTurns = 0;
          this._moveSteps(p, d1 + d2);
        } else {
          this._log(`${p.name} 继续蹲监狱（第 ${p.jailTurns} 次）`);
          this._expr(p, 'sad');
          s.stage = 'end';
          return;
        }
      }
      this._finishRoll(false);
      return;
    }

    if (isDouble) {
      s.doubles += 1;
      if (s.doubles >= 3) {
        this._log(`${p.name} 连续三次双数，超速入狱！`);
        this._sendToJail(p);
        s.stage = 'end';
        return;
      }
      this._expr(p, 'surprised');
    }
    this._moveSteps(p, d1 + d2);
    this._finishRoll(isDouble);
  }

  _finishRoll(isDouble) {
    const s = this.state;
    const p = this.cur;
    if (p.bankrupt || s.phase !== 'playing') return;
    s.extraRoll = isDouble && !p.inJail;
    if (s.stage === 'buy') return; // 等待购买决定
    s.stage = s.extraRoll ? 'roll' : 'end';
  }

  _moveSteps(p, steps) {
    const from = p.position;
    const to = (from + steps + BOARD_SIZE) % BOARD_SIZE;
    const passGo = steps > 0 && from + steps >= BOARD_SIZE;
    p.position = to;
    this._emit({ type: 'move', playerId: p.id, from, to, steps });
    if (passGo) {
      this._gain(p, GO_SALARY, '经过起点');
      this._expr(p, 'happy');
    }
    this._landOn(p);
  }

  _moveTo(p, to, special = null) {
    const steps = (to - p.position + BOARD_SIZE) % BOARD_SIZE;
    if (steps === 0) { this._landOn(p, special); return; }
    const from = p.position;
    const passGo = from + steps >= BOARD_SIZE;
    p.position = to;
    this._emit({ type: 'move', playerId: p.id, from, to, steps });
    if (passGo) this._gain(p, GO_SALARY, '经过起点');
    this._landOn(p, special);
  }

  _sendToJail(p) {
    const from = p.position;
    p.position = JAIL_INDEX;
    p.inJail = true;
    p.jailTurns = 0;
    this.state.doubles = 0;
    this.state.extraRoll = false;
    this._emit({ type: 'jail', playerId: p.id, from, to: JAIL_INDEX });
    this._expr(p, 'angry');
  }

  _landOn(p, special = null) {
    const s = this.state;
    const tile = TILES[p.position];
    switch (tile.type) {
      case 'property':
      case 'station':
      case 'utility': {
        const ts = s.tiles[tile.index];
        if (!ts.owner) {
          s.stage = 'buy';
          s.pendingTile = tile.index;
          this._expr(p, 'thinking');
        } else if (ts.owner !== p.id) {
          const owner = this.player(ts.owner);
          if (ts.mortgaged) {
            this._log(`${tile.name} 已抵押，无需付租`);
          } else {
            const diceTotal = s.dice ? s.dice[0] + s.dice[1] : 7;
            const rent = this.rentFor(tile.index, diceTotal, special);
            this._log(`${p.name} 向 ${owner.name} 支付 ${tile.name} 的租金 ¥${rent}`);
            this._emit({ type: 'rent', from: p.id, to: owner.id, amount: rent, tile: tile.index });
            this._pay(p, owner, rent, `${tile.name} 租金`);
            this._expr(p, rent >= 300 ? 'angry' : 'sad');
            this._expr(owner, rent >= 300 ? 'laugh' : 'cool');
          }
        }
        break;
      }
      case 'tax':
        this._log(`${p.name} 缴纳${tile.name} ¥${tile.amount}`);
        this._pay(p, null, tile.amount, tile.name);
        this._expr(p, 'sad');
        break;
      case 'chance':
      case 'fate':
        this._drawCard(p, tile.type);
        break;
      case 'gotojail':
        this._log(`${p.name} 被送进监狱！`);
        this._sendToJail(p);
        break;
      default:
        break;
    }
  }

  _drawCard(p, deckName) {
    const deck = this.decks[deckName];
    const cards = DECKS[deckName];
    const card = cards[deck.order[deck.pos]];
    deck.pos = (deck.pos + 1) % deck.order.length;
    if (deck.pos === 0) deck.order = shuffle(deck.order, this.rng);
    this.state.lastCard = { deck: deckName, text: card.text, playerId: p.id };
    this._emit({ type: 'card', playerId: p.id, deck: deckName, text: card.text });
    this._log(`${p.name} 抽到${deckName === 'chance' ? '机会' : '命运'}卡：${card.text}`);
    const a = card.action;
    switch (a.type) {
      case 'money':
        if (a.amount >= 0) { this._gain(p, a.amount, '卡片'); this._expr(p, 'happy'); }
        else { this._pay(p, null, -a.amount, '卡片'); this._expr(p, 'sad'); }
        break;
      case 'moveTo':
        this._moveTo(p, a.to);
        break;
      case 'moveBack':
        this._moveSteps(p, -a.steps);
        break;
      case 'nearest': {
        let i = p.position;
        do { i = (i + 1) % BOARD_SIZE; } while (TILES[i].type !== a.kind);
        this._moveTo(p, i, 'nearest');
        break;
      }
      case 'jail':
        this._sendToJail(p);
        break;
      case 'jailCard':
        p.jailCards += 1;
        this._expr(p, 'cool');
        break;
      case 'repairs': {
        let houses = 0;
        let hotels = 0;
        for (const ts of this.state.tiles) {
          if (ts.owner !== p.id) continue;
          if (ts.houses === MAX_HOUSES) hotels += 1; else houses += ts.houses;
        }
        const cost = houses * a.house + hotels * a.hotel;
        if (cost > 0) { this._pay(p, null, cost, '维修费'); this._expr(p, 'sad'); }
        else this._log(`${p.name} 没有房子，无需维修`);
        break;
      }
      case 'payEach':
        for (const o of this.alivePlayers()) if (o.id !== p.id) this._pay(p, o, a.amount, '卡片');
        this._expr(p, 'sad');
        break;
      case 'collectEach':
        for (const o of this.alivePlayers()) if (o.id !== p.id) this._pay(o, p, a.amount, '生日礼金');
        this._expr(p, 'love');
        break;
      default:
        break;
    }
  }

  // ---------- 资金 ----------
  _gain(p, amount, reason) {
    p.money += amount;
    this._emit({ type: 'money', playerId: p.id, delta: amount, reason });
  }

  /** 支付：余额可以变为负数，负数玩家必须筹钱或破产 */
  _pay(from, to, amount, reason) {
    if (amount <= 0) return;
    from.money -= amount;
    this._emit({ type: 'money', playerId: from.id, delta: -amount, reason });
    if (to) {
      to.money += amount;
      this._emit({ type: 'money', playerId: to.id, delta: amount, reason });
    }
    if (from.money < 0) {
      from.creditor = to ? to.id : null;
      from.lastPaid = amount;
    }
  }

  // ---------- 购买 ----------
  _do_buy(p) {
    this._requireTurn(p, ['buy']);
    const s = this.state;
    const tile = TILES[s.pendingTile];
    if (p.money < tile.price) fail('钱不够');
    p.money -= tile.price;
    s.tiles[tile.index].owner = p.id;
    this._emit({ type: 'money', playerId: p.id, delta: -tile.price, reason: `购买${tile.name}` });
    this._emit({ type: 'buy', playerId: p.id, tile: tile.index });
    this._log(`${p.name} 以 ¥${tile.price} 买下了 ${tile.name}`);
    this._expr(p, tile.group && this.ownsGroup(p.id, tile.group) ? 'love' : 'happy');
    this._afterBuyDecision();
  }

  _do_decline(p) {
    this._requireTurn(p, ['buy']);
    const s = this.state;
    this._log(`${p.name} 放弃购买 ${TILES[s.pendingTile].name}`);
    this._afterBuyDecision();
  }

  _afterBuyDecision() {
    const s = this.state;
    s.pendingTile = null;
    s.stage = s.extraRoll && !this.cur.inJail ? 'roll' : 'end';
  }

  // ---------- 监狱 ----------
  _do_payFine(p) {
    this._requireTurn(p, ['roll']);
    if (!p.inJail) fail('你不在监狱里');
    if (p.money < JAIL_FINE) fail('钱不够');
    this._pay(p, null, JAIL_FINE, '保释金');
    p.inJail = false;
    p.jailTurns = 0;
    this._log(`${p.name} 支付 ¥${JAIL_FINE} 保释出狱`);
    this._expr(p, 'happy');
  }

  _do_useCard(p) {
    this._requireTurn(p, ['roll']);
    if (!p.inJail) fail('你不在监狱里');
    if (p.jailCards <= 0) fail('你没有出狱卡');
    p.jailCards -= 1;
    p.inJail = false;
    p.jailTurns = 0;
    this._log(`${p.name} 使用出狱卡出狱`);
    this._emit({ type: 'useCard', playerId: p.id });
    this._expr(p, 'cool');
  }

  // ---------- 回合 ----------
  _do_endTurn(p) {
    this._requireTurn(p, ['end']);
    if (p.money < 0) fail('资金为负，请先抵押/卖房或宣告破产');
    this._nextTurn();
  }

  _nextTurn() {
    const s = this.state;
    if (s.phase !== 'playing') return;
    if (s.trade) this._cancelTrade('回合结束，交易取消');
    const n = s.players.length;
    let i = s.current;
    for (let k = 0; k < n; k++) {
      i = (i + 1) % n;
      if (!s.players[i].bankrupt) break;
    }
    if (i <= s.current) {
      s.round += 1;
      if (s.maxRounds && s.round > s.maxRounds) {
        this._log(`已达到 ${s.maxRounds} 回合上限`);
        this._endByNetWorth();
        return;
      }
    }
    s.current = i;
    s.stage = 'roll';
    s.doubles = 0;
    s.extraRoll = false;
    s.pendingTile = null;
    s.turnNo += 1;
    this._emit({ type: 'turn', playerId: this.cur.id });
    this._log(`轮到 ${this.cur.name}${this.cur.inJail ? '（在监狱中）' : ''}`);
  }

  // ---------- 建房 / 抵押 ----------
  _check(err, index) {
    if (err) fail(err);
    return TILES[index];
  }

  _checkBuild(playerId, index) { return this._check(rules.checkBuild(this.state, playerId, index), index); }

  _checkSell(playerId, index) { return this._check(rules.checkSell(this.state, playerId, index), index); }

  _checkMortgage(playerId, index) { return this._check(rules.checkMortgage(this.state, playerId, index), index); }

  _manageAllowed(p) {
    // 自己回合可以管理资产
    this._requireTurn(p, ['roll', 'buy', 'end']);
  }

  _do_build(p, { tile: index }) {
    this._manageAllowed(p);
    const tile = this._checkBuild(p.id, index);
    const ts = this.state.tiles[index];
    p.money -= tile.houseCost;
    ts.houses += 1;
    this._emit({ type: 'money', playerId: p.id, delta: -tile.houseCost, reason: '建房' });
    this._emit({ type: 'build', playerId: p.id, tile: index, houses: ts.houses });
    this._log(`${p.name} 在 ${tile.name} ${ts.houses === MAX_HOUSES ? '升级为酒店' : `盖了第 ${ts.houses} 栋房子`}`);
    this._expr(p, ts.houses === MAX_HOUSES ? 'laugh' : 'cool');
  }

  _do_sell(p, { tile: index }) {
    this._manageAllowed(p);
    this._sell(p, index);
  }

  _sell(p, index) {
    const tile = this._checkSell(p.id, index);
    const ts = this.state.tiles[index];
    const refund = Math.floor(tile.houseCost / 2);
    ts.houses -= 1;
    this._gain(p, refund, '卖房');
    this._emit({ type: 'build', playerId: p.id, tile: index, houses: ts.houses });
    this._log(`${p.name} 卖掉 ${tile.name} 的一栋房子，获得 ¥${refund}`);
  }

  _do_mortgage(p, { tile: index }) {
    this._manageAllowed(p);
    this._mortgage(p, index);
  }

  _mortgage(p, index) {
    const tile = this._checkMortgage(p.id, index);
    this.state.tiles[index].mortgaged = true;
    const v = mortgageValue(tile);
    this._gain(p, v, '抵押');
    this._emit({ type: 'mortgage', playerId: p.id, tile: index, mortgaged: true });
    this._log(`${p.name} 抵押了 ${tile.name}，获得 ¥${v}`);
  }

  _do_unmortgage(p, { tile: index }) {
    this._manageAllowed(p);
    const tile = this._check(rules.checkUnmortgage(this.state, p.id, index), index);
    const ts = this.state.tiles[index];
    const cost = unmortgageCost(tile);
    p.money -= cost;
    ts.mortgaged = false;
    this._emit({ type: 'money', playerId: p.id, delta: -cost, reason: '赎回' });
    this._emit({ type: 'mortgage', playerId: p.id, tile: index, mortgaged: false });
    this._log(`${p.name} 花 ¥${cost} 赎回了 ${tile.name}`);
  }

  _do_bankrupt(p) {
    if (this.cur.id !== p.id) fail('还没轮到你');
    this._bankrupt(p, p.money < 0 ? p.creditor : null);
  }

  /** 自动筹钱：先卖房再抵押，返回是否已经不再欠钱 */
  autoRaise(p) {
    while (p.money < 0) {
      const sellable = TILES.filter((t) => this.canSell(p.id, t.index))
        .sort((a, b) => b.houseCost - a.houseCost);
      if (sellable.length) { this._sell(p, sellable[0].index); continue; }
      const mortgageable = TILES.filter((t) => this.canMortgage(p.id, t.index))
        .sort((a, b) => a.price - b.price);
      if (mortgageable.length) { this._mortgage(p, mortgageable[0].index); continue; }
      break;
    }
    return p.money >= 0;
  }

  /** 非当前回合的玩家欠钱时自动筹钱，筹不到就破产 */
  _settleOutOfTurn() {
    for (const o of this.state.players) {
      if (o.bankrupt || o.money >= 0 || o.id === this.cur.id) continue;
      if (!this.autoRaise(o)) this._bankrupt(o, o.creditor);
    }
  }

  _bankrupt(p, creditorId) {
    const s = this.state;
    const creditor = creditorId ? this.player(creditorId) : null;
    const validCreditor = creditor && !creditor.bankrupt ? creditor : null;
    // 房屋按半价卖回银行
    for (const t of TILES) {
      const ts = s.tiles[t.index];
      if (ts.owner === p.id && ts.houses > 0) {
        p.money += ts.houses * Math.floor(t.houseCost / 2);
        ts.houses = 0;
        this._emit({ type: 'build', playerId: p.id, tile: t.index, houses: 0 });
      }
    }
    for (const t of TILES) {
      const ts = s.tiles[t.index];
      if (ts.owner !== p.id) continue;
      if (validCreditor) {
        ts.owner = validCreditor.id;
      } else {
        ts.owner = null;
        ts.mortgaged = false;
      }
      this._emit({ type: 'transfer', tile: t.index, to: ts.owner });
    }
    if (validCreditor) {
      // 债权人获得剩余现金；如果为负，则只按实际能付的金额结算
      const delta = p.money >= 0 ? p.money : Math.max(p.money, -p.lastPaid);
      validCreditor.money += delta;
      if (delta) this._emit({ type: 'money', playerId: validCreditor.id, delta, reason: '破产清算' });
      validCreditor.jailCards += p.jailCards;
    }
    p.money = 0;
    p.jailCards = 0;
    p.inJail = false;
    p.bankrupt = true;
    this._emit({ type: 'bankrupt', playerId: p.id, creditor: validCreditor?.id || null });
    this._expr(p, 'sad');
    this._log(`💥 ${p.name} 破产了${validCreditor ? `，资产归 ${validCreditor.name}` : ''}`);
    if (s.trade && (s.trade.from === p.id || s.trade.to === p.id)) this._cancelTrade('玩家破产，交易取消');

    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      s.phase = 'ended';
      s.winner = alive[0]?.id || null;
      s.stage = null;
      if (alive[0]) {
        this._expr(alive[0], 'laugh');
        this._log(`🏆 ${alive[0].name} 获得胜利！`);
      }
      this._emit({ type: 'gameover', winner: s.winner });
      return;
    }
    if (this.cur.id === p.id) this._nextTurn();
  }

  /** 按总资产结束游戏 */
  endByNetWorth() {
    this.events = [];
    if (this.state.phase !== 'playing') return { ok: false, events: [] };
    this._endByNetWorth();
    return { ok: true, events: this.events };
  }

  _endByNetWorth() {
    const s = this.state;
    const alive = this.alivePlayers().sort((a, b) => this.netWorth(b.id) - this.netWorth(a.id));
    s.phase = 'ended';
    s.winner = alive[0]?.id || null;
    s.stage = null;
    if (alive[0]) this._expr(alive[0], 'laugh');
    this._log(`🏆 按总资产计算，${alive[0]?.name} 获得胜利！`);
    this._emit({ type: 'gameover', winner: s.winner });
  }

  // ---------- 交易 ----------
  _validateTradeSide(owner, side) {
    const money = Math.floor(Number(side?.money) || 0);
    if (money < 0) fail('金额不能为负');
    if (money > Math.max(owner.money, 0)) fail(`${owner.name} 的现金不足`);
    const tiles = Array.isArray(side?.tiles) ? [...new Set(side.tiles.map(Number))] : [];
    for (const i of tiles) {
      const tile = TILES[i];
      if (!tile || !isOwnable(tile) || this.state.tiles[i].owner !== owner.id) fail('交易的地产不属于对方');
      if (!rules.tradable(this.state, i)) fail(`${tile.name} 同色地产上有房子，不能交易`);
    }
    return { money, tiles };
  }

  _do_tradePropose(p, { to, give, get }) {
    this._manageAllowed(p);
    if (this.state.trade) fail('已经有一笔交易在等待回应');
    const target = this.player(to);
    if (!target || target.bankrupt || target.id === p.id) fail('无效的交易对象');
    const g = this._validateTradeSide(p, give);
    const r = this._validateTradeSide(target, get);
    if (!g.money && !g.tiles.length && !r.money && !r.tiles.length) fail('交易内容为空');
    this.state.trade = { from: p.id, to: target.id, give: g, get: r };
    this._emit({ type: 'trade', status: 'proposed', from: p.id, to: target.id });
    this._log(`${p.name} 向 ${target.name} 发起交易`);
  }

  _do_tradeAccept(p) {
    const t = this.state.trade;
    if (!t || t.to !== p.id) fail('没有给你的交易');
    const from = this.player(t.from);
    let g;
    let r;
    try {
      g = this._validateTradeSide(from, t.give);
      r = this._validateTradeSide(p, t.get);
    } catch {
      this._cancelTrade('交易条件已失效，自动取消');
      return;
    }
    from.money -= g.money; p.money += g.money;
    p.money -= r.money; from.money += r.money;
    if (g.money) {
      this._emit({ type: 'money', playerId: from.id, delta: -g.money, reason: '交易' });
      this._emit({ type: 'money', playerId: p.id, delta: g.money, reason: '交易' });
    }
    if (r.money) {
      this._emit({ type: 'money', playerId: p.id, delta: -r.money, reason: '交易' });
      this._emit({ type: 'money', playerId: from.id, delta: r.money, reason: '交易' });
    }
    for (const i of g.tiles) { this.state.tiles[i].owner = p.id; this._emit({ type: 'transfer', tile: i, to: p.id }); }
    for (const i of r.tiles) { this.state.tiles[i].owner = from.id; this._emit({ type: 'transfer', tile: i, to: from.id }); }
    this.state.trade = null;
    this._emit({ type: 'trade', status: 'accepted', from: from.id, to: p.id });
    this._log(`🤝 ${p.name} 接受了 ${from.name} 的交易`);
    this._expr(p, 'happy');
    this._expr(from, 'happy');
  }

  _do_tradeReject(p) {
    const t = this.state.trade;
    if (!t || t.to !== p.id) fail('没有给你的交易');
    const from = this.player(t.from);
    this.state.trade = null;
    this._emit({ type: 'trade', status: 'rejected', from: t.from, to: p.id });
    this._log(`${p.name} 拒绝了 ${from.name} 的交易`);
    this._expr(from, 'sad');
  }

  _do_tradeCancel(p) {
    const t = this.state.trade;
    if (!t || t.from !== p.id) fail('没有可取消的交易');
    this._cancelTrade(`${p.name} 取消了交易`);
  }

  _cancelTrade(msg) {
    const t = this.state.trade;
    this.state.trade = null;
    this._emit({ type: 'trade', status: 'cancelled', from: t.from, to: t.to });
    this._log(msg);
  }

  // ---------- 工具 ----------
  _emit(ev) { this.events.push(ev); }

  _expr(p, expr) { this._emit({ type: 'expr', playerId: p.id, expr }); }

  _log(text) {
    const log = this.state.log;
    log.push({ t: Date.now(), text });
    if (log.length > 80) log.splice(0, log.length - 80);
    this._emit({ type: 'log', text });
  }
}
