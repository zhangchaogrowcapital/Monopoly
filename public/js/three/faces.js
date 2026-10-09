// 角色脸部绘制（Canvas 2D）：预设角色的卡通表情 + 照片角色的表情特效
import { characterById, CHARACTERS, CUSTOM_ID } from '/shared/characters.js';

const HEAD_COLORS = {
  cat: '#fff6e8', panda: '#ffffff', tiger: '#ff9a2e', robot: '#cfd8e3', rabbit: '#ffe3ee', penguin: '#24344d',
};

/** 根据玩家信息生成外观描述 */
export function lookFor({ characterId, custom, avatar } = {}) {
  if (characterId === CUSTOM_ID && avatar) {
    return {
      kind: 'photo',
      photo: avatar,
      body: custom?.bodyColor || '#1e88e5',
      hat: custom?.hat || 'none',
      headColor: '#ffe0c8',
      style: 'photo',
    };
  }
  const c = characterById(characterId) || CHARACTERS[0];
  return {
    kind: 'preset',
    id: c.id,
    style: c.face,
    body: c.body,
    accent: c.accent,
    ears: c.ears,
    head: c.head || 'sphere',
    accessory: c.accessory,
    headColor: HEAD_COLORS[c.face] || c.body,
  };
}

// ---------- 图片缓存 ----------
const imageCache = new Map();
export function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(url, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return imageCache.get(url);
}

// ---------- 基础图形 ----------
function heart(ctx, x, y, s, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 1.1, y - s * 0.45, x - s * 0.45, y - s * 1.15, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.45, y - s * 1.15, x + s * 1.1, y - s * 0.45, x, y + s * 0.35);
  ctx.fill();
  ctx.restore();
}

