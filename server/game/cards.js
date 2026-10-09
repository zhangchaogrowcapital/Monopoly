// 机会卡 / 命运卡
// action 类型：
//   money        +amount（负数为支付给银行）
//   moveTo       前进到指定格（经过起点领工资）
//   moveBack     后退 steps 格
//   nearest      前进到最近的 station/utility，并按特殊规则付租金
//   jail         直接入狱
//   jailCard     获得出狱卡
//   repairs      按房屋/酒店数量付维修费
//   payEach      付给每位玩家 amount
//   collectEach  向每位玩家收取 amount

export const CHANCE_CARDS = [
  { text: '前进到起点，领取 ¥200', action: { type: 'moveTo', to: 0 } },
  { text: '前进到上海', action: { type: 'moveTo', to: 39 } },
  { text: '前进到天津，如经过起点领取 ¥200', action: { type: 'moveTo', to: 21 } },
  { text: '前进到长沙，如经过起点领取 ¥200', action: { type: 'moveTo', to: 11 } },
  { text: '前进到最近的车站，若已有主人支付双倍租金', action: { type: 'nearest', kind: 'station' } },
  { text: '前进到最近的车站，若已有主人支付双倍租金', action: { type: 'nearest', kind: 'station' } },
  { text: '前进到最近的公用事业，若已有主人支付骰子点数 ×10', action: { type: 'nearest', kind: 'utility' } },
  { text: '银行分红，获得 ¥50', action: { type: 'money', amount: 50 } },
  { text: '获得一张出狱卡', action: { type: 'jailCard' } },
  { text: '后退三格', action: { type: 'moveBack', steps: 3 } },
  { text: '违章被抓，直接入狱！', action: { type: 'jail' } },
  { text: '房屋大修：每栋房子付 ¥25，每间酒店付 ¥100', action: { type: 'repairs', house: 25, hotel: 100 } },
  { text: '超速罚款 ¥15', action: { type: 'money', amount: -15 } },
  { text: '前往北京西站，如经过起点领取 ¥200', action: { type: 'moveTo', to: 5 } },
  { text: '当选董事长，付给每位玩家 ¥50', action: { type: 'payEach', amount: 50 } },
  { text: '建筑贷款到期，获得 ¥150', action: { type: 'money', amount: 150 } },
];

export const FATE_CARDS = [
  { text: '前进到起点，领取 ¥200', action: { type: 'moveTo', to: 0 } },
  { text: '银行算错账，你获得 ¥200', action: { type: 'money', amount: 200 } },
  { text: '看病花费 ¥50', action: { type: 'money', amount: -50 } },
  { text: '卖出股票，获得 ¥50', action: { type: 'money', amount: 50 } },
  { text: '获得一张出狱卡', action: { type: 'jailCard' } },
  { text: '被人陷害，直接入狱！', action: { type: 'jail' } },
  { text: '节日基金到期，获得 ¥100', action: { type: 'money', amount: 100 } },
  { text: '个税退税，获得 ¥20', action: { type: 'money', amount: 20 } },
  { text: '今天是你的生日！每位玩家送你 ¥10', action: { type: 'collectEach', amount: 10 } },
  { text: '人寿保险到期，获得 ¥100', action: { type: 'money', amount: 100 } },
  { text: '住院费 ¥100', action: { type: 'money', amount: -100 } },
  { text: '缴纳学费 ¥50', action: { type: 'money', amount: -50 } },
  { text: '咨询费收入 ¥25', action: { type: 'money', amount: 25 } },
  { text: '街道维修：每栋房子付 ¥40，每间酒店付 ¥115', action: { type: 'repairs', house: 40, hotel: 115 } },
  { text: '选美比赛二等奖，获得 ¥10', action: { type: 'money', amount: 10 } },
  { text: '继承遗产 ¥100', action: { type: 'money', amount: 100 } },
];
