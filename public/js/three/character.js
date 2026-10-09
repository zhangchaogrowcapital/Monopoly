// 3D 角色模型：Q 版身体 + 表情脸 + 耳朵/帽子/配饰 + 表情动作
import * as THREE from 'three';
import { lookFor, drawPresetFace, drawPhotoFace, loadImage } from './faces.js';

const FACE_SIZE = 512;
const FACE_SPAN = Math.PI * 0.72;
const HEAD_R = 0.55;
const HEAD_Y = 1.48;

// 每种表情对应的动作
const EXPR_ANIM = {
  happy: 'jump', laugh: 'jump2', love: 'pop', cool: 'spin', surprised: 'pop', thinking: 'tilt', sad: 'droop', angry: 'shake',
};

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...opts });

function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f > 0) c.lerp(new THREE.Color('#ffffff'), f);
  else c.lerp(new THREE.Color('#000000'), -f);
  return c;
}

function stripesTexture(base, stripe) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = stripe;
  for (let k = 0; k < 6; k++) {
    const y = 30 + k * 36;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 16) ctx.lineTo(x, y + Math.sin(x / 20 + k) * 6);
    for (let x = 256; x >= 0; x -= 16) ctx.lineTo(x, y + 9 + Math.sin(x / 25 + k) * 4);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

function partyHatTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const colors = ['#ff4d6d', '#ffd60a', '#4cc9f0', '#80ed99'];
  for (let k = 0; k < 8; k++) {
    ctx.fillStyle = colors[k % colors.length];
    ctx.fillRect(k * 16, 0, 16, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Character {
  /**
   * @param {{characterId:string, custom?:object, avatar?:string}} info
   * @param {{seatColor?:string}} opts
   */
  constructor(info, { seatColor = null } = {}) {
    this.look = lookFor(info);
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.expr = 'neutral';
    this.exprUntil = 0;
    this.anim = null;
    this.phase = Math.random() * Math.PI * 2;
    this.dead = false;
    this.photoImg = null;
    this.disposables = [];

    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = this.faceCanvas.height = FACE_SIZE;
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    this.faceTex.anisotropy = 4;
    this.disposables.push(this.faceTex);

    this.build(seatColor);
    this.redrawFace();
    if (this.look.kind === 'photo') {
      loadImage(this.look.photo).then((img) => {
        this.photoImg = img;
        this.redrawFace();
      });
    }
    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
    });
  }

  add(parent, geo, material, pos = [0, 0, 0], rot = null, scale = null) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    if (scale) m.scale.set(...scale);
    parent.add(m);
    this.disposables.push(geo);
    if (!this.disposables.includes(material)) this.disposables.push(material);
    return m;
  }

  build(seatColor) {
    const L = this.look;
    const isPhoto = L.kind === 'photo';
    const bodyColor = L.body;
    const bodyMat = L.style === 'tiger'
      ? mat('#ffffff', { map: stripesTexture(bodyColor, '#3a2a1a') })
      : mat(bodyColor, L.style === 'robot' ? { metalness: 0.55, roughness: 0.35 } : {});
    if (bodyMat.map) this.disposables.push(bodyMat.map);
    const limbColor = {
      panda: '#222222', penguin: '#24344d', robot: '#7d8ea3', tiger: '#e8801c',
    }[L.style] || (isPhoto ? '#ffe0c8' : shade(bodyColor, -0.08));
    const limbMat = mat(limbColor);
    const footMat = mat(L.style === 'penguin' ? '#ffb02e' : (isPhoto ? '#3b3b3b' : shade(limbColor, -0.1)));
    const bellyColor = L.style === 'robot' ? '#e9eef5' : (L.style === 'penguin' ? '#ffffff' : shade(bodyColor, 0.55));

    // 底座：显示玩家颜色
    if (seatColor) {
      this.add(this.group, new THREE.CylinderGeometry(0.62, 0.68, 0.08, 40), mat(seatColor, { roughness: 0.4 }), [0, 0.04, 0]);
      this.add(this.group, new THREE.TorusGeometry(0.64, 0.035, 8, 40), mat('#ffffff', { roughness: 0.3 }), [0, 0.085, 0], [Math.PI / 2, 0, 0]);
    }
    const base = seatColor ? 0.08 : 0;
    this.body.position.y = base;

    // 脚
    for (const x of [-0.2, 0.2]) this.add(this.body, new THREE.SphereGeometry(0.16, 20, 14), footMat, [x, 0.08, 0.06], null, [1, 0.6, 1.35]);
    // 身体
    this.torso = this.add(this.body, new THREE.CapsuleGeometry(0.42, 0.34, 8, 24), bodyMat, [0, 0.64, 0], null, [1, 1, 0.92]);
    // 肚皮
    this.add(this.body, new THREE.SphereGeometry(0.32, 24, 16), mat(bellyColor), [0, 0.58, 0.25], null, [1, 1.12, 0.55]);
    if (L.style === 'robot') {
      ['#ff5252', '#ffd740', '#69f0ae'].forEach((c, k) => {
        this.add(this.body, new THREE.SphereGeometry(0.045, 12, 8), mat(c, { emissive: c, emissiveIntensity: 0.6 }), [-0.1 + k * 0.1, 0.62, 0.42]);
      });
    }
    // 手
    this.arms = [];
    for (const d of [-1, 1]) {
      const scale = L.style === 'penguin' ? [0.55, 1.5, 0.9] : [1, 1, 1];
      this.arms.push(this.add(this.body, new THREE.SphereGeometry(0.14, 16, 12), limbMat, [d * 0.47, 0.66, 0.05], [0, 0, d * 0.3], scale));
    }

    // 头（可以单独倾斜）
    this.head = new THREE.Group();
    this.head.position.y = HEAD_Y - 0.25;
    this.body.add(this.head);
    const hy = 0.25;
    const headMat = mat(L.headColor, L.style === 'robot' ? { metalness: 0.5, roughness: 0.35 } : {});
    const faceMat = new THREE.MeshStandardMaterial({
      map: this.faceTex, transparent: true, roughness: 0.6, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.disposables.push(faceMat);

    if (L.head === 'box') {
      this.add(this.head, new THREE.BoxGeometry(1.05, 0.88, 0.9, 2, 2, 2), headMat, [0, hy, 0]);
      this.add(this.head, new THREE.PlaneGeometry(1.0, 0.88), faceMat, [0, hy, 0.452]);
      this.headTop = hy + 0.44;
    } else {
      const sx = isPhoto ? 1.0 : 1.05;
      this.add(this.head, new THREE.SphereGeometry(HEAD_R, 40, 28), headMat, [0, hy, 0], null, [sx, 0.95, 1]);
      const thetaStart = Math.PI / 2 - FACE_SPAN / 2;
      this.add(this.head, new THREE.SphereGeometry(HEAD_R * 1.006, 48, 32, Math.PI / 2 - FACE_SPAN / 2, FACE_SPAN, thetaStart, FACE_SPAN), faceMat, [0, hy, 0], null, [sx, 0.95, 1]);
      this.headTop = hy + HEAD_R * 0.95;
    }

    this.buildEars(L.kind === 'photo' ? L.hat : L.ears, L, hy);
    if (isPhoto) this.buildHat(L.hat, L, hy);
    else this.buildAccessory(L.accessory, L, hy);

    // 标签锚点（名字、表情气泡）
    this.anchor = new THREE.Object3D();
    this.anchor.position.y = HEAD_Y + 0.9 + base;
    this.group.add(this.anchor);
  }

  buildEars(type, L, hy) {
    const top = this.headTop;
    const earColor = { panda: '#222222', tiger: '#ff9a2e', cat: '#fff6e8' }[L.style] || (L.kind === 'photo' ? L.body : L.body);
    const inner = mat('#ffb3c7');
    switch (type) {
      case 'cat':
        for (const d of [-1, 1]) {
          this.add(this.head, new THREE.ConeGeometry(0.17, 0.32, 4), mat(earColor), [d * 0.3, top - 0.05, -0.02], [0, Math.PI / 4, d * -0.38]);
          this.add(this.head, new THREE.ConeGeometry(0.1, 0.2, 4), inner, [d * 0.3, top - 0.06, 0.05], [0, Math.PI / 4, d * -0.38]);
        }
        break;
      case 'round':
        for (const d of [-1, 1]) {
          this.add(this.head, new THREE.SphereGeometry(0.17, 18, 12), mat(earColor), [d * 0.38, top - 0.1, -0.05], null, [1, 1, 0.6]);
          if (L.style !== 'panda') this.add(this.head, new THREE.SphereGeometry(0.1, 14, 10), inner, [d * 0.38, top - 0.1, 0.02], null, [1, 1, 0.4]);
        }
        break;
      case 'long':
      case 'bunny': {
        const c = type === 'bunny' ? '#ffffff' : L.body;
        for (const d of [-1, 1]) {
          const ear = new THREE.Group();
          ear.position.set(d * 0.18, top - 0.08, -0.05);
          ear.rotation.z = d * -0.15;
          this.head.add(ear);
          this.add(ear, new THREE.CapsuleGeometry(0.1, 0.42, 6, 14), mat(c), [0, 0.3, 0], null, [1, 1, 0.55]);
          this.add(ear, new THREE.CapsuleGeometry(0.055, 0.34, 6, 10), inner, [0, 0.3, 0.04], null, [1, 1, 0.4]);
          if (d === 1) this.earR = ear; else this.earL = ear;
        }
        break;
      }
      case 'antenna':
        this.add(this.head, new THREE.CylinderGeometry(0.025, 0.025, 0.32, 8), mat('#5b6b80', { metalness: 0.6 }), [0, top + 0.15, 0]);
        this.antennaTip = this.add(this.head, new THREE.SphereGeometry(0.075, 16, 12), mat('#ff3d3d', { emissive: '#ff3d3d', emissiveIntensity: 0.9 }), [0, top + 0.33, 0]);
        for (const d of [-1, 1]) {
          this.add(this.head, new THREE.CylinderGeometry(0.11, 0.11, 0.12, 20), mat('#7d8ea3', { metalness: 0.6, roughness: 0.3 }), [d * 0.56, 0.25, 0], [0, 0, Math.PI / 2]);
        }
        break;
      default:
        break;
    }
  }

  buildAccessory(type, L, hy) {
    switch (type) {
      case 'bell':
        this.add(this.body, new THREE.TorusGeometry(0.37, 0.05, 10, 32), mat(L.accent), [0, 1.13, 0], [Math.PI / 2 + 0.1, 0, 0]);
        this.add(this.body, new THREE.SphereGeometry(0.09, 16, 12), mat('#ffcc33', { metalness: 0.8, roughness: 0.25 }), [0, 1.04, 0.38]);
        break;
      case 'scarf':
        this.add(this.body, new THREE.TorusGeometry(0.36, 0.08, 10, 32), mat(L.accent), [0, 1.13, 0], [Math.PI / 2 + 0.1, 0, 0]);
        this.add(this.body, new THREE.BoxGeometry(0.14, 0.32, 0.06), mat(L.accent), [0.2, 0.95, 0.36], [0.2, 0, 0.2]);
        break;
      case 'bow':
        for (const d of [-1, 1]) {
          this.add(this.head, new THREE.ConeGeometry(0.1, 0.2, 12), mat(L.accent), [0.28 + d * 0.11, this.headTop - 0.02, 0.12], [0, 0, d * Math.PI / 2]);
        }
        this.add(this.head, new THREE.SphereGeometry(0.06, 12, 10), mat(L.accent), [0.28, this.headTop - 0.02, 0.12]);
        break;
      case 'bamboo': {
        const stick = new THREE.Group();
        stick.position.set(0.55, 0.75, 0.12);
        stick.rotation.z = -0.25;
        this.body.add(stick);
        this.add(stick, new THREE.CylinderGeometry(0.045, 0.045, 1.0, 10), mat('#5cb85c'), [0, 0.2, 0]);
        for (const y of [-0.1, 0.2, 0.5]) this.add(stick, new THREE.TorusGeometry(0.047, 0.012, 6, 14), mat('#3d8b3d'), [0, y, 0], [Math.PI / 2, 0, 0]);
        this.add(stick, new THREE.SphereGeometry(0.1, 10, 8), mat('#7bd67b'), [0.08, 0.68, 0], null, [1.4, 0.35, 0.6]);
        break;
      }
      default:
        break;
    }
  }

  buildHat(type, L, hy) {
    const top = this.headTop;
    const gold = mat('#ffcc33', { metalness: 0.85, roughness: 0.25, side: THREE.DoubleSide });
    switch (type) {
      case 'crown': {
        const g = new THREE.Group();
        g.position.set(0, top - 0.06, 0);
        g.rotation.z = 0.08;
        this.head.add(g);
        this.add(g, new THREE.CylinderGeometry(0.3, 0.32, 0.2, 28, 1, true), gold, [0, 0.08, 0]);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          this.add(g, new THREE.ConeGeometry(0.065, 0.18, 8), gold, [Math.sin(a) * 0.3, 0.26, Math.cos(a) * 0.3]);
          this.add(g, new THREE.SphereGeometry(0.035, 10, 8), mat(['#ff3b30', '#2f80ed', '#34c759'][k % 3], { roughness: 0.2 }), [Math.sin(a) * 0.31, 0.08, Math.cos(a) * 0.31]);
        }
        break;
      }
      case 'tophat': {
        const g = new THREE.Group();
        g.position.set(0, top - 0.04, 0);
        g.rotation.z = -0.08;
        this.head.add(g);
        const black = mat('#1d1d1f', { roughness: 0.4 });
        this.add(g, new THREE.CylinderGeometry(0.48, 0.48, 0.04, 32), black, [0, 0.02, 0]);
        this.add(g, new THREE.CylinderGeometry(0.29, 0.3, 0.46, 32), black, [0, 0.25, 0]);
        this.add(g, new THREE.CylinderGeometry(0.305, 0.305, 0.09, 32), mat('#d62828'), [0, 0.09, 0]);
        break;
      }
      case 'cap': {
        const g = new THREE.Group();
        g.position.set(0, 0.25, 0);
        this.head.add(g);
        const c = mat(L.body, { side: THREE.DoubleSide });
        this.add(g, new THREE.SphereGeometry(HEAD_R * 1.04, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.6), c, [0, 0.04, 0], null, [1, 0.95, 1]);
        this.add(g, new THREE.CylinderGeometry(0.42, 0.42, 0.03, 24, 1, false, -Math.PI / 2, Math.PI), c, [0, 0.33, 0.28], [0.25, 0, 0]);
        this.add(g, new THREE.SphereGeometry(0.05, 10, 8), c, [0, HEAD_R * 1.0, 0]);
        break;
      }
      case 'party': {
        const t = partyHatTexture();
        this.disposables.push(t);
        const g = new THREE.Group();
        g.position.set(0.12, top - 0.04, 0);
        g.rotation.z = -0.25;
        this.head.add(g);
        this.add(g, new THREE.ConeGeometry(0.22, 0.55, 24, 1, true), mat('#ffffff', { map: t, side: THREE.DoubleSide }), [0, 0.27, 0]);
        this.add(g, new THREE.SphereGeometry(0.07, 12, 10), mat('#ffd60a'), [0, 0.56, 0]);
        break;
      }
      default:
        break;
    }
  }

  redrawFace() {
    const ctx = this.faceCanvas.getContext('2d');
    if (this.look.kind === 'photo') drawPhotoFace(ctx, FACE_SIZE, this.photoImg, this.expr);
    else drawPresetFace(ctx, FACE_SIZE, this.look.style, this.expr);
    this.faceTex.needsUpdate = true;
  }

  /** 切换表情，duration 毫秒后自动恢复（0 表示保持） */
  setExpression(expr, duration = 3200, withAnim = true) {
    this.expr = expr;
    this.exprUntil = duration ? performance.now() + duration : 0;
    this.redrawFace();
    if (withAnim && EXPR_ANIM[expr]) this.play(EXPR_ANIM[expr]);
  }

  play(type, dur) {
    const durations = { jump: 600, jump2: 1100, pop: 600, spin: 900, tilt: 1600, droop: 1800, shake: 800 };
    this.anim = { type, t0: performance.now(), dur: dur || durations[type] || 800 };
  }

  setDead(dead) {
    if (this.dead === dead) return;
    this.dead = dead;
    const mats = new Set();
    this.group.traverse((o) => { if (o.isMesh && o.material?.color) mats.add(o.material); });
    for (const m of mats) {
      // 原色存在材质上（多个网格可能共用同一个材质）
      if (dead) {
        m.userData.origColor = m.userData.origColor || m.color.clone();
        const c = m.userData.origColor;
        const g = c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
        m.color.setRGB(g * 0.7, g * 0.7, g * 0.7);
      } else if (m.userData.origColor) {
        m.color.copy(m.userData.origColor);
      }
    }
    if (dead) this.setExpression('sad', 0, false);
  }

  /** 每帧调用 */
  update(now) {
    const t = now / 1000;
    const b = this.body;
    const baseY = b.userData.baseY ?? (b.userData.baseY = b.position.y);
    if (this.exprUntil && now > this.exprUntil && !this.dead) {
      this.exprUntil = 0;
      this.expr = 'neutral';
      this.redrawFace();
    }
    // 待机动作
    let y = this.dead ? 0 : Math.sin(t * 2.4 + this.phase) * 0.03;
    let sx = 1 + Math.sin(t * 2.4 + this.phase + 1) * 0.015;
    let sy = 2 - sx;
    let rotY = 0;
    let rotZ = 0;
    let headZ = this.dead ? 0.5 : Math.sin(t * 1.3 + this.phase) * 0.05;
    let headX = 0;
    if (this.anim) {
      const k = (now - this.anim.t0) / this.anim.dur;
      if (k >= 1) this.anim = null;
      else {
        const s = Math.sin(k * Math.PI);
        switch (this.anim.type) {
          case 'jump': y += s * 0.45; sy += s * 0.06; break;
          case 'jump2': y += Math.abs(Math.sin(k * Math.PI * 2)) * 0.4; rotZ = Math.sin(k * Math.PI * 4) * 0.12; break;
          case 'pop': { const p = 1 + s * 0.18; sx *= p; sy *= p; y += s * 0.15; break; }
          case 'spin': rotY = k * Math.PI * 2; y += s * 0.2; break;
          case 'tilt': headZ += s * 0.35; headX -= s * 0.1; break;
          case 'droop': headX += s * 0.35; sy *= 1 - s * 0.08; break;
          case 'shake': rotY = Math.sin(k * Math.PI * 10) * 0.35 * (1 - k); y += s * 0.08; break;
          default: break;
        }
      }
    }
    if (this.dead) { rotZ = Math.PI / 2.4; y = 0.25; }
    b.position.y = baseY + y;
    b.scale.set(sx, sy, sx);
    b.rotation.y = rotY;
    b.rotation.z = rotZ;
    this.head.rotation.z = headZ;
    this.head.rotation.x = headX;
    if (this.arms) {
      const wave = this.expr !== 'neutral' && !this.dead ? Math.sin(t * 10) * 0.35 : Math.sin(t * 2.4 + this.phase) * 0.08;
      this.arms[0].rotation.z = -0.3 - Math.max(0, wave);
      this.arms[1].rotation.z = 0.3 + Math.max(0, -wave);
    }
    if (this.earL) {
      this.earL.rotation.z = 0.15 + Math.sin(t * 3 + this.phase) * 0.06;
      this.earR.rotation.z = -0.15 - Math.sin(t * 3 + this.phase + 1) * 0.06;
    }
    if (this.antennaTip) this.antennaTip.material.emissiveIntensity = 0.5 + Math.abs(Math.sin(t * 3)) * 0.8;
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose?.();
  }
}
