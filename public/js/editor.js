// 角色编辑器：预设角色 / 上传照片定制（裁剪、身体颜色、帽子）+ 3D 预览 + 表情试玩
import { h, modal, toast } from './util.js';
import { api } from './api.js';
import { CHARACTERS, CUSTOM_ID, HATS, BODY_COLORS, EXPRESSIONS, DEFAULT_CUSTOM } from '/shared/characters.js';
import { lookFor, renderIcon } from './three/faces.js';

const CROP = 300;
const EYE_LINE = 0.43;

/** 照片裁剪器：拖动移动、滚轮/双指缩放 */
class Cropper {
  constructor(canvas, img, onChange) {
    this.canvas = canvas;
    this.img = img;
    this.onChange = onChange;
    this.minScale = Math.max(CROP / img.width, CROP / img.height);
    this.scale = this.minScale;
    this.x = CROP / 2;
    this.y = CROP / 2;
    this.pointers = new Map();
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const ratio = CROP / canvas.getBoundingClientRect().width;
      if (this.pointers.size === 1) {
        this.x += (e.clientX - prev.x) * ratio;
        this.y += (e.clientY - prev.y) * ratio;
      } else if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)[1];
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
        if (before > 0) this.zoom(after / before);
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.clamp();
      this.draw();
    });
    const up = (e) => { this.pointers.delete(e.pointerId); this.onChange?.(); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.08 : 1 / 1.08);
      this.clamp();
      this.draw();
      clearTimeout(this.wheelT);
      this.wheelT = setTimeout(() => this.onChange?.(), 250);
    }, { passive: false });
    this.draw();
  }

  zoom(f) { this.scale = Math.min(this.minScale * 6, Math.max(this.minScale, this.scale * f)); }

  setZoom(rel) { this.scale = this.minScale * rel; this.clamp(); this.draw(); }

  clamp() {
    const w = (this.img.width * this.scale) / 2;
    const hh = (this.img.height * this.scale) / 2;
    this.x = Math.min(w, Math.max(CROP - w, this.x));
    this.y = Math.min(hh, Math.max(CROP - hh, this.y));
  }

  paint(ctx, size) {
    const k = size / CROP;
    const w = this.img.width * this.scale * k;
    const hh = this.img.height * this.scale * k;
    ctx.drawImage(this.img, this.x * k - w / 2, this.y * k - hh / 2, w, hh);
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, CROP, CROP);
    this.paint(ctx, CROP);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, CROP, CROP);
    ctx.arc(CROP / 2, CROP / 2, CROP / 2 - 4, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CROP / 2, CROP / 2, CROP / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(255,230,80,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, CROP * EYE_LINE);
    ctx.lineTo(CROP - 40, CROP * EYE_LINE);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,230,80,0.95)';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('眼睛对齐这条线', CROP / 2 - 45, CROP * EYE_LINE - 8);
    ctx.restore();
  }

  export(size = 512) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffe0c8';
    ctx.fillRect(0, 0, size, size);
    this.paint(ctx, size);
    return c.toDataURL('image/jpeg', 0.88);
  }
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('请选择图片文件')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败，换一张试试'));
    img.src = url;
  });
}

/**
 * 打开角色编辑器
 * @param {object} user 当前用户
 * @param {(user:object)=>void} onSaved
 */
