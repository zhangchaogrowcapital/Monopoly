// 角色展示台：用于角色编辑器预览和房间等待界面
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Character } from './character.js';
import { EXPRESSIONS } from '/shared/characters.js';

export class Stage {
  constructor(container, { interactive = true, labels = false } = {}) {
    this.container = container;
    this.items = [];
    this.disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    if (labels) {
      this.labelRenderer = new CSS2DRenderer();
      this.labelRenderer.domElement.className = 'label-layer';
      container.appendChild(this.labelRenderer.domElement);
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 2.2, 6.5);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#c7b299', 1.8));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(3, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
    this.scene.add(key);

    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 4.7, 0.25, 64),
      new THREE.MeshStandardMaterial({ color: '#ffe8b3', roughness: 0.7 }),
    );
    podium.position.y = -0.125;
    podium.receiveShadow = true;
    this.scene.add(podium);
    this.podium = podium;

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.set(0, 1.1, 0);
    this.controls.enablePan = false;
    this.controls.enableZoom = interactive;
    this.controls.enableRotate = interactive;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.enableDamping = true;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.labelRenderer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.relayout();
  }

  /** infos: [{key, characterId, custom, avatar, name, color}] */
  setCharacters(infos) {
    const sig = (i) => JSON.stringify([i.characterId, i.custom, i.avatar, i.color]);
    const keep = new Map();
    for (const it of this.items) {
      const info = infos.find((i) => i.key === it.key);
      if (info && sig(info) === it.sig) {
        keep.set(it.key, it);
        if (it.label) it.label.querySelector('span').textContent = info.name || '';
      } else it.char.dispose();
    }
    this.items = infos.map((info) => {
      if (keep.has(info.key)) return keep.get(info.key);
      const char = new Character(info, { seatColor: info.color || null });
      this.scene.add(char.group);
      const item = { key: info.key, sig: sig(info), char };
      if (this.labelRenderer && info.name) {
        const el = document.createElement('div');
        el.className = 'nametag';
        el.innerHTML = '<div class="bubble"></div><div class="tag"><i></i><span></span></div>';
        el.querySelector('i').style.background = info.color || '#999';
        el.querySelector('span').textContent = info.name;
        char.anchor.add(new CSS2DObject(el));
        item.label = el;
      }
      return item;
    });
    this.relayout();
  }

  relayout() {
    const n = this.items.length;
    if (!n) return;
    const spacing = n <= 1 ? 0 : Math.min(1.7, 7.5 / n);
    this.items.forEach((it, k) => {
      const x = (k - (n - 1) / 2) * spacing;
      const z = n > 3 ? -Math.abs(k - (n - 1) / 2) * 0.35 : 0;
      it.char.group.position.set(x, 0, z);
    });
    const width = Math.max(2.2, (n - 1) * spacing + 2.2);
    const fov = (this.camera.fov * Math.PI) / 180;
    const distW = width / 2 / Math.tan(fov / 2) / Math.max(this.camera.aspect, 0.3);
    const dist = Math.max(4.8, distW * 1.05);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.position.copy(this.controls.target).add(dir.multiplyScalar(dist));
  }

  expression(key, expr) {
    const it = this.items.find((i) => i.key === key);
    if (!it) return;
    it.char.setExpression(expr);
    if (it.label) {
      const b = it.label.querySelector('.bubble');
      b.textContent = EXPRESSIONS[expr]?.emoji || '';
      b.classList.remove('show');
      void b.offsetWidth;
      b.classList.add('show');
      clearTimeout(b._t);
      b._t = setTimeout(() => b.classList.remove('show'), 2600);
    }
  }

  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update();
    for (const it of this.items) {
      it.char.update(now);
      const p = it.char.group.position;
      it.char.group.rotation.y = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z) * 0.85;
    }
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer?.render(this.scene, this.camera);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const it of this.items) it.char.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.container.innerHTML = '';
  }
}
