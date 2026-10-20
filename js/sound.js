// 効果音・走行音・読み上げ・バイブ
// 音はすべて Web Audio で合成したオリジナル（実在の発車メロディや車内放送は使わない）
export const opt = { sfx: true, vibe: false, voice: true, rumble: true };

let ac, master, nbuf;
// 音を出せるようにする。ブラウザの制限があるので、タップなどの操作の中で呼ぶ
export function unlockAudio() {
  // iPhone はマナーモードだと Web Audio が鳴らないので、音楽再生扱いにする（iOS 17 以降）
  if ('audioSession' in navigator) navigator.audioSession.type = 'playback';
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
    nbuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = nbuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
}

function tone(f, t, dur, { type = 'sine', vol = 0.2, attack = 0.008 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, { type = 'lowpass', freq = 800, q = 0.7, vol = 0.2 } = {}) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = nbuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.05);
}
const now = () => ac.currentTime + 0.03;
function bell(f, t, dur, vol = 0.14) {
  tone(f, t, dur, { type: 'triangle', vol });
  tone(f * 2, t, dur * 0.5, { vol: vol * 0.3 });
  tone(f * 3.01, t, dur * 0.25, { vol: vol * 0.12 });
}

export function chime() { // 到着「ピンポーン」
  if (!opt.sfx) return;
  const t = now();
  bell(988, t, 1.0, 0.18); bell(784, t + 0.32, 1.8, 0.18);
}
export function doorOpen() {
  if (!opt.sfx) return;
  const t = now() + 0.9;
  noise(t, 0.9, { type: 'bandpass', freq: 2600, q: 0.5, vol: 0.07 });
  noise(t + 0.75, 0.25, { freq: 140, vol: 0.35 });
}
export function doorClose() { // 「ピンポンピンポン」＋プシュー
  if (!opt.sfx) return;
  const t = now();
  for (let i = 0; i < 6; i++) tone(i % 2 ? 622 : 831, t + i * 0.22, 0.2, { type: 'square', vol: 0.03 });
  noise(t + 1.4, 0.7, { type: 'bandpass', freq: 2600, q: 0.5, vol: 0.07 });
  noise(t + 2.0, 0.25, { freq: 140, vol: 0.35 });
}
function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function melody(seed) { // 駅ごとに違う発車メロディ（seed から自動作曲）
  if (!opt.sfx) return;
  const r = rng(seed), scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const base = 523.25 * 2 ** ([0, 2, 5, 7][Math.floor(r() * 4)] / 12);
  const beat = 0.15 + r() * 0.06;
  let t = now(), idx = 2 + Math.floor(r() * 4);
  for (let i = 0; i < 15; i++) {
    idx = Math.max(0, Math.min(scale.length - 1, idx + Math.round((r() - 0.5) * 4)));
    const d = i % 4 === 3 ? beat * 2 : beat;
    bell(base * 2 ** (scale[idx] / 12), t, d * 3);
    if (i % 4 === 0) tone(base / 2 * 2 ** (scale[i % 3 * 2] / 12), t, beat * 4, { vol: 0.06 });
    t += d;
  }
  bell(base * 2, t, 1.4); tone(base / 2, t, 1.4, { vol: 0.07 });
}
export function finale() {
  if (!opt.sfx) return;
  const t = now();
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, t + i * 0.16, 2.2 - i * 0.2, 0.15));
  [523.25, 659.25, 783.99].forEach(f => tone(f, t + 0.7, 2.2, { type: 'triangle', vol: 0.06 }));
}

// 走行音：低いノイズ＋「ガタンゴトン」。走っている間だけ大きくする
let rumble = null;
export function rumbleStart() {
  if (!opt.rumble || rumble) return;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = nbuf; s.loop = true; f.type = 'lowpass'; f.frequency.value = 300; g.gain.value = 0;
  s.connect(f).connect(g).connect(master); s.start();
  const timer = setInterval(() => {
    if (!rumble.moving) return;
    const t = now();
    noise(t, 0.09, { type: 'bandpass', freq: 170, q: 1.2, vol: 0.3 });
    noise(t + 0.14, 0.09, { type: 'bandpass', freq: 150, q: 1.2, vol: 0.25 });
  }, 1150);
  rumble = { s, g, timer, moving: false };
}
export function rumbleMoving(moving) {
  if (!rumble) return;
  rumble.moving = moving;
  rumble.g.gain.setTargetAtTime(moving ? 0.09 : 0.015, ac.currentTime, 0.8);
}
export function rumblePause() {
  if (!rumble) return;
  rumble.moving = false;
  rumble.g.gain.setTargetAtTime(0, ac.currentTime, 0.3);
}
export function rumbleStop() {
  if (!rumble) return;
  clearInterval(rumble.timer); rumble.s.stop(); rumble = null;
}

// 読み上げ（ブラウザの Web Speech API。声は端末に入っている日本語音声）
const synth = window.speechSynthesis;
let voice = null;
function pickVoice() {
  const vs = synth.getVoices().filter(v => v.lang.replace('_', '-').startsWith('ja'));
  voice = vs.find(v => /Kyoko|O-ren|Google/.test(v.name)) || vs[0] || null;
}
if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
export function say(text, interrupt = false) {
  if (!opt.voice || !synth) return;
  if (interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP'; if (voice) u.voice = voice;
  synth.speak(u);
}
export function hush() { synth?.cancel(); }

// バイブ（Vibration API。iPhone の Safari は非対応）
export function buzz(pattern) {
  if (!opt.vibe || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch {}
}
