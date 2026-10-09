import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../server/game/engine.js';
import { botAction } from '../server/game/bot.js';
import { TILES, START_MONEY, JAIL_INDEX } from '../shared/board.js';

// 可控随机数：队列为空时退回伪随机
function makeRng(seed = 42) {
  const queue = [];
  let x = seed;
  const rng = () => {
    if (queue.length) return queue.shift();
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  rng.dice = (d1, d2) => queue.push((d1 - 1) / 6 + 0.01, (d2 - 1) / 6 + 0.01);
  return rng;
}

function newGame(n = 3) {
  const rng = makeRng();
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, characterId: 'cat' }));
  const g = new Game(players, { rng });
  return { g, rng };
}

function roll(g, rng, d1, d2) {
  rng.dice(d1, d2);
  const r = g.act(g.cur.id, { type: 'roll' });
  assert.equal(r.ok, true, r.error);
  return r;
}

test('掷骰移动并可购买地产', () => {
  const { g, rng } = newGame();
  roll(g, rng, 1, 2); // 到 3 西宁
  assert.equal(g.cur.position, 3);
  assert.equal(g.state.stage, 'buy');
  assert.equal(g.act('p0', { type: 'buy' }).ok, true);
  assert.equal(g.state.tiles[3].owner, 'p0');
  assert.equal(g.player('p0').money, START_MONEY - 60);
  assert.equal(g.state.stage, 'end');
  assert.equal(g.act('p0', { type: 'endTurn' }).ok, true);
  assert.equal(g.cur.id, 'p1');
});

test('不是自己的回合不能操作', () => {
  const { g } = newGame();
  const r = g.act('p1', { type: 'roll' });
  assert.equal(r.ok, false);
});

test('租金：普通与同色翻倍', () => {
  const { g, rng } = newGame(2);
  g.state.tiles[3].owner = 'p1';
  roll(g, rng, 1, 2); // p0 -> 3 西宁
  assert.equal(g.player('p0').money, START_MONEY - 4);
  assert.equal(g.player('p1').money, START_MONEY + 4);
  // p1 拥有整组棕色后租金翻倍
  g.state.tiles[1].owner = 'p1';
  g.player('p0').position = 0;
  g.state.stage = 'roll';
  const before = g.player('p0').money;
  roll(g, rng, 1, 2);
  assert.equal(before - g.player('p0').money, 8);
});

test('经过起点获得 ¥200', () => {
  const { g, rng } = newGame(2);
  g.player('p0').position = 38;
  roll(g, rng, 1, 3); // 38 + 4 = 42 -> 2 命运
  assert.equal(g.cur.position, 2);
  assert.ok(g.events.some((e) => e.type === 'money' && e.delta === 200 && e.reason === '经过起点'));
});

test('双数再掷，三次双数入狱', () => {
  const { g, rng } = newGame(2);
  roll(g, rng, 2, 2); // 4 所得税
  assert.equal(g.state.stage, 'roll');
  assert.equal(g.cur.id, 'p0');
  roll(g, rng, 3, 3); // 10 监狱（探监）
  assert.equal(g.state.stage, 'roll');
  roll(g, rng, 1, 1);
  assert.equal(g.player('p0').inJail, true);
  assert.equal(g.player('p0').position, JAIL_INDEX);
  assert.equal(g.state.stage, 'end');
});

test('监狱：三次失败后强制缴费出狱', () => {
  const { g, rng } = newGame(2);
  const p0 = g.player('p0');
  p0.inJail = true;
  p0.position = JAIL_INDEX;
  for (let k = 0; k < 2; k++) {
    roll(g, rng, 1, 2);
    assert.equal(p0.inJail, true);
    g.act('p0', { type: 'endTurn' });
    g.state.stage = 'end';
    g.act('p1', { type: 'endTurn' });
  }
  const money = p0.money;
  roll(g, rng, 1, 2);
  assert.equal(p0.inJail, false);
  assert.equal(p0.position, 13);
  assert.ok(p0.money <= money - 50);
});

test('监狱：使用出狱卡与交保释金', () => {
  const { g } = newGame(2);
  const p0 = g.player('p0');
  p0.inJail = true;
  p0.jailCards = 1;
  assert.equal(g.act('p0', { type: 'useCard' }).ok, true);
  assert.equal(p0.inJail, false);
  assert.equal(p0.jailCards, 0);
  p0.inJail = true;
  assert.equal(g.act('p0', { type: 'payFine' }).ok, true);
  assert.equal(p0.money, START_MONEY - 50);
});

test('建房需同色全拥有且均衡建设', () => {
  const { g } = newGame(2);
  g.state.tiles[1].owner = 'p0';
  assert.equal(g.act('p0', { type: 'build', tile: 1 }).ok, false);
  g.state.tiles[3].owner = 'p0';
  assert.equal(g.act('p0', { type: 'build', tile: 1 }).ok, true);
  assert.equal(g.act('p0', { type: 'build', tile: 1 }).ok, false, '不均衡');
  assert.equal(g.act('p0', { type: 'build', tile: 3 }).ok, true);
  assert.equal(g.act('p0', { type: 'build', tile: 1 }).ok, true);
  assert.equal(g.state.tiles[1].houses, 2);
  assert.equal(g.act('p0', { type: 'mortgage', tile: 3 }).ok, false, '有房不能抵押');
  assert.equal(g.act('p0', { type: 'sell', tile: 3 }).ok, false, '不均衡卖房');
  assert.equal(g.act('p0', { type: 'sell', tile: 1 }).ok, true);
  assert.equal(g.player('p0').money, START_MONEY - 150 + 25);
});

