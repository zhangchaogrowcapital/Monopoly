// 电脑玩家 / 托管 AI：根据当前局面返回下一步动作（一次一个）
import { TILES, isOwnable, groupTiles, unmortgageCost } from '../../shared/board.js';

const RESERVE = 150;

function completesGroup(game, playerId, index) {
  const tile = TILES[index];
  if (!tile.group) return false;
  return groupTiles(tile.group).every((i) => i === index || game.state.tiles[i].owner === playerId);
}

function pickBuild(game, p, reserve) {
  const options = TILES.filter((t) => t.type === 'property' && game.canBuild(p.id, t.index) && p.money - t.houseCost >= reserve);
  if (!options.length) return null;
  // 优先盖房子少的、租金高的
  options.sort((a, b) => game.state.tiles[a.index].houses - game.state.tiles[b.index].houses || b.price - a.price);
  return options[0].index;
}

function pickUnmortgage(game, p) {
  const options = TILES.filter((t) => game.state.tiles[t.index].owner === p.id && game.state.tiles[t.index].mortgaged
    && p.money - unmortgageCost(t) >= 400);
  options.sort((a, b) => b.price - a.price);
  return options[0]?.index ?? null;
}

function tileValueFor(game, playerId, index, gaining) {
  const tile = TILES[index];
  let v = game.state.tiles[index].mortgaged ? tile.price / 2 : tile.price;
  // 拿到后能凑齐同色，价值大增
  if (gaining && completesGroup(game, playerId, index)) v *= 2.5;
  return v;
}

/** 评估交易：收益是否明显大于损失 */
export function evaluateTrade(game, p) {
  const t = game.state.trade;
  if (!t) return false;
  const proposer = t.from;
  let gain = t.give.money;
  let loss = t.get.money;
  for (const i of t.give.tiles) gain += tileValueFor(game, p.id, i, true);
  for (const i of t.get.tiles) {
    loss += tileValueFor(game, p.id, i, false);
    // 会让对方凑齐同色：额外惩罚
    if (completesGroup(game, proposer, i)) loss += TILES[i].price * 2;
    // 破坏自己的同色组：额外惩罚
    if (TILES[i].group && game.ownsGroup(p.id, TILES[i].group)) loss += TILES[i].price * 2;
  }
  if (p.money - t.get.money < 0) return false;
  return gain >= loss * 1.15 && gain > 0;
}

/**
 * 返回该玩家此刻应执行的动作，若无需操作则返回 null
 */
export function botAction(game, playerId) {
  const s = game.state;
  const p = game.player(playerId);
  if (!p || p.bankrupt || s.phase !== 'playing') return null;

  if (s.trade && s.trade.to === p.id) {
    return { type: evaluateTrade(game, p) ? 'tradeAccept' : 'tradeReject' };
  }
  if (game.cur.id !== p.id) return null;
  if (s.trade && s.trade.from === p.id) return { type: 'tradeCancel' };

  if (p.money < 0 && s.stage !== 'buy') {
    const sell = TILES.filter((t) => game.canSell(p.id, t.index)).sort((a, b) => b.houseCost - a.houseCost)[0];
    if (sell) return { type: 'sell', tile: sell.index };
    const mort = TILES.filter((t) => game.canMortgage(p.id, t.index)).sort((a, b) => a.price - b.price)[0];
    if (mort) return { type: 'mortgage', tile: mort.index };
    return { type: 'bankrupt' };
  }

  switch (s.stage) {
    case 'buy': {
      const tile = TILES[s.pendingTile];
      const reserve = completesGroup(game, p.id, tile.index) ? 0 : RESERVE;
      return { type: p.money - tile.price >= reserve ? 'buy' : 'decline' };
    }
    case 'roll': {
      if (p.inJail) {
        if (p.jailCards > 0) return { type: 'useCard' };
        const unownedLeft = TILES.some((t) => isOwnable(t) && !s.tiles[t.index].owner);
        if (unownedLeft && p.money >= 400) return { type: 'payFine' };
        return { type: 'roll' };
      }
      const b = pickBuild(game, p, 250);
      if (b != null) return { type: 'build', tile: b };
      return { type: 'roll' };
    }
    case 'end': {
      const u = pickUnmortgage(game, p);
      if (u != null) return { type: 'unmortgage', tile: u };
      const b = pickBuild(game, p, 250);
      if (b != null) return { type: 'build', tile: b };
      return { type: 'endTurn' };
    }
    default:
      return null;
  }
}
