import { LINES, DIR_NAME, segMin, makePath, pathMin, endAngle } from './stations.js';
import { ring, labelSize, fitCentered } from './ring.js';
import * as snd from './sound.js';

const $ = id => document.getElementById(id);
const DWELL = 20000; // 停車時間（実時間 ms）
const SPEEDS = [1, 2, 4, 10];
const SFX_MODES = { sound: '効果音', both: '効果音＋バイブ', vibe: 'バイブ', off: '効果音・バイブ：オフ' };
const STORE = 'eki-timer:settings';
// バイブのパターン（ms。振動・休み・振動…）。短すぎると気づかないので 200ms 以上にする
const VIBE = {
  check: 200,                                  // ベルを切り替えたとき
  door: [200, 100, 200],                       // 出発・ドアが閉まる
  soon: 200,                                   // まもなく
  arrive: [300, 150, 300],                     // 駅に着いた
  arriveShort: 300,                            // 駅間が短いとき
  finish: [500, 200, 500, 200, 500, 200, 500], // 終点
};

// 選んでいる区間（dirTouched は回り方を自分で選んだか。選んでいなければ近いほうにする）
const sel = { line: 'yamanote', from: 0, to: 11, dir: 'cw', dirTouched: false };
let sfxMode = 'sound', speed = 1;
let pickStep = 'from'; // 次のタップで決めるのが乗る駅か降りる駅か

// 秒 → 「6分15秒」「30秒」「25分」
function dur(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), r = sec % 60;
  return m ? `${m}分${r ? r + '秒' : ''}` : `${r}秒`;
}
// ミリ秒 → 「12:05」「1:02:30」
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0');
}
const hhmm = d => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

// ===== 設定画面 =====
function renderLineSeg() {
  $('lineSeg').innerHTML = Object.entries(LINES).map(([k, L]) =>
    `<button type="button" data-k="${k}" class="${k === sel.line ? 'on' : ''}" style="--c:${L.color}"><i></i>${L.name}</button>`).join('');
}
function dirOptions() {
  const L = LINES[sel.line];
  return ['cw', 'ccw'].map(dir => {
    const p = makePath(L, sel.from, sel.to, dir);
    return { dir, p, min: pathMin(L, p, dir) };
  });
}
function renderSetup() {
  document.documentElement.style.setProperty('--line', LINES[sel.line].color);
  const opts = dirOptions();
  if (!sel.dirTouched) sel.dir = opts[0].min <= opts[1].min ? 'cw' : 'ccw';
  renderPick(opts);
  save();
}

// 輪から駅を選ぶ：1回目のタップで乗る駅、2回目で降りる駅。回り方は輪の中で切り替え
function renderPick(opts) {
  const L = LINES[sel.line], g = ring(150, 150), choosing = pickStep === 'to';
  const { p, min } = opts.find(o => o.dir === sel.dir);
  const route = new Set(choosing ? [sel.from] : p);
  let s = `<g id="pickg"><ellipse class="rail" rx="${g.rx}" ry="${g.ry}"/>`;
  if (!choosing) s += `<path class="route-line" d="${g.arc(L.ang[sel.from], endAngle(L, sel.from, min, sel.dir))}"/>`;
  L.st.forEach((st, i) => {
    const [x, y] = g.pt(L.ang[i]);
    const isFrom = i === sel.from, isTo = !choosing && i === sel.to;
    s += `<g class="pk ${isFrom || isTo ? 'end' : route.has(i) ? 'route' : ''}" data-i="${i}"><circle class="hit" cx="${x}" cy="${y}" r="17"/>`;
    s += isFrom || isTo
      ? `<circle class="mk ${isFrom ? 'mk-from' : 'mk-to'}" cx="${x}" cy="${y}" r="11"/>
         <text class="mk-text" x="${x}" y="${y}" font-size="12" text-anchor="middle" dominant-baseline="central">${isFrom && isTo ? '周' : isFrom ? '乗' : '降'}</text>`
      : `<circle class="pd" cx="${x}" cy="${y}" r="5"/>`;
    s += `<text class="pl" ${g.label(L.ang[i], 17)} style="font-size:${labelSize(st[0])}px">${st[0]}</text></g>`;
  });
  const [f, t] = [L.st[sel.from][0], L.st[sel.to][0]];
  if (choosing) {
    s += `<text class="t-strong" y="-22" font-size="22">${f} から</text>`;
    s += `<text class="t-accent" y="10" font-size="18">降りる駅をタップ</text>`;
    s += `<text class="t-muted" y="38" font-size="13">同じ駅なら一周</text>`;
  } else {
    s += `<text class="t-strong" y="-54" font-size="22">${sel.from === sel.to ? `${f} から一周` : `${f} → ${t}`}</text>`;
    s += `<text class="t-muted" y="-28" font-size="16">${p.length - 1}駅${speed > 1 ? `<tspan class="t-accent t-bold"> ・ ${speed}倍速</tspan>` : ''}</text>`;
    opts.forEach((o, k) => { // 外回り／内回りの切り替え。倍速中は元の時間に取り消し線
      const x = k ? 5 : -117;
      s += `<g class="dt ${o.dir === sel.dir ? 'on' : ''}" data-dir="${o.dir}"><rect x="${x}" y="-10" width="112" height="52" rx="26"/>
        <text class="dt-name" x="${x + 56}" y="8" font-size="13">${DIR_NAME[o.dir]}${speed > 1 ? ` <tspan class="dt-was">${o.min}分</tspan>` : ''}</text>
        <text class="dt-time" x="${x + 56}" y="30" font-size="${speed > 1 ? 17 : 19}">${dur(o.min * 60 / speed)}</text></g>`;
    });
    s += `<text class="t-muted" y="66" font-size="13">駅をタップで選び直す</text>`;
  }
  $('pick').innerHTML = s + '</g>';
  fitCentered($('pick'), $('pickg'), 8);
}