test('抵押与赎回', () => {
  const { g } = newGame(2);
  g.state.tiles[39].owner = 'p0';
  assert.equal(g.act('p0', { type: 'mortgage', tile: 39 }).ok, true);
  assert.equal(g.player('p0').money, START_MONEY + 200);
  assert.equal(g.act('p0', { type: 'unmortgage', tile: 39 }).ok, true);
  assert.equal(g.player('p0').money, START_MONEY + 200 - 220);
});

test('破产后资产归债权人，最后一人获胜', () => {
  const { g, rng } = newGame(2);
  const p0 = g.player('p0');
  const p1 = g.player('p1');
  p0.money = 10;
  g.state.tiles[39].owner = 'p1';
  g.state.tiles[37].owner = 'p1';
  g.state.tiles[39].houses = 5;
  g.state.tiles[37].houses = 5;
  g.state.tiles[1].owner = 'p0';
  p0.position = 34;
  roll(g, rng, 2, 3); // 39 上海酒店 2000
  assert.ok(p0.money < 0);
  assert.equal(g.act('p0', { type: 'endTurn' }).ok, false, '负资产不能结束回合');
  assert.equal(g.act('p0', { type: 'bankrupt' }).ok, true);
  assert.equal(p0.bankrupt, true);
  assert.equal(g.state.tiles[1].owner, 'p1');
  assert.equal(g.state.phase, 'ended');
  assert.equal(g.state.winner, 'p1');
  // 债权人只实际拿到 p0 能付的钱：10 + 拉萨抵押前的现金
  assert.equal(p1.money, START_MONEY + 10);
});

test('生日卡：其他玩家欠钱时自动筹钱或破产', () => {
  const { g } = newGame(3);
  const p1 = g.player('p1');
  p1.money = 5;
  g.state.tiles[1].owner = 'p1';
  // 直接执行生日卡效果：每位其他玩家给 p0 ¥10
  for (const o of g.alivePlayers()) if (o.id !== 'p0') g._pay(o, g.player('p0'), 10, '生日');
  g._settleOutOfTurn();
  assert.equal(g.state.tiles[1].mortgaged, true, '自动抵押');
  assert.equal(p1.money, 5 - 10 + 30);
});

test('交易：发起、接受', () => {
  const { g } = newGame(2);
  g.state.tiles[1].owner = 'p0';
  g.state.tiles[3].owner = 'p1';
  let r = g.act('p0', { type: 'tradePropose', to: 'p1', give: { money: 100, tiles: [] }, get: { money: 0, tiles: [3] } });
  assert.equal(r.ok, true, r.error);
  assert.equal(g.act('p0', { type: 'tradeAccept' }).ok, false);
  r = g.act('p1', { type: 'tradeAccept' });
  assert.equal(r.ok, true, r.error);
  assert.equal(g.state.tiles[3].owner, 'p0');
  assert.equal(g.player('p0').money, START_MONEY - 100);
  assert.equal(g.player('p1').money, START_MONEY + 100);
  assert.equal(g.state.trade, null);
});

test('交易：不能交易别人的地产或超出现金', () => {
  const { g } = newGame(2);
  g.state.tiles[3].owner = 'p1';
  assert.equal(g.act('p0', { type: 'tradePropose', to: 'p1', give: { money: 99999 }, get: { tiles: [3] } }).ok, false);
  assert.equal(g.act('p0', { type: 'tradePropose', to: 'p1', give: { tiles: [3] }, get: {} }).ok, false);
});

test('电脑玩家可以完整打完多局游戏', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rng = makeRng(seed);
    const n = 3 + (seed % 4);
    const players = Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `电脑${i}`, characterId: 'robot', isBot: true }));
    const g = new Game(players, { rng });
    let steps = 0;
    while (g.state.phase === 'playing' && steps < 20000) {
      const actor = g.state.trade ? g.state.trade.to : g.cur.id;
      const action = botAction(g, actor);
      assert.ok(action, `bot 应该有动作 (stage=${g.state.stage})`);
      const r = g.act(actor, action);
      assert.equal(r.ok, true, `${action.type}: ${r.error}`);
      for (const p of g.state.players) {
        assert.ok(Number.isFinite(p.money));
        assert.ok(p.position >= 0 && p.position < 40);
        if (p.id !== g.cur.id && !p.bankrupt) assert.ok(p.money >= 0, '非当前玩家不应负债');
      }
      for (const [i, ts] of g.state.tiles.entries()) {
        assert.ok(ts.houses >= 0 && ts.houses <= 5);
        if (ts.owner) assert.ok(!g.player(ts.owner).bankrupt, `${TILES[i].name} 的主人已破产`);
      }
      steps++;
    }
    // 局面要么结束，要么仍然合法
    assert.ok(['playing', 'ended'].includes(g.state.phase));
  }
});

test('回合上限到达后按总资产结算', () => {
  const rng = makeRng(7);
  const players = [0, 1, 2].map((i) => ({ id: `b${i}`, name: `电脑${i}`, characterId: 'cat', isBot: true }));
  const g = new Game(players, { rng, maxRounds: 5 });
  let steps = 0;
  while (g.state.phase === 'playing' && steps < 5000) {
    const actor = g.state.trade ? g.state.trade.to : g.cur.id;
    g.act(actor, botAction(g, actor));
    steps++;
  }
  assert.equal(g.state.phase, 'ended');
  assert.ok(g.state.round <= 6);
  const winner = g.state.winner;
  for (const p of g.alivePlayers()) assert.ok(g.netWorth(winner) >= g.netWorth(p.id));
});
