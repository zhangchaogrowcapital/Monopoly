// 3D 棋盘：一张大画布绘制所有格子 + 房屋/酒店/归属标记/高亮
import * as THREE from 'three';
import { TILES, GROUPS } from '/shared/board.js';

export const TILE_W = 1;
export const TILE_D = 1.6;
export const HALF = (9 * TILE_W + 2 * TILE_D) / 2; // 6.1
export const BOARD_TOP = 0.3;
const TEX = 2048;
const K = TEX / (HALF * 2);
const FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

/** 格子所在的边：0 下、1 左、2 上、3 右 */
export const sideOf = (i) => Math.floor(i / 10);

/** 格子中心（世界坐标 x,z） */
export function tileCenter(i) {
  const c = HALF - TILE_D / 2;
  const k = i % 10;
  const along = HALF - TILE_D - (k - 0.5) * TILE_W;
  switch (sideOf(i)) {
    case 0: return k === 0 ? [c, c] : [along, c];
    case 1: return k === 0 ? [-c, c] : [-c, along];
    case 2: return k === 0 ? [-c, -c] : [-along, -c];
    default: return k === 0 ? [c, -c] : [c, -along];
  }
}

/** 从外往里看时格子“向内”的方向 */
export function inwardDir(i) {
  return [[0, -1], [1, 0], [0, 1], [-1, 0]][sideOf(i)];
}

/** 沿着格子行进方向（顺时针绕棋盘） */
export function alongDir(i) {
  return [[-1, 0], [0, -1], [1, 0], [0, 1]][sideOf(i)];
}

export function tileAt(x, z) {
  if (Math.abs(x) > HALF || Math.abs(z) > HALF) return -1;
  const inner = HALF - TILE_D;
  if (Math.abs(x) < inner && Math.abs(z) < inner) return -1;
  for (let i = 0; i < 40; i++) {
    const [cx, cz] = tileCenter(i);
    const corner = i % 10 === 0;
    const s = sideOf(i);
    const hw = corner ? TILE_D / 2 : (s % 2 === 0 ? TILE_W / 2 : TILE_D / 2);
    const hd = corner ? TILE_D / 2 : (s % 2 === 0 ? TILE_D / 2 : TILE_W / 2);
    if (Math.abs(x - cx) <= hw && Math.abs(z - cz) <= hd) return i;
  }
  return -1;
}

const ICONS = {
  chance: '❓', fate: '⭐', station: '🚄', tax: '💰', go: '🏁', jail: '🔒', parking: '🅿️', gotojail: '👮',
};

function wrapText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const mid = Math.ceil(text.length / 2);
  return [text.slice(0, mid), text.slice(mid)];
}

/** 格子在画布上的矩形（像素） */
function tileRect(i) {
  const [cx, cz] = tileCenter(i);
  const corner = i % 10 === 0;
  const horizontal = sideOf(i) % 2 === 0;
  const w = (corner ? TILE_D : horizontal ? TILE_W : TILE_D) * K;
  const h = (corner ? TILE_D : horizontal ? TILE_D : TILE_W) * K;
  return { x: (cx + HALF) * K - w / 2, y: (cz + HALF) * K - h / 2, w, h };
}

function fitFont(ctx, text, size, maxWidth, weight = 'bold') {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > 10 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
}