function drop(ctx, x, y, s, color = '#5ab4ff') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.bezierCurveTo(x + s * 0.8, y - s * 0.1, x + s * 0.7, y + s * 0.8, x, y + s * 0.8);
  ctx.bezierCurveTo(x - s * 0.7, y + s * 0.8, x - s * 0.8, y - s * 0.1, x, y - s);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(x - s * 0.25, y + s * 0.2, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function angerMark(ctx, x, y, s) {
  ctx.save();
  ctx.strokeStyle = '#e8202a';
  ctx.lineWidth = s * 0.22;
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((k * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(s * 0.25, -s * 0.9);
    ctx.quadraticCurveTo(s * 0.25, -s * 0.25, s * 0.9, -s * 0.25);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function sparkle(ctx, x, y, s, color = '#fff6a8') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s, y);
  ctx.quadraticCurveTo(x, y, x, y + s);
  ctx.quadraticCurveTo(x, y, x - s, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
  ctx.restore();
}

function blush(ctx, S, alpha = 0.55) {
  ctx.save();
  ctx.fillStyle = `rgba(255,110,140,${alpha})`;
  for (const x of [0.25, 0.75]) {
    ctx.beginPath();
    ctx.ellipse(x * S, 0.6 * S, 0.07 * S, 0.04 * S, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function sunglasses(ctx, S, y = 0.46) {
  ctx.save();
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 0.02 * S;
  for (const x of [0.34, 0.66]) {
    ctx.beginPath();
    ctx.roundRect((x - 0.12) * S, (y - 0.06) * S, 0.24 * S, 0.13 * S, [0.02 * S, 0.02 * S, 0.06 * S, 0.06 * S]);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(0.44 * S, (y - 0.03) * S);
  ctx.quadraticCurveTo(0.5 * S, (y - 0.06) * S, 0.56 * S, (y - 0.03) * S);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.22 * S, (y - 0.04) * S);
  ctx.lineTo(0.08 * S, (y - 0.07) * S);
  ctx.moveTo(0.78 * S, (y - 0.04) * S);
  ctx.lineTo(0.92 * S, (y - 0.07) * S);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const x of [0.27, 0.59]) {
    ctx.beginPath();
    ctx.ellipse(x * S, (y - 0.02) * S, 0.035 * S, 0.015 * S, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- 预设角色的五官 ----------
function eyes(ctx, S, expr, ink, glow) {
  const L = 0.36;
  const R = 0.64;
  const Y = 0.47;
  ctx.save();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.028 * S;
  if (glow) { ctx.shadowColor = ink; ctx.shadowBlur = 0.04 * S; }
  const dotEye = (x, y, rx = 0.045, ry = 0.062, look = [0, 0]) => {
    ctx.beginPath();
    ctx.ellipse(x * S, y * S, rx * S, ry * S, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!glow) {
      ctx.save();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc((x - 0.015 + look[0]) * S, (y - 0.022 + look[1]) * S, 0.017 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  };
  switch (expr) {
    case 'happy':
      for (const x of [L, R]) {
        ctx.beginPath();
        ctx.arc(x * S, (Y + 0.02) * S, 0.05 * S, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      break;
    case 'laugh':
      for (const [x, d] of [[L, 1], [R, -1]]) {
        ctx.beginPath();
        ctx.moveTo((x - 0.045 * d) * S, (Y - 0.04) * S);
        ctx.lineTo((x + 0.035 * d) * S, Y * S);
        ctx.lineTo((x - 0.045 * d) * S, (Y + 0.04) * S);
        ctx.stroke();
      }
      break;
    case 'love':
      ctx.shadowBlur = 0;
      heart(ctx, L * S, (Y + 0.02) * S, 0.07 * S, '#ff2d55');
      heart(ctx, R * S, (Y + 0.02) * S, 0.07 * S, '#ff2d55');
      break;
    case 'cool':
      break; // 墨镜单独绘制
    case 'surprised':
      for (const x of [L, R]) {
        ctx.save();
        ctx.fillStyle = glow ? 'rgba(0,0,0,0)' : '#fff';
        ctx.beginPath();
        ctx.arc(x * S, Y * S, 0.07 * S, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 0.016 * S;
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x * S, Y * S, 0.026 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'thinking':
      dotEye(L, Y, 0.045, 0.062, [0.02, -0.01]);
      ctx.beginPath();
      ctx.moveTo((R - 0.05) * S, (Y + 0.005) * S);
      ctx.lineTo((R + 0.05) * S, (Y - 0.005) * S);
      ctx.stroke();
      break;
    case 'sad':
      dotEye(L, Y + 0.01, 0.042, 0.055);
      dotEye(R, Y + 0.01, 0.042, 0.055);
      break;
    case 'angry':
      dotEye(L, Y + 0.01, 0.045, 0.05);
      dotEye(R, Y + 0.01, 0.045, 0.05);
      break;
    default:
      dotEye(L, Y);
      dotEye(R, Y);
  }
  ctx.restore();
}

function brows(ctx, S, expr, ink) {
  const lines = {
    surprised: [[0.29, 0.34, 0.43, 0.33, -0.03], [0.57, 0.33, 0.71, 0.34, -0.03]],
    sad: [[0.28, 0.39, 0.43, 0.35, 0], [0.57, 0.35, 0.72, 0.39, 0]],
    angry: [[0.27, 0.35, 0.44, 0.41, 0], [0.56, 0.41, 0.73, 0.35, 0]],
    thinking: [[0.29, 0.37, 0.43, 0.38, 0], [0.57, 0.33, 0.71, 0.36, -0.02]],
  }[expr];
  if (!lines) return;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = (expr === 'angry' ? 0.03 : 0.022) * S;
  for (const [x1, y1, x2, y2, bend] of lines) {
    ctx.beginPath();
    ctx.moveTo(x1 * S, y1 * S);
    ctx.quadraticCurveTo(((x1 + x2) / 2) * S, ((y1 + y2) / 2 + bend) * S, x2 * S, y2 * S);
    ctx.stroke();
  }
  ctx.restore();
}

function mouth(ctx, S, expr, ink, glow, style) {
  const X = 0.5;
  const Y = style === 'penguin' ? 0.69 : 0.65;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = glow ? ink : '#7a1f2b';
  ctx.lineWidth = 0.022 * S;
  ctx.lineCap = 'round';
  if (glow) { ctx.shadowColor = ink; ctx.shadowBlur = 0.04 * S; }
  const tongue = () => {
    if (glow) return;
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#ff6b81';
    ctx.beginPath();
    ctx.ellipse(X * S, (Y + 0.075) * S, 0.05 * S, 0.035 * S, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  switch (expr) {
    case 'happy':
    case 'love':
      ctx.beginPath();
      ctx.moveTo((X - 0.08) * S, Y * S);
      ctx.quadraticCurveTo(X * S, (Y + 0.14) * S, (X + 0.08) * S, Y * S);
      ctx.closePath();
      ctx.fill();
      tongue();
      break;
    case 'laugh':
      ctx.beginPath();
      ctx.moveTo((X - 0.11) * S, (Y - 0.01) * S);
      ctx.quadraticCurveTo(X * S, (Y + 0.2) * S, (X + 0.11) * S, (Y - 0.01) * S);
      ctx.closePath();
      ctx.fill();
      tongue();
      break;
    case 'cool':
      ctx.beginPath();
      ctx.moveTo((X - 0.07) * S, (Y + 0.01) * S);
      ctx.quadraticCurveTo((X + 0.02) * S, (Y + 0.05) * S, (X + 0.08) * S, (Y - 0.02) * S);
      ctx.stroke();
      break;
    case 'surprised':
      ctx.beginPath();
      ctx.ellipse(X * S, (Y + 0.03) * S, 0.038 * S, 0.05 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'thinking':
      ctx.beginPath();
      ctx.moveTo((X - 0.04) * S, (Y + 0.02) * S);
      ctx.bezierCurveTo((X - 0.01) * S, (Y - 0.01) * S, (X + 0.02) * S, (Y + 0.05) * S, (X + 0.06) * S, (Y + 0.01) * S);
      ctx.stroke();
      break;
    case 'sad':
      ctx.beginPath();
      ctx.moveTo((X - 0.06) * S, (Y + 0.05) * S);
      ctx.quadraticCurveTo(X * S, (Y - 0.02) * S, (X + 0.06) * S, (Y + 0.05) * S);
      ctx.stroke();
      break;
    case 'angry':
      ctx.beginPath();
      ctx.moveTo((X - 0.08) * S, (Y + 0.06) * S);
      ctx.quadraticCurveTo(X * S, (Y - 0.03) * S, (X + 0.08) * S, (Y + 0.06) * S);
      ctx.closePath();
      ctx.fill();
      if (!glow) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.012 * S;
        ctx.beginPath();
        ctx.moveTo((X - 0.05) * S, (Y + 0.035) * S);
        ctx.lineTo((X + 0.05) * S, (Y + 0.035) * S);
        ctx.stroke();
      }
      break;
    default:
      ctx.beginPath();
      ctx.arc(X * S, (Y - 0.02) * S, 0.05 * S, Math.PI * 0.2, Math.PI * 0.8);
      ctx.stroke();
  }
  ctx.restore();
}

function styleBase(ctx, S, style) {
  ctx.save();
  switch (style) {
    case 'panda':
      ctx.fillStyle = '#1f1f1f';
      for (const [x, r] of [[0.35, 0.35], [0.65, -0.35]]) {
        ctx.beginPath();
        ctx.ellipse(x * S, 0.48 * S, 0.1 * S, 0.12 * S, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(0.5 * S, 0.575 * S, 0.035 * S, 0.025 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'tiger': {
      ctx.fillStyle = '#fff3df';
      ctx.beginPath();
      ctx.ellipse(0.5 * S, 0.66 * S, 0.17 * S, 0.12 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3a2a1a';
      ctx.font = `bold ${0.13 * S}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('王', 0.5 * S, 0.25 * S);
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 0.022 * S;
      ctx.lineCap = 'round';
      for (const d of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const x = 0.5 + d * (0.3 + k * 0.05);
          ctx.beginPath();
          ctx.moveTo(x * S, (0.42 + k * 0.08) * S);
          ctx.lineTo((x + d * 0.08) * S, (0.43 + k * 0.08) * S);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#5a3a2a';
      ctx.beginPath();
      ctx.ellipse(0.5 * S, 0.575 * S, 0.035 * S, 0.022 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cat':
      ctx.fillStyle = '#ff9eb0';
      ctx.beginPath();
      ctx.moveTo(0.47 * S, 0.565 * S);
      ctx.lineTo(0.53 * S, 0.565 * S);
      ctx.lineTo(0.5 * S, 0.6 * S);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8b7b70';
      ctx.lineWidth = 0.01 * S;
      for (const d of [-1, 1]) {
        for (let k = -1; k <= 1; k++) {
          ctx.beginPath();
          ctx.moveTo((0.5 + d * 0.16) * S, (0.6 + k * 0.025) * S);
          ctx.lineTo((0.5 + d * 0.32) * S, (0.59 + k * 0.05) * S);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#ffb347';
      ctx.beginPath();
      ctx.ellipse(0.66 * S, 0.24 * S, 0.1 * S, 0.07 * S, 0.3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rabbit':
      ctx.fillStyle = '#ff6fa3';
      ctx.beginPath();
      ctx.ellipse(0.5 * S, 0.58 * S, 0.028 * S, 0.02 * S, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'robot':
      ctx.fillStyle = '#16202e';
      ctx.beginPath();
      ctx.roundRect(0.18 * S, 0.3 * S, 0.64 * S, 0.48 * S, 0.08 * S);
      ctx.fill();
      ctx.strokeStyle = '#5b6b80';
      ctx.lineWidth = 0.015 * S;
      ctx.stroke();
      break;
    case 'penguin':
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0.38 * S, 0.53 * S, 0.17 * S, 0.22 * S, 0.15, 0, Math.PI * 2);
      ctx.ellipse(0.62 * S, 0.53 * S, 0.17 * S, 0.22 * S, -0.15, 0, Math.PI * 2);
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();
}

function penguinBeak(ctx, S, expr) {
  ctx.save();
  ctx.fillStyle = '#ffb02e';
  const open = ['happy', 'laugh', 'surprised', 'love', 'angry'].includes(expr);
  ctx.beginPath();
  ctx.moveTo(0.44 * S, 0.585 * S);
  ctx.lineTo(0.56 * S, 0.585 * S);
  ctx.lineTo(0.5 * S, (open ? 0.62 : 0.64) * S);
  ctx.closePath();
  ctx.fill();
  if (open) {
    ctx.beginPath();
    ctx.moveTo(0.455 * S, 0.64 * S);
    ctx.lineTo(0.545 * S, 0.64 * S);
    ctx.lineTo(0.5 * S, 0.68 * S);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function extras(ctx, S, expr, glow) {
  switch (expr) {
    case 'happy':
    case 'love':
      if (!glow) blush(ctx, S);
      break;
    case 'laugh':
      if (!glow) blush(ctx, S);
      drop(ctx, 0.25 * S, 0.5 * S, 0.035 * S);
      drop(ctx, 0.75 * S, 0.5 * S, 0.035 * S);
      break;
    case 'sad':
      drop(ctx, 0.36 * S, 0.58 * S, 0.045 * S);
      break;
    case 'angry':
      angerMark(ctx, 0.76 * S, 0.24 * S, 0.06 * S);
      if (!glow) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,40,40,0.18)';
        ctx.fillRect(0, 0, S, 0.36 * S);
        ctx.restore();
      }
      break;
    case 'thinking':
      drop(ctx, 0.76 * S, 0.3 * S, 0.04 * S, '#9fd8ff');
      break;
    case 'cool':
      sparkle(ctx, 0.78 * S, 0.36 * S, 0.04 * S);
      break;
    default:
      break;
  }
}

/** 预设角色的脸（透明背景，贴在头部正面） */
export function drawPresetFace(ctx, S, style, expr) {
  ctx.clearRect(0, 0, S, S);
  const glow = style === 'robot';
  const ink = glow ? '#4ff2ff' : '#2b2b2b';
  styleBase(ctx, S, style);
  if (style === 'panda' && ['happy', 'laugh', 'thinking'].includes(expr)) {
    eyes(ctx, S, expr, '#ffffff', false);
  } else {
    eyes(ctx, S, expr, ink, glow);
  }
  brows(ctx, S, expr, style === 'panda' ? '#1f1f1f' : ink);
  if (expr === 'cool') sunglasses(ctx, S);
  if (style === 'penguin') penguinBeak(ctx, S, expr);
  else mouth(ctx, S, expr, ink, glow, style);
  extras(ctx, S, expr, glow);
}

/** 照片角色：圆形照片 + 表情特效。eyeY 为眼睛高度（裁剪时对齐的参考线） */
export function drawPhotoFace(ctx, S, img, expr, { round = true } = {}) {
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  if (round) {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  if (img) ctx.drawImage(img, 0, 0, S, S);
  else {
    ctx.fillStyle = '#ffe0c8';
    ctx.fillRect(0, 0, S, S);
  }
  // 整体色调
  const tint = { sad: 'rgba(60,110,220,0.22)', angry: 'rgba(255,40,30,0.22)', love: 'rgba(255,120,180,0.15)' }[expr];
  if (tint) {
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, tint);
    g.addColorStop(expr === 'love' ? 1 : 0.6, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  ctx.restore();

  const eyeY = 0.43;
  switch (expr) {
    case 'happy':
      blush(ctx, S, 0.45);
      sparkle(ctx, 0.15 * S, 0.25 * S, 0.05 * S);
      sparkle(ctx, 0.86 * S, 0.3 * S, 0.035 * S);
      break;
    case 'laugh':
      blush(ctx, S, 0.45);
      drop(ctx, 0.2 * S, (eyeY + 0.06) * S, 0.04 * S);
      drop(ctx, 0.8 * S, (eyeY + 0.06) * S, 0.04 * S);
      ctx.save();
      ctx.font = `bold ${0.11 * S}px sans-serif`;
      ctx.fillStyle = '#ffcc00';
      ctx.strokeStyle = '#7a4a00';
      ctx.lineWidth = 0.012 * S;
      ctx.textAlign = 'center';
      ctx.strokeText('哈哈', 0.5 * S, 0.93 * S);
      ctx.fillText('哈哈', 0.5 * S, 0.93 * S);
      ctx.restore();
      break;
    case 'love':
      blush(ctx, S, 0.5);
      heart(ctx, 0.2 * S, 0.2 * S, 0.07 * S, '#ff2d55');
      heart(ctx, 0.82 * S, 0.16 * S, 0.05 * S, '#ff5c8a');
      heart(ctx, 0.85 * S, 0.8 * S, 0.06 * S, '#ff2d55');
      break;
    case 'cool':
      sunglasses(ctx, S, eyeY);
      sparkle(ctx, 0.8 * S, 0.3 * S, 0.05 * S);
      break;
    case 'surprised': {
      ctx.save();
      ctx.strokeStyle = 'rgba(40,40,120,0.75)';
      ctx.lineWidth = 0.012 * S;
      for (let k = 0; k < 5; k++) {
        const x = (0.32 + k * 0.09) * S;
        ctx.beginPath();
        ctx.moveTo(x, 0.04 * S);
        ctx.lineTo(x, 0.2 * S);
        ctx.stroke();
      }
      ctx.font = `bold ${0.16 * S}px sans-serif`;
      ctx.fillStyle = '#ff3b30';
      ctx.fillText('!', 0.83 * S, 0.3 * S);
      ctx.restore();
      break;
    }
    case 'thinking':
      ctx.save();
      ctx.font = `bold ${0.14 * S}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 0.012 * S;
      ctx.strokeText('?', 0.8 * S, 0.24 * S);
      ctx.fillText('?', 0.8 * S, 0.24 * S);
      ctx.restore();
      drop(ctx, 0.18 * S, 0.3 * S, 0.04 * S, '#9fd8ff');
      break;
    case 'sad':
      ctx.save();
      ctx.fillStyle = 'rgba(90,180,255,0.75)';
      for (const x of [0.36, 0.64]) {
        ctx.beginPath();
        ctx.roundRect((x - 0.025) * S, (eyeY + 0.04) * S, 0.05 * S, 0.3 * S, 0.025 * S);
        ctx.fill();
      }
      ctx.restore();
      break;
    case 'angry':
      angerMark(ctx, 0.78 * S, 0.2 * S, 0.08 * S);
      break;
    default:
      break;
  }
}

/** 2D 头像图标（HUD、列表用）：圆形头部 + 表情 */
export async function renderIcon(canvas, look, expr = 'neutral') {
  const S = canvas.width;
  const ctx = canvas.getContext('2d');
  if (look.kind === 'photo') {
    const img = await loadImage(look.photo);
    drawPhotoFace(ctx, S, img, expr);
    return;
  }
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = S;
  drawPresetFace(tmp.getContext('2d'), S, look.style, expr);
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = look.headColor;
  ctx.fillRect(0, 0, S, S);
  // 稍微放大五官，让图标更清晰
  ctx.drawImage(tmp, -S * 0.15, -S * 0.12, S * 1.3, S * 1.3);
  ctx.restore();
}
