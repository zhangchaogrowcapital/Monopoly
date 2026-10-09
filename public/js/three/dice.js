// 3D 骰子：抛出、翻滚、落定到指定点数
import * as THREE from 'three';
import { BOARD_TOP } from './board.js';

const SIZE = 0.62;
// BoxGeometry 材质顺序：+x, -x, +y, -y, +z, -z
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
// 让某个点数朝上的旋转（YXZ 顺序下的 x / z 分量）
const UP_ROT = {
  1: [0, 0], 6: [Math.PI, 0], 2: [-Math.PI / 2, 0], 5: [Math.PI / 2, 0], 3: [0, Math.PI / 2], 4: [0, -Math.PI / 2],
};
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.23], [0.73, 0.23], [0.27, 0.5], [0.73, 0.5], [0.27, 0.77], [0.73, 0.77]],
};

function faceTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9e4da';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#fffdf7';
  ctx.beginPath();
  ctx.roundRect(4, 4, 120, 120, 22);
  ctx.fill();
  for (const [x, y] of PIPS[n]) {
    ctx.fillStyle = n === 1 ? '#d62828' : '#1d1d1f';
    ctx.beginPath();
    ctx.arc(x * 128, y * 128, n === 1 ? 17 : 12, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const easeOutCubic = (k) => 1 - (1 - k) ** 3;

function bounce(k) {
  // 带两次小弹跳的落地曲线：0 → 1
  if (k < 0.6) return (k / 0.6) ** 2;
  if (k < 0.82) { const u = (k - 0.71) / 0.11; return 1 - 0.12 * (1 - u * u); }
  const u = (k - 0.91) / 0.09;
  return 1 - 0.03 * (1 - u * u);
}

export class Dice {
  constructor() {
    this.group = new THREE.Group();
    const mats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.35 }));
    const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    this.dice = [0, 1].map(() => {
      const m = new THREE.Mesh(geo, mats);
      m.castShadow = true;
      m.rotation.order = 'YXZ';
      this.group.add(m);
      return m;
    });
    this.dice[0].position.set(-0.5, BOARD_TOP + SIZE / 2, 0.2);
    this.dice[1].position.set(0.5, BOARD_TOP + SIZE / 2, -0.2);
    this.anim = null;
  }

  /** 播放掷骰动画，返回 Promise */
  roll(values, duration = 1200) {
    return new Promise((resolve) => {
      const plans = this.dice.map((d, k) => {
        const [rx, rz] = UP_ROT[values[k]];
        const yaw = (Math.random() - 0.5) * 1.2;
        const end = new THREE.Vector3((k === 0 ? -0.55 : 0.55) + (Math.random() - 0.5) * 0.5, BOARD_TOP + SIZE / 2, (Math.random() - 0.5) * 1.0);
        const start = new THREE.Vector3(end.x * 0.3 + (Math.random() - 0.5) * 2, BOARD_TOP + 3.2, end.z + 2.5);
        const spins = [2 + Math.floor(Math.random() * 2), 1 + Math.floor(Math.random() * 2), 2 + Math.floor(Math.random() * 2)];
        return {
          d, start, end,
          rotEnd: new THREE.Vector3(rx, yaw, rz),
          rotStart: new THREE.Vector3(rx + spins[0] * Math.PI * 2, yaw + spins[1] * Math.PI * 2, rz + spins[2] * Math.PI * 2),
        };
      });
      this.anim = { t0: performance.now(), duration, plans, resolve };
    });
  }

  update(now) {
    const a = this.anim;
    if (!a) return;
    const k = Math.min(1, (now - a.t0) / a.duration);
    const kb = bounce(k);
    const kr = easeOutCubic(k);
    for (const p of a.plans) {
      p.d.position.lerpVectors(p.start, p.end, k);
      p.d.position.y = p.start.y + (p.end.y - p.start.y) * kb;
      p.d.rotation.set(
        p.rotStart.x + (p.rotEnd.x - p.rotStart.x) * kr,
        p.rotStart.y + (p.rotEnd.y - p.rotStart.y) * kr,
        p.rotStart.z + (p.rotEnd.z - p.rotStart.z) * kr,
      );
    }
    if (k >= 1) {
      this.anim = null;
      a.resolve();
    }
  }

  /** 立即显示点数（跳过动画） */
  show(values) {
    this.dice.forEach((d, k) => {
      const [rx, rz] = UP_ROT[values[k]];
      d.rotation.set(rx, d.rotation.y, rz);
    });
  }
}