// 所有文字都朝向默认镜头（正立），色带始终在靠近棋盘中心的一侧
function drawTile(ctx, tile) {
  const i = tile.index;
  const r = tileRect(i);
  const side = sideOf(i);
  const U = TILE_W * K; // 一个单位格宽
  ctx.save();
  ctx.fillStyle = '#fbf6e9';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = '#3d3a33';
  ctx.lineWidth = 3;
  ctx.strokeRect(r.x, r.y, r.w, r.h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2a2723';

  if (i % 10 === 0) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const big = { go: '起点', jail: '监狱', parking: '免费停车', gotojail: '入狱' }[tile.type];
    ctx.font = `${U * 0.5}px ${FONT}`;
    ctx.fillText(ICONS[tile.type], cx, cy - U * 0.22);
    ctx.font = `900 ${tile.type === 'parking' ? U * 0.24 : U * 0.3}px ${FONT}`;
    ctx.fillStyle = tile.type === 'go' ? '#d62828' : tile.type === 'gotojail' ? '#1d4ed8' : '#2a2723';
    ctx.fillText(big, cx, cy + U * 0.3);
    ctx.font = `bold ${U * 0.14}px ${FONT}`;
    ctx.fillStyle = '#5b5348';
    if (tile.type === 'go') ctx.fillText('经过领 ¥200 ←', cx, cy + U * 0.58);
    if (tile.type === 'jail') ctx.fillText('路过只是探监', cx, cy + U * 0.58);
    ctx.restore();
    return;
  }

  // 色带 / 文字区域
  const bandT = TILE_D * 0.24 * K;
  let area = { ...r };
  if (tile.type === 'property') {
    ctx.fillStyle = GROUPS[tile.group].color;
    let band;
    if (side === 0) { band = [r.x, r.y, r.w, bandT]; area = { x: r.x, y: r.y + bandT, w: r.w, h: r.h - bandT }; }
    else if (side === 2) { band = [r.x, r.y + r.h - bandT, r.w, bandT]; area = { x: r.x, y: r.y, w: r.w, h: r.h - bandT }; }
    else if (side === 1) { band = [r.x + r.w - bandT, r.y, bandT, r.h]; area = { x: r.x, y: r.y, w: r.w - bandT, h: r.h }; }
    else { band = [r.x, r.y, bandT, r.h]; area = { x: r.x + bandT, y: r.y, w: r.w - bandT, h: r.h }; }
    ctx.fillRect(...band);
    ctx.strokeRect(...band);
  }
  const cx = area.x + area.w / 2;
  const at = (k) => area.y + area.h * k;
  const maxW = area.w * 0.9;
  ctx.fillStyle = '#2a2723';
  if (tile.type === 'property') {
    fitFont(ctx, tile.name, U * 0.26, maxW, '900');
    ctx.fillText(tile.name, cx, at(0.27));
    ctx.font = `${U * 0.15}px ${FONT}`;
    ctx.fillStyle = '#6b6358';
    ctx.fillText(`租金 ¥${tile.rent[0]}`, cx, at(0.56));
    ctx.font = `bold ${U * 0.19}px ${FONT}`;
    ctx.fillStyle = '#2a2723';
    ctx.fillText(`¥${tile.price}`, cx, at(0.8));
  } else {
    let icon = ICONS[tile.type];
    if (tile.type === 'utility') icon = tile.name.includes('电') ? '⚡' : '💧';
    if (tile.type === 'tax' && tile.name.includes('奢侈')) icon = '💎';
    const tall = area.h > area.w;
    ctx.font = `bold ${U * 0.19}px ${FONT}`;
    const lines = tall ? wrapText(ctx, tile.name, maxW) : [tile.name];
    if (!tall) fitFont(ctx, tile.name, U * 0.19, maxW);
    lines.forEach((ln, k) => ctx.fillText(ln, cx, at(tall ? 0.14 : 0.2) + k * U * 0.21));
    ctx.font = `${U * (tall ? 0.42 : 0.32)}px ${FONT}`;
    ctx.fillText(icon, cx, at(tall ? 0.55 : 0.53));
    let foot = '';
    if (tile.price) foot = `¥${tile.price}`;
    else if (tile.type === 'tax') foot = `付 ¥${tile.amount}`;
    if (foot) {
      ctx.font = `bold ${U * 0.18}px ${FONT}`;
      ctx.fillText(foot, cx, at(tall ? 0.86 : 0.84));
    }
  }
  ctx.restore();
}

function drawCenter(ctx) {
  const inner = (HALF - TILE_D) * K;
  const c = HALF * K;
  // 中央底色
  const g = ctx.createRadialGradient(c, c, 50, c, c, inner * 1.4);
  g.addColorStop(0, '#d9f2e3');
  g.addColorStop(1, '#a8d8bc');
  ctx.fillStyle = g;
  ctx.fillRect(c - inner, c - inner, inner * 2, inner * 2);
  // 标志
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(-Math.PI / 4);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d62828';
  ctx.beginPath();
  ctx.roundRect(-440, -125, 880, 250, 40);
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 170px ${FONT}`;
  ctx.fillText('大富翁', 0, -10);
  ctx.font = `bold 46px ${FONT}`;
  ctx.fillStyle = '#ffe066';
  ctx.fillText('M O N O P O L Y   3 D', 0, 90);
  ctx.restore();
  // 卡堆位置
  const pile = (x, y, rot, color, title) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.roundRect(-150, -95, 300, 190, 18);
    ctx.fill();
    ctx.setLineDash([16, 10]);
    ctx.lineWidth = 6;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `bold 64px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, 0, 0);
    ctx.restore();
  };
  pile(c - inner * 0.52, c - inner * 0.52, -Math.PI / 4, '#f08c00', '机 会');
  pile(c + inner * 0.52, c + inner * 0.52, -Math.PI / 4, '#1971c2', '命 运');
}

