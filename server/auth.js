// 用户注册 / 登录 / 会话令牌 / 头像
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { JsonStore } from './store.js';
import { CHARACTERS, CUSTOM_ID, HATS, DEFAULT_CUSTOM } from '../shared/characters.js';

const SESSION_TTL = 30 * 24 * 3600 * 1000;
const USERNAME_RE = /^[A-Za-z0-9_一-龥]{2,16}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export class Auth {
  constructor(dataDir) {
    this.avatarDir = path.join(dataDir, 'avatars');
    fs.mkdirSync(this.avatarDir, { recursive: true });
    this.store = new JsonStore(path.join(dataDir, 'users.json'), { users: {}, sessions: {} });
  }

  get users() { return this.store.data.users; }

  get sessions() { return this.store.data.sessions; }

  findByUsername(username) {
    const lower = username.toLowerCase();
    return Object.values(this.users).find((u) => u.username.toLowerCase() === lower) || null;
  }

  static hash(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  register(username, password, nickname) {
    username = String(username || '').trim();
    password = String(password || '');
    nickname = String(nickname || '').trim() || username;
    if (!USERNAME_RE.test(username)) throw new Error('用户名需为 2-16 位字母、数字、下划线或汉字');
    if (password.length < 6 || password.length > 64) throw new Error('密码长度需为 6-64 位');
    if (nickname.length > 12) throw new Error('昵称最多 12 个字');
    if (this.findByUsername(username)) throw new Error('用户名已被注册');
    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id,
      username,
      nickname,
      salt,
      passwordHash: Auth.hash(password, salt),
      characterId: CHARACTERS[Object.keys(this.users).length % CHARACTERS.length].id,
      custom: { ...DEFAULT_CUSTOM },
      avatar: null,
      createdAt: Date.now(),
    };
    this.users[id] = user;
    this.store.save();
    return this.createSession(user);
  }

  login(username, password) {
    const user = this.findByUsername(String(username || '').trim());
    if (!user) throw new Error('用户名或密码错误');
    const hash = Auth.hash(String(password || ''), user.salt);
    if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'))) {
      throw new Error('用户名或密码错误');
    }
    return this.createSession(user);
  }

  createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions[token] = { userId: user.id, expires: Date.now() + SESSION_TTL };
    this.pruneSessions();
    this.store.save();
    return { token, user: Auth.publicUser(user) };
  }

  logout(token) {
    delete this.sessions[token];
    this.store.save();
  }

  pruneSessions() {
    const now = Date.now();
    for (const [t, s] of Object.entries(this.sessions)) if (s.expires < now) delete this.sessions[t];
  }

  verify(token) {
    const s = token && this.sessions[token];
    if (!s || s.expires < Date.now()) return null;
    return this.users[s.userId] || null;
  }

  static publicUser(u) {
    return { id: u.id, username: u.username, nickname: u.nickname, characterId: u.characterId, custom: u.custom, avatar: u.avatar };
  }

  updateProfile(user, { nickname, characterId, custom }) {
    if (nickname !== undefined) {
      nickname = String(nickname).trim();
      if (!nickname || nickname.length > 12) throw new Error('昵称需为 1-12 个字');
      user.nickname = nickname;
    }
    if (characterId !== undefined) {
      if (characterId !== CUSTOM_ID && !CHARACTERS.some((c) => c.id === characterId)) throw new Error('无效的角色');
      if (characterId === CUSTOM_ID && !user.avatar) throw new Error('请先上传照片');
      user.characterId = characterId;
    }
    if (custom !== undefined) {
      const next = { ...user.custom };
      if (custom.bodyColor !== undefined) {
        if (!HEX_RE.test(custom.bodyColor)) throw new Error('无效的颜色');
        next.bodyColor = custom.bodyColor;
      }
      if (custom.hat !== undefined) {
        if (!HATS.some((h) => h.id === custom.hat)) throw new Error('无效的帽子');
        next.hat = custom.hat;
      }
      user.custom = next;
    }
    this.store.save();
    return Auth.publicUser(user);
  }

  /** 保存头像（data URL，浏览器端已裁剪压缩为 JPEG/PNG/WebP） */
  saveAvatar(user, dataUrl) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new Error('图片格式不支持，请使用 JPG / PNG / WebP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1.5 * 1024 * 1024) throw new Error('图片太大（最大 1.5MB）');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const magicOk = (ext === 'jpg' && buf[0] === 0xff && buf[1] === 0xd8)
      || (ext === 'png' && buf.subarray(1, 4).toString() === 'PNG')
      || (ext === 'webp' && buf.subarray(8, 12).toString() === 'WEBP');
    if (!magicOk) throw new Error('图片文件已损坏');
    for (const old of ['jpg', 'png', 'webp']) {
      const f = path.join(this.avatarDir, `${user.id}.${old}`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    fs.writeFileSync(path.join(this.avatarDir, `${user.id}.${ext}`), buf);
    user.avatar = `/avatars/${user.id}.${ext}?v=${Date.now()}`;
    user.characterId = CUSTOM_ID;
    this.store.save();
    return Auth.publicUser(user);
  }

  removeAvatar(user) {
    for (const old of ['jpg', 'png', 'webp']) {
      const f = path.join(this.avatarDir, `${user.id}.${old}`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    user.avatar = null;
    if (user.characterId === CUSTOM_ID) user.characterId = CHARACTERS[0].id;
    this.store.save();
    return Auth.publicUser(user);
  }
}

