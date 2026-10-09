// 对局 3D 场景：棋盘、骰子、角色、事件动画队列
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Board, BOARD_TOP, tileAt } from './board.js';
import { Dice } from './dice.js';
import { Character } from './character.js';
import { EXPRESSIONS } from '/shared/characters.js';
import { sfx } from '../sfx.js';

const TOKEN_SCALE = 0.36;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Game3D {
  /**
   * @param {HTMLElement} container
   * @param {{myId:string, onTileClick?:Function, onState?:Function, onEvent?:Function}} hooks
   */
  constructor(container, hooks) {
    this.container = container;
    this.hooks = hooks;
    this.myId = hooks.myId;
    this.queue = [];
    this.running = false;
    this.tweens = [];
    this.tokens = new Map();
    this.labels = new Map();
    this.follow = true;
    this.state = null;
    this.disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = 'label-layer';
    container.appendChild(labelRenderer.domElement);
    this.labelRenderer = labelRenderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    camera.position.set(0, 14, 13);
    this.camera = camera;

    scene.add(new THREE.HemisphereLight('#ffffff', '#b09a7a', 1.6));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    sun.position.set(7, 16, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    this.board = new Board(renderer);
    scene.add(this.board.group);
    this.dice = new Dice();
    scene.add(this.dice.group);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.44;
    controls.minDistance = 4;
    controls.maxDistance = 30;
    controls.target.set(0, 0, 0);
    this.controls = controls;
    this.camTarget = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindPointer();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.fitCamera();

    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- 基础 ----------
  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 桌面端左侧有玩家面板和日志，把棋盘画面右移；手机竖屏上下有面板，画面略微上移
    const shiftX = w > 820 ? Math.min(120, w * 0.08) : 0;
    const shiftY = w <= 820 && h > w ? h * 0.04 : 0;
    if (shiftX || shiftY) this.camera.setViewOffset(w, h, -shiftX, shiftY, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const portrait = h > w;
    if (this.portrait !== undefined && this.portrait !== portrait) this.fitCamera();
    this.portrait = portrait;
  }

  /** 让整个棋盘刚好装进画面 */
  fitCamera() {
    const aspect = this.camera.aspect;
    const portrait = aspect < 1;
    const dir = (portrait ? new THREE.Vector3(0, 1.7, 0.8) : new THREE.Vector3(0, 1.05, 0.95)).normalize();
    const R = 7.0; // 棋盘半宽（含边框）+ 余量
    const vHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const distH = R / Math.tan(hHalf);
    const distV = (R * (portrait ? 0.9 : 0.98)) / Math.tan(vHalf);
    const dist = Math.max(distH, distV);
    this.controls.maxDistance = Math.max(30, dist * 1.6);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.controls.target.set(0, 0, 0);
    this.camTarget = null;
  }

  resetView() { this.fitCamera(); }

  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    const pick = (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObject(this.board.mesh)[0];
      return hit ? tileAt(hit.point.x, hit.point.z) : -1;
    };
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; this.camTarget = null; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6) return;
      const i = pick(e);
      if (i >= 0) this.hooks.onTileClick?.(i);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const i = pick(e);
      this.board.setHover(i);
      el.style.cursor = i >= 0 ? 'pointer' : '';
    });
    el.addEventListener('pointerleave', () => this.board.setHover(-1));
  }

  tween(duration, fn) {
    return new Promise((resolve) => {
      this.tweens.push({ t0: performance.now(), duration, fn, resolve });
    });
  }

  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.tweens = this.tweens.filter((tw) => {
      const k = Math.min(1, (now - tw.t0) / tw.duration);
      tw.fn(k);
      if (k >= 1) { tw.resolve(); return false; }
      return true;
    });
    this.dice.update(now);
    // 镜头跟随
    if (this.camTarget) {
      const target = this.controls.target;
      const delta = this.camTarget.clone().sub(target).multiplyScalar(0.06);
      if (delta.lengthSq() > 1e-6) {
        target.add(delta);
        this.camera.position.add(delta);
      }
    }
    this.controls.update();
    for (const [id, tok] of this.tokens) {
      tok.update(now);
      // 待机时面向镜头，方便看清表情
      if (!tok.moving) {
        const p = tok.group.position;
        const yaw = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z);
        tok.group.rotation.y = angleLerp(tok.group.rotation.y, yaw, 0.08);
      }
      const label = this.labels.get(id);
      if (label) label.obj.visible = tok.group.visible;
    }
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  // ---------- 角色 ----------
  setPlayers(players) {
    const ids = new Set(players.map((p) => p.id));
    for (const [id, tok] of this.tokens) {
      if (!ids.has(id)) { tok.dispose(); this.tokens.delete(id); this.labels.delete(id); }
    }
    for (const p of players) {
      if (this.tokens.has(p.id)) continue;
      const tok = new Character(p, { seatColor: p.color });
      tok.group.scale.setScalar(TOKEN_SCALE);
      tok.tile = p.position;
      tok.group.position.copy(this.board.slotPosition(p.position, 0, 1));
      this.scene.add(tok.group);
      this.tokens.set(p.id, tok);

      const el = document.createElement('div');
      el.className = 'nametag';
      el.innerHTML = '<div class="bubble"></div><div class="tag"><i></i><span></span></div>';
      el.querySelector('i').style.background = p.color;
      el.querySelector('span').textContent = p.name;
      const obj = new CSS2DObject(el);
      obj.position.set(0, 0, 0);
      tok.anchor.add(obj);
      this.labels.set(p.id, { el, obj });
    }
  }

  showBubble(playerId, expr) {
    const label = this.labels.get(playerId);
    if (!label) return;
    const b = label.el.querySelector('.bubble');
    b.textContent = EXPRESSIONS[expr]?.emoji || '🙂';
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(b._t);
    b._t = setTimeout(() => b.classList.remove('show'), 2600);
  }

  emote(playerId, expr) {
    const tok = this.tokens.get(playerId);
    if (!tok || tok.dead) return;
    tok.setExpression(expr);
    this.showBubble(playerId, expr);
    sfx.emote();
  }

  floatText(playerId, text, cls) {
    const tok = this.tokens.get(playerId);
    if (!tok || !tok.group.visible) return;
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(0, 0.6, 0);
    tok.anchor.add(obj);
    setTimeout(() => { obj.removeFromParent(); el.remove(); }, 1700);
  }

  /** 镜头轻微跟随某个位置（整盘始终在画面内） */
  followPoint(p) {
    if (!this.follow) return;
    const k = this.camera.aspect < 1 ? 0.08 : 0.18;
    this.camTarget = p.clone().setY(0).multiplyScalar(k);
  }

  recenter() {
    if (this.follow) this.camTarget = new THREE.Vector3(0, 0, 0);
  }

  setFollow(on) {
    this.follow = on;
    if (!on) this.camTarget = null;
  }

  /** 按状态摆放所有角色（同格分散站位） */
  layout(state, animate = true) {
    const byTile = new Map();
    for (const p of state.players) {
      const tok = this.tokens.get(p.id);
      if (!tok) continue;
      if (p.bankrupt) { tok.group.visible = false; continue; }
      tok.group.visible = true;
      tok.setDead(false);
      const key = p.position === 10 ? `10:${p.inJail ? 1 : 0}` : `${p.position}`;
      if (!byTile.has(key)) byTile.set(key, []);
      byTile.get(key).push(p);
    }
    for (const list of byTile.values()) {
      list.forEach((p, k) => {
        const tok = this.tokens.get(p.id);
        tok.tile = p.position;
        const target = this.board.slotPosition(p.position, k, list.length, p.inJail);
        if (!animate || tok.group.position.distanceTo(target) < 0.01) {
          tok.group.position.copy(target);
          return;
        }
        const from = tok.group.position.clone();
        this.tween(280, (t) => tok.group.position.lerpVectors(from, target, t));
      });
    }
  }

  async hop(tok, target, duration, height = 0.5) {
    const from = tok.group.position.clone();
    const yaw = Math.atan2(target.x - from.x, target.z - from.z);
    tok.moving = true;
    await this.tween(duration, (t) => {
      tok.group.position.lerpVectors(from, target, t);
      tok.group.position.y = BOARD_TOP + Math.sin(t * Math.PI) * height;
      tok.group.rotation.y = angleLerp(tok.group.rotation.y, yaw, 0.35);
    });
    tok.moving = false;
  }

  async animateMove(ev, fast) {
    const tok = this.tokens.get(ev.playerId);
    if (!tok) return;
    const n = Math.abs(ev.steps);
    const dir = Math.sign(ev.steps);
    if (fast || n === 0) {
      tok.tile = ev.to;
      tok.group.position.copy(this.board.slotPosition(ev.to, 0, 1));
      return;
    }
    const per = Math.max(110, Math.min(230, 3600 / n));
    let cur = ev.from;
    for (let k = 0; k < n; k++) {
      cur = (cur + dir + 40) % 40;
      const target = this.board.slotPosition(cur, 0, 1);
      this.followPoint(target);
      await this.hop(tok, target, per, 0.45);
      sfx.step();
      tok.tile = cur;
    }
  }

  async animateFly(ev, fast) {
    const tok = this.tokens.get(ev.playerId);
    if (!tok) return;
    const target = this.board.slotPosition(ev.to, 0, 1, true);
    if (fast) { tok.group.position.copy(target); return; }
    this.followPoint(target);
    await this.hop(tok, target, 900, 3);
  }

  // ---------- 事件队列 ----------
  /** 接收服务端更新：{state, events} */
  enqueue(update) {
    this.queue.push(update);
    if (!this.running) this.run();
  }

  get busy() { return this.running; }

  async run() {
    this.running = true;
    this.hooks.onBusy?.(true);
    try {
      while (this.queue.length && !this.disposed) {
        const { state, events = [] } = this.queue.shift();
        if (!this.state) {
          // 第一次收到状态：直接摆好
          this.setPlayers(state.players);
          this.board.sync(state);
          this.layout(state, false);
        }
        const fast = this.queue.length > 1 || document.hidden;
        for (const ev of events) {
          if (this.disposed) return;
          await this.playEvent(ev, fast, state);
        }
        this.applyState(state);
      }
    } finally {
      this.running = false;
      this.hooks.onBusy?.(false);
    }
  }

  applyState(state) {
    this.state = state;
    this.setPlayers(state.players);
    this.board.sync(state);
    this.layout(state);
    this.hooks.onState?.(state);
  }

  async playEvent(ev, fast, state) {
    const colorOf = (id) => state.players.find((p) => p.id === id)?.color;
    this.hooks.onEvent?.(ev, fast);
    switch (ev.type) {
      case 'dice':
        sfx.dice();
        if (fast) this.dice.show(ev.dice);
        else await this.dice.roll(ev.dice);
        break;
      case 'move':
        this.board.setHighlight(-1);
        await this.animateMove(ev, fast);
        this.board.setHighlight(ev.to);
        break;
      case 'jail':
        await this.animateFly(ev, fast);
        sfx.jail();
        break;
      case 'card':
        sfx.card();
        if (!fast) await sleep(2000);
        break;
      case 'money':
        this.floatText(ev.playerId, `${ev.delta > 0 ? '+' : '-'}¥${Math.abs(ev.delta)}`, ev.delta > 0 ? 'gain' : 'loss');
        if (ev.delta > 0) sfx.coin(); else sfx.pay();
        break;
      case 'expr': {
        const tok = this.tokens.get(ev.playerId);
        if (tok && !tok.dead) {
          tok.setExpression(ev.expr);
          this.showBubble(ev.playerId, ev.expr);
        }
        break;
      }
      case 'buy':
        this.board.setOwner(ev.tile, colorOf(ev.playerId));
        sfx.buy();
        if (!fast) await sleep(300);
        break;
      case 'build':
        this.board.setHouses(ev.tile, ev.houses);
        sfx.build();
        break;
      case 'mortgage':
        this.board.setMortgaged(ev.tile, ev.mortgaged);
        break;
      case 'transfer':
        this.board.setOwner(ev.tile, ev.to ? colorOf(ev.to) : null);
        break;
      case 'bankrupt': {
        const tok = this.tokens.get(ev.playerId);
        tok?.setDead(true);
        sfx.bankrupt();
        if (!fast) await sleep(1500);
        break;
      }
      case 'turn':
        this.board.setHighlight(-1);
        this.recenter();
        if (ev.playerId === this.myId) sfx.turn();
        break;
      case 'gameover':
        sfx.win();
        break;
      default:
        break;
    }
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const tok of this.tokens.values()) tok.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}