$('pick').addEventListener('click', e => {
  const d = e.target.closest('.dt');
  if (d) { sel.dir = d.dataset.dir; sel.dirTouched = true; renderSetup(); return; }
  const g = e.target.closest('.pk'); if (!g) return;
  const i = +g.dataset.i;
  if (pickStep === 'from') { sel.from = i; pickStep = 'to'; }
  else { sel.to = i; pickStep = 'from'; }
  sel.dirTouched = false;
  renderSetup();
});
$('lineSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  pickStep = 'from';
  sel.line = b.dataset.k; [sel.from, sel.to] = LINES[sel.line].def; sel.dirTouched = false;
  renderLineSeg(); renderSetup();
});

// ===== オプション（ブラウザに保存） =====
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      ...sel, sfxMode, speed,
      voice: $('optVoice').checked, rumble: $('optRumble').checked, awake: $('optAwake').checked,
    }));
  } catch {}
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    if (!d) return;
    if (d.sfxMode in SFX_MODES) sfxMode = d.sfxMode;
    if (SPEEDS.includes(d.speed)) speed = d.speed;
    for (const [k, id] of [['voice', 'optVoice'], ['rumble', 'optRumble'], ['awake', 'optAwake']]) {
      if (typeof d[k] === 'boolean') $(id).checked = d[k];
    }
    const L = LINES[d.line], ok = i => Number.isInteger(i) && i >= 0 && i < L.st.length;
    if (L && ok(d.from) && ok(d.to) && (d.dir === 'cw' || d.dir === 'ccw')) {
      Object.assign(sel, { line: d.line, from: d.from, to: d.to, dir: d.dir, dirTouched: !!d.dirTouched });
    }
  } catch {}
}
function renderSfx() {
  const b = $('optSfx');
  b.dataset.mode = sfxMode; b.title = SFX_MODES[sfxMode];
  b.classList.toggle('on', sfxMode !== 'off');
  $('sfxLabel').textContent = SFX_MODES[sfxMode];
}
function renderSpeed() {
  const name = speed === 1 ? '通常' : `${speed}倍速`;
  $('optSpeed').classList.toggle('on', speed > 1);
  $('spdBadge').textContent = speed > 1 ? `${speed}×` : '';
  $('spdLabel').textContent = `速さ：${name}`;
  return name;
}