export async function openEditor(user, onSaved) {
  const { Stage } = await import('./three/stage.js');
  const draft = {
    nickname: user.nickname,
    characterId: user.characterId,
    custom: { ...DEFAULT_CUSTOM, ...(user.custom || {}) },
    avatar: user.avatar,
    pendingPhoto: null,
  };
  let tab = draft.characterId === CUSTOM_ID ? 'photo' : 'preset';
  let stage = null;
  let cropper = null;

  const previewBox = h('div.editor-preview');
  const exprBar = h('div.expr-bar', Object.entries(EXPRESSIONS).map(([id, e]) => h('button.emo', {
    title: e.name, onclick: () => stage?.expression('me', id),
  }, e.emoji)));
  const panel = h('div.editor-panel');
  const nickInput = h('input', { value: draft.nickname, maxlength: 12, placeholder: '昵称' });

  const info = () => {
    const usePhoto = draft.characterId === CUSTOM_ID;
    return {
      key: 'me',
      characterId: draft.characterId,
      custom: draft.custom,
      avatar: usePhoto ? (draft.pendingPhoto || draft.avatar) : null,
    };
  };
  const refreshPreview = () => {
    const i = info();
    if (i.characterId === CUSTOM_ID && !i.avatar) i.characterId = CHARACTERS[0].id;
    stage?.setCharacters([i]);
  };

  const presetGrid = () => h('div.char-grid', CHARACTERS.map((c) => {
    const cv = h('canvas', { width: 96, height: 96 });
    renderIcon(cv, lookFor({ characterId: c.id }), 'happy');
    return h(`button.char-card${draft.characterId === c.id ? '.active' : ''}`, {
      onclick: () => { draft.characterId = c.id; render(); refreshPreview(); },
    }, cv, h('span', c.name));
  }));

  const photoPane = () => {
    const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const cropWrap = h('div.crop-wrap');
    const zoom = h('input', { type: 'range', min: 1, max: 4, step: 0.01, value: 1, disabled: true });
    const useBtn = h('button.btn.primary', { disabled: true }, '✔ 使用这张照片');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const img = await readImage(file);
        const canvas = h('canvas.crop-canvas', { width: CROP, height: CROP });
        cropWrap.replaceChildren(canvas);
        cropper = new Cropper(canvas, img, () => {});
        zoom.disabled = false;
        zoom.value = 1;
        useBtn.disabled = false;
      } catch (e) { toast(e.message, 'error'); }
    });
    zoom.addEventListener('input', () => cropper?.setZoom(Number(zoom.value)));
    useBtn.addEventListener('click', () => {
      if (!cropper) return;
      draft.pendingPhoto = cropper.export(512);
      draft.characterId = CUSTOM_ID;
      cropper = null;
      render();
      refreshPreview();
      stage?.expression('me', 'happy');
    });
    const current = draft.pendingPhoto || draft.avatar;
    if (current) {
      const cv = h('canvas', { width: 120, height: 120 });
      renderIcon(cv, { kind: 'photo', photo: current }, 'neutral');
      cropWrap.append(h('div.current-photo', cv, h('span', '当前照片')));
    } else {
      cropWrap.append(h('div.crop-empty', '📷', h('p', '上传一张正脸照片'), h('small', '光线充足、正对镜头效果最好')));
    }
    return h('div.photo-pane',
      cropWrap,
      h('div.row',
        h('button.btn', { onclick: () => fileInput.click() }, current ? '📷 换一张照片' : '📷 选择照片'),
        fileInput,
        current && draft.characterId !== CUSTOM_ID
          ? h('button.btn', { onclick: () => { draft.characterId = CUSTOM_ID; render(); refreshPreview(); } }, '使用照片角色')
          : null),
      h('label.zoom', '缩放', zoom),
      useBtn,
      h('h4', '身体颜色'),
      h('div.swatches', BODY_COLORS.map((c) => h(`button.swatch${draft.custom.bodyColor === c ? '.active' : ''}`, {
        style: { background: c },
        title: c,
        onclick: () => { draft.custom.bodyColor = c; render(); refreshPreview(); },
      }))),
      h('h4', '帽子 / 配饰'),
      h('div.hats', HATS.map((hat) => h(`button.chip${draft.custom.hat === hat.id ? '.active' : ''}`, {
        onclick: () => { draft.custom.hat = hat.id; render(); refreshPreview(); },
      }, hat.name))),
      (draft.avatar && !draft.pendingPhoto) ? h('button.btn.link', {
        onclick: async () => {
          try {
            const r = await api('DELETE', '/api/avatar');
            draft.avatar = null;
            draft.characterId = r.user.characterId;
            Object.assign(user, r.user);
            onSaved?.(r.user);
            render();
            refreshPreview();
            toast('照片已删除');
          } catch (e) { toast(e.message, 'error'); }
        },
      }, '删除照片') : null);
  };

  const render = () => {
    panel.replaceChildren(
      h('label.field', '昵称', nickInput),
      h('div.tabs',
        h(`button${tab === 'preset' ? '.active' : ''}`, { onclick: () => { tab = 'preset'; render(); } }, '🐼 预设角色'),
        h(`button${tab === 'photo' ? '.active' : ''}`, { onclick: () => { tab = 'photo'; render(); } }, '📸 照片定制')),
      tab === 'preset' ? presetGrid() : photoPane(),
    );
  };

  const save = async (close) => {
    try {
      let u = user;
      if (draft.pendingPhoto) {
        u = (await api('POST', '/api/avatar', { image: draft.pendingPhoto })).user;
      }
      const characterId = draft.characterId === CUSTOM_ID && !(draft.pendingPhoto || draft.avatar) ? CHARACTERS[0].id : draft.characterId;
      u = (await api('PUT', '/api/profile', { nickname: nickInput.value.trim(), characterId, custom: draft.custom })).user;
      Object.assign(user, u);
      onSaved?.(u);
      toast('角色已保存 ✨', 'success');
      close();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  render();
  const m = modal('我的角色', (close) => h('div.editor',
    h('div.editor-left', previewBox, h('p.hint', '拖动旋转 · 点表情试试看'), exprBar),
    h('div.editor-right', panel, h('div.row.end', h('button.btn', { onclick: close }, '取消'), h('button.btn.primary', { onclick: () => save(close) }, '保存角色')))), {
    wide: true,
    onClose: () => stage?.destroy(),
  });
  stage = new Stage(previewBox, { interactive: true });
  refreshPreview();
  return m;
}

