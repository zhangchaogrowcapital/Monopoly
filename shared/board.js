// 棋盘数据：服务端与浏览器共用（ES Module）
// 类型：go 起点 / property 地产 / station 车站 / utility 公用事业 / tax 税
//       chance 机会 / fate 命运 / jail 监狱 / parking 免费停车 / gotojail 入狱

export const GROUPS = {
  brown: { name: '棕色', color: '#8B4513' },
  lightblue: { name: '浅蓝', color: '#7FD3F7' },
  pink: { name: '粉色', color: '#E14B9B' },
  orange: { name: '橙色', color: '#F7941D' },
  red: { name: '红色', color: '#E5262B' },
  yellow: { name: '黄色', color: '#FCE300' },
  green: { name: '绿色', color: '#1FB25A' },
  darkblue: { name: '深蓝', color: '#0072BB' },
};

const P = (name, group, price, rent, houseCost) => ({ type: 'property', name, group, price, rent, houseCost });
const S = (name) => ({ type: 'station', name, price: 200 });
const U = (name) => ({ type: 'utility', name, price: 150 });

export const TILES = [
  { type: 'go', name: '起点' },
  P('拉萨', 'brown', 60, [2, 10, 30, 90, 160, 250], 50),
  { type: 'fate', name: '命运' },
  P('西宁', 'brown', 60, [4, 20, 60, 180, 320, 450], 50),
  { type: 'tax', name: '所得税', amount: 200 },
  S('北京西站'),
  P('昆明', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  { type: 'chance', name: '机会' },
  P('贵阳', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  P('南宁', 'lightblue', 120, [8, 40, 100, 300, 450, 600], 50),
  { type: 'jail', name: '监狱' },
  P('长沙', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  U('电力公司'),
  P('武汉', 'pink', 140, [10, 50, 150, 450, 625, 750], 100),
  P('郑州', 'pink', 160, [12, 60, 180, 500, 700, 900], 100),
  S('上海虹桥站'),
  P('西安', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  { type: 'fate', name: '命运' },
  P('成都', 'orange', 180, [14, 70, 200, 550, 750, 950], 100),
  P('重庆', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { type: 'parking', name: '免费停车' },
  P('天津', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  { type: 'chance', name: '机会' },
  P('南京', 'red', 220, [18, 90, 250, 700, 875, 1050], 150),
  P('苏州', 'red', 240, [20, 100, 300, 750, 925, 1100], 150),
  S('广州南站'),
  P('杭州', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  P('青岛', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150),
  U('自来水厂'),
  P('厦门', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150),
  { type: 'gotojail', name: '入狱' },
  P('广州', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  P('深圳', 'green', 300, [26, 130, 390, 900, 1100, 1275], 200),
  { type: 'fate', name: '命运' },
  P('香港', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200),
  S('深圳北站'),
  { type: 'chance', name: '机会' },
  P('北京', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { type: 'tax', name: '奢侈税', amount: 100 },
  P('上海', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
].map((t, index) => ({ ...t, index }));

export const BOARD_SIZE = TILES.length; // 40
export const JAIL_INDEX = 10;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
export const START_MONEY = 1500;
export const STATION_RENT = [25, 50, 100, 200];
export const MAX_HOUSES = 5; // 5 = 酒店

export const isOwnable = (tile) => ['property', 'station', 'utility'].includes(tile.type);

export const groupTiles = (group) => TILES.filter((t) => t.group === group).map((t) => t.index);

export const mortgageValue = (tile) => Math.floor(tile.price / 2);
export const unmortgageCost = (tile) => Math.ceil((mortgageValue(tile) * 11) / 10);

export const formatMoney = (n) => `¥${n}`;