// アイコンを押したら、何が変わったかを一瞬だけ出す
let toastT;
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.remove('show'), 1400);
}
document.querySelector('.opts').addEventListener('change', e => {
  toast(`${e.target.closest('.tg').title}：${e.target.checked ? 'オン' : 'オフ'}`);
  save();
});
// ベル：押すたびに 効果音 → 効果音＋バイブ → バイブ → オフ
$('optSfx').addEventListener('click', () => {
  const ks = Object.keys(SFX_MODES);
  sfxMode = ks[(ks.indexOf(sfxMode) + 1) % ks.length];
  renderSfx(); toast(SFX_MODES[sfxMode]); save();
  if (sfxMode === 'both' || sfxMode === 'vibe') { snd.opt.vibe = true; snd.buzz(VIBE.check); } // その場で一度ふるわせて確かめられるように
});
// 早送り：押すたびに 通常 → 2倍 → 4倍 → 10倍 → 通常
$('optSpeed').addEventListener('click', () => {
  speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  toast(`速さ：${renderSpeed()}`);
  renderSetup();
});

// ===== 運行計画 =====
// 区間ごとに「走る → 停車」を並べ、アナウンスや効果音を鳴らす時刻（ms）を決める
function buildPlan() {
  const L = LINES[sel.line];
  const p = makePath(L, sel.from, sel.to, sel.dir);
  const scale = 1 / speed;
  const segs = [], ev = [], ang = [L.ang[p[0]]];
  let t = 0;
  for (let k = 0; k < p.length - 1; k++) {
    const m = segMin(L, p[k], p[k + 1], sel.dir);
    const D = m * 60000 * scale;
    const last = k === p.length - 2;
    const dwell = last ? 0 : Math.min(DWELL * scale, D * 0.3);
    segs.push({ t0: t, D, run: D - dwell, dwell });
    ang.push(ang[k] + (sel.dir === 'cw' ? 1 : -1) * m / L.total * Math.PI * 2);
    t += D;
  }
  ev.push({ t: 0, type: 'start' });
  segs.forEach((s, k) => {
    const last = k === segs.length - 1;
    const short = s.run < 6000; // 駅間が短すぎるときは駅名だけ言う
    if (k > 0 && segs[k - 1].dwell >= 3000) ev.push({ t: s.t0 - Math.min(2200, segs[k - 1].dwell * 0.4), type: 'close', k });
    if (!short) {
      if (k > 0) ev.push({ t: s.t0 + Math.min(5000, s.run * 0.15), type: 'next', k });
      if (s.run >= 25000) ev.push({ t: s.t0 + s.run - Math.min(30000, s.run * 0.25), type: 'soon', k });
    }
    ev.push({ t: s.t0 + s.run, type: last ? 'finish' : 'arrive', k, short });
    if (!last && s.dwell >= 6000) ev.push({ t: s.t0 + s.run + Math.min(2500, s.dwell * 0.25), type: 'melody', k });
  });
  ev.sort((a, b) => a.t - b.t);
  return { L, key: sel.line, dir: sel.dir, path: p, segs, ev, ang, total: t, brief: speed >= 4 };
}

let plan = null, state = 'idle', startAt = 0, pausedAt = 0, pausedMs = 0, evi = 0, moving = null, wl = null;
const elapsed = () => (state === 'paused' ? pausedAt : performance.now()) - startAt - pausedMs;
const stationAt = k => plan.L.st[plan.path[k]];
function segIndex(el) {
  const i = plan.segs.findIndex(s => el < s.t0 + s.D);
  return i < 0 ? plan.segs.length - 1 : i;
}

function fire(e) {
  const L = plan.L;
  const nx = e.k !== undefined ? stationAt(e.k + 1)[1] : null;
  switch (e.type) {
    case 'start': {
      snd.doorClose(); snd.buzz(VIBE.door);
      const dest = stationAt(plan.path.length - 1)[1];
      if (plan.brief) snd.say(`${L.name}、${DIR_NAME[plan.dir]}。${dest}まで。`);
      else snd.say(`ご乗車ありがとうございます。この電車は、${L.name}、${DIR_NAME[plan.dir]}です。${dest}まで、${plan.path.length - 1}駅、およそ${Math.round(plan.total / 60000)}分です。次は、${stationAt(1)[1]}、${stationAt(1)[1]}。`);
      break;
    }
    case 'close': snd.doorClose(); snd.buzz(VIBE.door); break;
    case 'next': snd.say(`次は、${nx}、${nx}。`); break;
    case 'soon': snd.chime(); snd.buzz(VIBE.soon); snd.say(`まもなく、${nx}です。`); break;
    case 'arrive':
      snd.chime(); snd.buzz(e.short ? VIBE.arriveShort : VIBE.arrive);
      if (e.short) snd.say(nx, true);
      else { snd.doorOpen(); snd.say(`${nx}、${nx}です。`); }
      break;
    case 'melody': snd.melody(plan.path[e.k + 1] * 131 + (plan.key === 'osaka' ? 7777 : 0)); break;
    case 'finish': finish(); break;
  }
}

