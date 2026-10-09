// 规则判断（纯函数）：服务端引擎与浏览器界面共用，保证按钮状态与服务端判定一致
import {
  TILES, STATION_RENT, MAX_HOUSES, isOwnable, groupTiles, mortgageValue, unmortgageCost,
} from './board.js';

export const ownsGroup = (state, playerId, group) => groupTiles(group).every((i) => state.tiles[i].owner === playerId);

export const countOwned = (state, playerId, type) => TILES.filter((t) => t.type === type && state.tiles[t.index].owner === playerId).length;

export function rentFor(state, index, diceTotal = 7, special = null) {
  const tile = TILES[index];
  const ts = state.tiles[index];
  if (!ts.owner || ts.mortgaged) return 0;
  if (tile.type === 'property') {
    if (ts.houses > 0) return tile.rent[ts.houses];
    return ownsGroup(state, ts.owner, tile.group) ? tile.rent[0] * 2 : tile.rent[0];
  }
  if (tile.type === 'station') {
    const n = countOwned(state, ts.owner, 'station');
    return STATION_RENT[n - 1] * (special === 'nearest' ? 2 : 1);
  }
  if (tile.type === 'utility') {
    if (special === 'nearest') return diceTotal * 10;
    return diceTotal * (countOwned(state, ts.owner, 'utility') >= 2 ? 10 : 4);
  }
  return 0;
}

export function netWorth(state, playerId) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return 0;
  let total = p.money;
  for (const t of TILES) {
    const ts = state.tiles[t.index];
    if (ts.owner !== playerId) continue;
    total += ts.mortgaged ? mortgageValue(t) : t.price;
    if (ts.houses) total += ts.houses * t.houseCost;
  }
  return total;
}

function ownedTile(state, playerId, index) {
  const tile = TILES[index];
  if (!tile || !isOwnable(tile)) return [null, '无效的地块'];
  if (state.tiles[index].owner !== playerId) return [null, '这不是你的地产'];
  return [tile, null];
}

/** 以下 check* 函数返回错误信息，可以执行时返回 null */
export function checkBuild(state, playerId, index) {
  const [tile, err] = ownedTile(state, playerId, index);
  if (err) return err;
  if (tile.type !== 'property') return '只能在地产上建房';
  if (!ownsGroup(state, playerId, tile.group)) return '需要拥有同色全部地产才能建房';
  const group = groupTiles(tile.group);
  if (group.some((i) => state.tiles[i].mortgaged)) return '同色地产有抵押，不能建房';
  const h = state.tiles[index].houses;
  if (h >= MAX_HOUSES) return '已经是酒店了';
  if (h > Math.min(...group.map((i) => state.tiles[i].houses))) return '必须均衡建房（先在同色其他地产上盖）';
  const p = state.players.find((x) => x.id === playerId);
  if (p.money < tile.houseCost) return '钱不够';
  return null;
}

export function checkSell(state, playerId, index) {
  const [tile, err] = ownedTile(state, playerId, index);
  if (err) return err;
  const h = state.tiles[index].houses;
  if (h <= 0) return '没有房子可卖';
  const group = groupTiles(tile.group);
  if (h < Math.max(...group.map((i) => state.tiles[i].houses))) return '必须均衡卖房（先卖同色其他地产上的）';
  return null;
}

export function checkMortgage(state, playerId, index) {
  const [tile, err] = ownedTile(state, playerId, index);
  if (err) return err;
  if (state.tiles[index].mortgaged) return '已经抵押了';
  if (tile.group && groupTiles(tile.group).some((i) => state.tiles[i].houses > 0)) return '请先卖掉同色地产上的房子';
  return null;
}

export function checkUnmortgage(state, playerId, index) {
  const [tile, err] = ownedTile(state, playerId, index);
  if (err) return err;
  if (!state.tiles[index].mortgaged) return '没有抵押';
  const p = state.players.find((x) => x.id === playerId);
  if (p.money < unmortgageCost(tile)) return '钱不够';
  return null;
}

/** 交易时某块地是否可以转让（同色有房子则不行） */
export function tradable(state, index) {
  const tile = TILES[index];
  return isOwnable(tile) && !(tile.group && groupTiles(tile.group).some((i) => state.tiles[i].houses > 0));
}
