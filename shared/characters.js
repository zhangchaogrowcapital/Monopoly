// 角色与表情定义：服务端与浏览器共用

// 预设角色。ears/face/head 决定 3D 模型的造型
export const CHARACTERS = [
  { id: 'cat', name: '招财猫', body: '#fff6e8', accent: '#e53935', ears: 'cat', face: 'cat', accessory: 'bell' },
  { id: 'panda', name: '熊猫阿宝', body: '#ffffff', accent: '#222222', ears: 'round', face: 'panda', accessory: 'bamboo' },
  { id: 'tiger', name: '小老虎', body: '#ff9a2e', accent: '#3a2a1a', ears: 'round', face: 'tiger', accessory: 'none' },
  { id: 'robot', name: '机器人', body: '#9fb4c7', accent: '#2f80ed', ears: 'antenna', face: 'robot', head: 'box', accessory: 'none' },
  { id: 'rabbit', name: '小兔子', body: '#ffd6e5', accent: '#ff6fa3', ears: 'long', face: 'rabbit', accessory: 'bow' },
  { id: 'penguin', name: '企鹅', body: '#24344d', accent: '#ffb02e', ears: 'none', face: 'penguin', accessory: 'scarf' },
];

export const CUSTOM_ID = 'custom';

// 照片定制角色可选的帽子/配饰
export const HATS = [
  { id: 'none', name: '无' },
  { id: 'crown', name: '皇冠' },
  { id: 'tophat', name: '礼帽' },
  { id: 'cap', name: '棒球帽' },
  { id: 'party', name: '派对帽' },
  { id: 'cat', name: '猫耳' },
  { id: 'bunny', name: '兔耳' },
];

export const BODY_COLORS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#ec407a', '#546e7a', '#6d4c41', '#212121'];

export const DEFAULT_CUSTOM = { bodyColor: '#1e88e5', hat: 'crown' };

// 表情：emoji 用于头顶气泡，name 用于按钮提示
export const EXPRESSIONS = {
  neutral: { emoji: '🙂', name: '平静' },
  happy: { emoji: '😄', name: '开心' },
  laugh: { emoji: '🤣', name: '大笑' },
  love: { emoji: '😍', name: '喜欢' },
  cool: { emoji: '😎', name: '得意' },
  surprised: { emoji: '😲', name: '惊讶' },
  thinking: { emoji: '🤔', name: '思考' },
  sad: { emoji: '😢', name: '难过' },
  angry: { emoji: '😡', name: '生气' },
};

export const EXPRESSION_IDS = Object.keys(EXPRESSIONS);

// 玩家座位颜色（地产归属标记等）
export const SEAT_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00'];

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || null;