function tick() {
  if (state !== 'running') return;
  const el = elapsed();
  while (evi < plan.ev.length && plan.ev[evi].t <= el) {
    const e = plan.ev[evi++];
    // バックグラウンドから戻ったときに溜まった音をまとめて鳴らさない
    if (el - e.t < 2500 || e.type === 'finish') fire(e);
  }
  if (state !== 'running') return;
  const k = segIndex(el), s = plan.segs[k];
  const m = el < s.t0 + s.run;
  if (m !== moving) { moving = m; snd.rumbleMoving(m); }
  document.title = `${clock(plan.total - el)} ・ ${stationAt(k + 1)[0]}｜えきタイマー`;
}

// 画面のスリープ防止（Wake Lock API）
async function lock() {
  if (!$('optAwake').checked) return;
  try { wl = await navigator.wakeLock?.request('screen'); } catch { wl = null; }
}
function unlock() { try { wl?.release(); } catch {} wl = null; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state === 'running') { lock(); tick(); }
});

function depart() {
  if (pickStep === 'to') { pickStep = 'from'; renderSetup(); }
  Object.assign(snd.opt, {
    sfx: sfxMode === 'sound' || sfxMode === 'both', vibe: sfxMode === 'both' || sfxMode === 'vibe',
    voice: $('optVoice').checked, rumble: $('optRumble').checked,
  });
  snd.unlockAudio();
  plan = buildPlan();
  state = 'running'; startAt = performance.now(); pausedMs = 0; evi = 0; moving = null;
  $('setup').hidden = true; $('ride').hidden = false; document.body.classList.add('riding');
  $('btnPause').textContent = '一時停止'; $('btnPause').className = ''; $('btnStop').textContent = '降りる';
  drawMap();
  snd.rumbleStart(); lock();
  tick();
  window.scrollTo(0, 0);
}
function finish() {
  state = 'done';
  snd.rumbleStop(); unlock();
  snd.finale(); snd.buzz(VIBE.finish);
  const d = stationAt(plan.path.length - 1);
  snd.say(`${d[1]}、${d[1]}です。ご乗車、おつかれさまでした。時間です。`, true);
  $('btnPause').textContent = 'もう一度乗る'; $('btnPause').className = 'primary';
  $('btnStop').textContent = '設定にもどる';
  document.title = `到着！ ${d[0]}｜えきタイマー`;
}
$('btnGo').addEventListener('click', depart);
$('btnPause').addEventListener('click', () => {
  if (state === 'running') {
    state = 'paused'; pausedAt = performance.now();
    snd.hush(); snd.rumblePause();
    $('btnPause').textContent = '再開';
  } else if (state === 'paused') {
    pausedMs += performance.now() - pausedAt; state = 'running'; moving = null; // 走行音を今の状態に合わせ直す
    $('btnPause').textContent = '一時停止';
    tick();
  } else if (state === 'done') {
    depart();
  }
});
$('btnStop').addEventListener('click', () => {
  state = 'idle'; snd.hush(); snd.rumbleStop(); unlock();
  $('ride').hidden = true; $('setup').hidden = false; document.body.classList.remove('riding');
  document.title = 'えきタイマー';
});