export function createBoardTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#c8e6d0';
  ctx.fillRect(0, 0, TEX, TEX);
  drawCenter(ctx);
  for (const t of TILES) drawTile(ctx, t);
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#3d3a33';
  ctx.strokeRect(4, 4, TEX - 8, TEX - 8);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export class Board {
  constructor(renderer) {
    this.group = new THREE.Group();
    this.tex = createBoardTexture(renderer);
    const size = HALF * 2;
    const side = new THREE.MeshStandardMaterial({ color: '#7a4b2a', roughness: 0.7 });
    const top = new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.85 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(size, BOARD_TOP, size), [side, side, top, side, side, side]);
    box.position.y = BOARD_TOP / 2;
    box.receiveShadow = true;
    box.castShadow = true;
    box.name = 'board';
    this.mesh = box;
    this.group.add(box);
    // 木质边框
    const frameMat = new THREE.MeshStandardMaterial({ color: '#5c3a21', roughness: 0.6 });
    for (let k = 0; k < 4; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(size + 0.5, 0.42, 0.25), frameMat);
      const a = (k * Math.PI) / 2;
      bar.position.set(Math.sin(a) * (HALF + 0.125), 0.21, Math.cos(a) * (HALF + 0.125));
      bar.rotation.y = a;
      bar.castShadow = true;
      bar.receiveShadow = true;
      this.group.add(bar);
    }

    this.owners = new Map();
    this.houses = new Map();
    this.mortgageMarks = new Map();
    this.houseGeo = new THREE.BoxGeometry(0.17, 0.14, 0.17);
    this.roofGeo = new THREE.ConeGeometry(0.14, 0.1, 4);
    this.roofGeo.rotateY(Math.PI / 4);
    this.hotelGeo = new THREE.BoxGeometry(0.5, 0.22, 0.24);
    this.houseMat = new THREE.MeshStandardMaterial({ color: '#2fb344', roughness: 0.5 });
    this.roofMat = new THREE.MeshStandardMaterial({ color: '#1b7a2c', roughness: 0.5 });
    this.hotelMat = new THREE.MeshStandardMaterial({ color: '#e03131', roughness: 0.5 });

    // 高亮框
    const ringGeo = new THREE.RingGeometry(0.62, 0.7, 4, 1);
    ringGeo.rotateZ(Math.PI / 4); // 菱形转成正方形，之后只做缩放
    const hl = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: '#ffd43b', transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    hl.rotation.x = -Math.PI / 2;
    hl.visible = false;
    this.highlight = hl;
    this.group.add(hl);
    this.hoverMark = hl.clone();
    this.hoverMark.material = hl.material.clone();
    this.hoverMark.material.color.set('#ffffff');
    this.hoverMark.material.opacity = 0.6;
    this.group.add(this.hoverMark);
  }

  /** 让环形高亮框贴合格子 */
  fitRing(mesh, i) {
    if (i < 0) { mesh.visible = false; return; }
    const [x, z] = tileCenter(i);
    const corner = i % 10 === 0;
    const s = sideOf(i);
    const w = corner ? TILE_D : (s % 2 === 0 ? TILE_W : TILE_D);
    const d = corner ? TILE_D : (s % 2 === 0 ? TILE_D : TILE_W);
    mesh.position.set(x, BOARD_TOP + 0.012, z);
    mesh.scale.set(w * 1.02, d * 1.02, 1);
    mesh.visible = true;
  }

  setHighlight(i) { this.fitRing(this.highlight, i); }

  setHover(i) { this.fitRing(this.hoverMark, i); }

  /** 色带位置（建房的位置） */
  bandCenter(i) {
    const [x, z] = tileCenter(i);
    const [ix, iz] = inwardDir(i);
    const off = TILE_D / 2 - TILE_D * 0.12;
    return [x + ix * off, z + iz * off];
  }

  /** 外侧边缘（归属标记的位置） */
  edgeCenter(i) {
    const [x, z] = tileCenter(i);
    const [ix, iz] = inwardDir(i);
    const off = -(TILE_D / 2 - 0.1);
    return [x + ix * off, z + iz * off];
  }

  setOwner(i, color) {
    let m = this.owners.get(i);
    if (!color) {
      if (m) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose(); this.owners.delete(i); }
      return;
    }
    if (!m) {
      const s = sideOf(i);
      const corner = i % 10 === 0;
      const w = corner ? TILE_D : TILE_W;
      const geo = new THREE.BoxGeometry(s % 2 === 0 ? w * 0.86 : 0.13, 0.05, s % 2 === 0 ? 0.13 : w * 0.86);
      m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 }));
      const [x, z] = this.edgeCenter(i);
      m.position.set(x, BOARD_TOP + 0.025, z);
      m.castShadow = true;
      this.group.add(m);
      this.owners.set(i, m);
    }
    m.material.color.set(color);
    m.material.emissive.set(color);
  }

  setMortgaged(i, mortgaged) {
    let m = this.mortgageMarks.get(i);
    if (!mortgaged) {
      if (m) m.visible = false;
      return;
    }
    if (!m) {
      const s = sideOf(i);
      const geo = new THREE.PlaneGeometry(s % 2 === 0 ? TILE_W * 0.98 : TILE_D * 0.98, s % 2 === 0 ? TILE_D * 0.98 : TILE_W * 0.98);
      m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.38, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      const [x, z] = tileCenter(i);
      m.position.set(x, BOARD_TOP + 0.006, z);
      this.group.add(m);
      this.mortgageMarks.set(i, m);
    }
    m.visible = true;
  }

  setHouses(i, n) {
    let g = this.houses.get(i);
    if (g && g.userData.n === n) return;
    if (g) { g.removeFromParent(); this.houses.delete(i); }
    if (!n) return;
    g = new THREE.Group();
    g.userData.n = n;
    const [x, z] = this.bandCenter(i);
    g.position.set(x, BOARD_TOP, z);
    g.rotation.y = [0, -Math.PI / 2, Math.PI, Math.PI / 2][sideOf(i)];
    if (n >= 5) {
      const hotel = new THREE.Mesh(this.hotelGeo, this.hotelMat);
      hotel.position.y = 0.11;
      hotel.castShadow = true;
      g.add(hotel);
    } else {
      for (let k = 0; k < n; k++) {
        const hx = (k - (n - 1) / 2) * 0.22;
        const h = new THREE.Mesh(this.houseGeo, this.houseMat);
        h.position.set(hx, 0.07, 0);
        h.castShadow = true;
        const r = new THREE.Mesh(this.roofGeo, this.roofMat);
        r.position.set(hx, 0.19, 0);
        r.castShadow = true;
        g.add(h, r);
      }
    }
    this.group.add(g);
    this.houses.set(i, g);
  }

  /** 按游戏状态刷新归属/房屋/抵押 */
  sync(state) {
    const colorOf = new Map(state.players.map((p) => [p.id, p.color]));
    state.tiles.forEach((ts, i) => {
      this.setOwner(i, ts.owner ? colorOf.get(ts.owner) : null);
      this.setHouses(i, ts.houses);
      this.setMortgaged(i, ts.owner && ts.mortgaged);
    });
  }

  /** 角色在格子上的站位（多人同格时分散） */
  slotPosition(i, slot, count, inJail = false) {
    const [x, z] = tileCenter(i);
    const [ix, iz] = inwardDir(i);
    const [ax, az] = alongDir(i);
    const corner = i % 10 === 0;
    let a = 0;
    let b = 0; // a 沿行进方向，b 向内
    if (corner) {
      const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
      const rows = Math.ceil(count / cols);
      const c = slot % cols;
      const r = Math.floor(slot / cols);
      a = (c - (cols - 1) / 2) * 0.5;
      b = (r - (rows - 1) / 2) * 0.5;
      if (i === 10) {
        // 监狱格：坐牢的在内侧，探监的在外侧
        b = inJail ? 0.35 + r * 0.3 : -0.45;
        a = (c - (cols - 1) / 2) * 0.42;
      }
    } else {
      const rows = Math.ceil(count / 2);
      const c = count === 1 ? 0.5 : slot % 2;
      const r = Math.floor(slot / 2);
      a = (c - 0.5) * 0.44;
      b = 0.1 - (r - (rows - 1) / 2) * 0.42;
    }
    return new THREE.Vector3(x + ax * a + ix * b, BOARD_TOP, z + az * a + iz * b);
  }
}
