// 简单合成音效（WebAudio），无需音频文件
let ctx = null;
let enabled = true;
try { enabled = localStorage.getItem('sfx') !== 'off'; } catch { /* 忽略 */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', vol = 0.15, delay = 0, slide = 0 } = {}) {
  const a = ac();
  if (!a || !enabled) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.12, delay = 0 } = {}) {
  const a = ac();
  if (!a || !enabled) return;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2500;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(a.currentTime + delay);
}

export const sfx = {
  get enabled() { return enabled; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem('sfx', enabled ? 'on' : 'off'); } catch { /* 忽略 */ }
    return enabled;
  },
  unlock() { ac(); },
  dice() { for (let k = 0; k < 6; k++) noise(0.05, { delay: k * 0.12 + Math.random() * 0.05, vol: 0.18 }); },
  step() { tone(520 + Math.random() * 60, 0.06, { type: 'triangle', vol: 0.08 }); },
  coin() { tone(988, 0.08, { type: 'square', vol: 0.06 }); tone(1319, 0.25, { type: 'square', vol: 0.06, delay: 0.08 }); },
  pay() { tone(440, 0.12, { type: 'sawtooth', vol: 0.06, slide: 0.6 }); },
  buy() { [523, 659, 784, 1047].forEach((f, k) => tone(f, 0.15, { type: 'triangle', vol: 0.1, delay: k * 0.07 })); },
  card() { tone(660, 0.1, { type: 'triangle', vol: 0.1 }); tone(880, 0.18, { type: 'triangle', vol: 0.1, delay: 0.1 }); },
  jail() { [392, 330, 262].forEach((f, k) => tone(f, 0.25, { type: 'square', vol: 0.07, delay: k * 0.18 })); },
  turn() { tone(880, 0.12, { vol: 0.12 }); tone(1175, 0.2, { vol: 0.12, delay: 0.12 }); },
  build() { tone(300, 0.08, { type: 'square', vol: 0.08 }); tone(300, 0.08, { type: 'square', vol: 0.08, delay: 0.12 }); },
  emote() { tone(1200, 0.08, { vol: 0.07, slide: 1.4 }); },
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, k) => tone(f, 0.25, { type: 'triangle', vol: 0.12, delay: k * 0.15 })); },
  bankrupt() { tone(300, 0.8, { type: 'sawtooth', vol: 0.08, slide: 0.3 }); },
};