// ===== 乗車中の画面 =====
let mapRing = ring(150, 150), shownNext = -1;
function drawMap() {
  const L = plan.L, g = mapRing;
  let s = `<g id="mapg"><ellipse class="rail" rx="${g.rx}" ry="${g.ry}"/>`;
  s += `<path class="route-line faint" d="${g.arc(plan.ang[0], plan.ang[plan.ang.length - 1])}"/>`;
  s += `<path class="route-line" id="done"/>`;
  L.st.forEach((st, i) => {
    const [x, y] = g.pt(L.ang[i]);
    s += `<circle id="sd${i}" class="sd" cx="${x}" cy="${y}" r="4.5"/>`;
    s += `<text id="sl${i}" class="sl" ${g.label(L.ang[i], 15)} style="font-size:${labelSize(st[0])}px">${st[0]}</text>`;
  });
  s += `<g id="train"><circle r="14"/><text font-size="15" text-anchor="middle" dominant-baseline="central">🚃</text></g>`;
  s += `<text class="t-muted" y="-46" font-size="17">${L.name}</text>`;
  s += `<text class="t-strong" id="mRemain" y="0" font-size="50"></text>`;
  s += `<text class="t-strong" id="mLeft" y="34" font-size="18"></text>`;
  s += `<text class="t-muted" id="mEta" y="58" font-size="16"></text></g>`;
  $('map').innerHTML = s;
  fitCentered($('map'), $('mapg'), 18); // 電車の丸がはみ出す分だけ余白
  shownNext = -1;
  const dest = stationAt(plan.path.length - 1)[0];
  $('lcdLine').textContent = `${L.name} ${DIR_NAME[plan.dir]}`;
  $('lcdDest').textContent = plan.path[0] === plan.path[plan.path.length - 1] ? `一周して ${dest}まで` : `${dest}まで`;
}
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (plan && state !== 'idle') drawMap(); }, 150);
});

// 路線図の駅：区間外は暗く、通過済みはグレー、次（停車中）の駅は黄色
function markStations(h) {
  const last = new Map();
  plan.path.forEach((st, j) => last.set(st, j));
  const goal = plan.path[plan.path.length - 1];
  plan.L.st.forEach((_, i) => {
    let c = '';
    if (i === plan.path[h]) c = 'next';
    else if (last.has(i)) c = last.get(i) < h ? 'passed' : 'route';
    $('sl' + i).setAttribute('class', 'sl ' + c);
    $('sd' + i).setAttribute('class', 'sd ' + c);
    $('sd' + i).setAttribute('r', c === 'next' ? 8 : i === goal ? 7 : 4.5);
  });
}

function render() {
  requestAnimationFrame(render);
  if (!plan || state === 'idle') return;
  const el = Math.min(elapsed(), plan.total);
  const k = segIndex(el), s = plan.segs[k];
  const done = state === 'done';
  const run = !done && el < s.t0 + s.run;
  // 駅を出るときは加速、着くときは減速
  const p = run ? Math.max(0, (el - s.t0) / s.run) : 1;
  const ta = plan.ang[k] + (plan.ang[k + 1] - plan.ang[k]) * (0.5 - 0.5 * Math.cos(Math.PI * p));
  const [tx, ty] = mapRing.pt(ta);
  $('train').setAttribute('transform', `translate(${tx} ${ty})`);
  $('done').setAttribute('d', mapRing.arc(plan.ang[0], ta));

  const st = stationAt(k + 1);
  const left = plan.path.length - 1 - k - (run ? 0 : 1);
  $('lcdLabel').textContent = done ? '到着しました' : run ? (left === 1 ? '次は 終点' : '次は') : 'ただいま';
  $('lcdName').textContent = st[0];
  $('lcdName').style.setProperty('--n', Math.max(4, st[0].length)); // 長い駅名は1行に収まるよう縮める
  $('lcdKana').textContent = st[1];
  const rem = plan.total - el;
  $('bar').style.width = (el / plan.total * 100) + '%';
  $('mRemain').textContent = clock(rem);
  $('mLeft').textContent = done ? 'おつかれさまでした' : `あと ${left} 駅`;
  $('mEta').textContent = done ? '' : state === 'paused' ? '一時停止中' : `${hhmm(new Date(Date.now() + rem))} 着`;
  if (shownNext !== k + 1) { shownNext = k + 1; markStations(k + 1); }
}

// ===== はじめに =====
load();
// スリープ防止に対応していない環境では、アイコンを押せなくする
if (!('wakeLock' in navigator)) {
  $('optAwake').checked = false; $('optAwake').disabled = true;
  $('optAwake').parentElement.title += '（この環境では未対応）';
}
renderLineSeg(); renderSetup(); renderSfx(); renderSpeed();
setInterval(tick, 100); // 背景タブでも止まりにくいタイマーで進める
requestAnimationFrame(render);
