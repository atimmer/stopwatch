'use strict';

const $ = (id) => document.getElementById(id);
const els = {
  time: $('time'), left: $('left'), right: $('right'), laps: $('laps'),
  auto: $('auto'), listen: $('listen'), fill: $('fill'), mark: $('mark'),
  sens: $('sens'), status: $('status'),
};
const DEC = (1.5).toLocaleString().charAt(1); // "," or "." like the iPhone
const KEY = 'stopwatch:v1';

/* ---------- Stopwatch ---------- */

// base: ms accumulated before the current run; since: wall-clock start of the current run.
// splits: total elapsed time at each lap press.
const fresh = () => ({ running: false, since: 0, base: 0, splits: [] });
let st = fresh();
try { st = { ...st, ...JSON.parse(localStorage.getItem(KEY)) }; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

const total = () => st.base + (st.running ? Date.now() - st.since : 0);
const pad = (n) => String(n).padStart(2, '0');
function fmt(ms) {
  const cs = Math.floor(ms / 10);
  const h = Math.floor(cs / 360000);
  return (h ? h + ':' : '') + pad(Math.floor(cs / 6000) % 60) + ':' + pad(Math.floor(cs / 100) % 60) + DEC + pad(cs % 100);
}

function start(at = Date.now()) {
  if (st.running) return;
  disarm();
  st.running = true;
  st.since = at;
  save(); update();
}
function stop() {
  if (!st.running) return;
  st.base = total();
  st.running = false;
  save(); update();
}
function lap() { st.splits.push(total()); save(); renderLaps(); }
function reset() { st = fresh(); save(); setStatus(''); update(); }

let currentLap = null;
function renderLaps() {
  const t = total();
  const d = st.splits.map((s, i) => s - (st.splits[i - 1] || 0));
  const best = d.length > 1 ? Math.min(...d) : -1;
  const worst = d.length > 1 ? Math.max(...d) : -1;
  const row = (n, ms, cls = '') => `<li class="${cls}"><span>Lap ${n}</span><span>${fmt(ms)}</span></li>`;
  let html = t > 0 ? row(d.length + 1, t - (st.splits.at(-1) || 0)) : '';
  for (let i = d.length - 1; i >= 0; i--) html += row(i + 1, d[i], d[i] === best ? 'best' : d[i] === worst ? 'worst' : '');
  els.laps.innerHTML = html;
  currentLap = t > 0 ? els.laps.firstElementChild.lastElementChild : null;
}

function tick() {
  const t = total();
  els.time.textContent = fmt(t);
  els.time.classList.toggle('long', t >= 3600000);
  if (currentLap) currentLap.textContent = fmt(t - (st.splits.at(-1) || 0));
}

let raf = 0;
function loop() { tick(); raf = st.running ? requestAnimationFrame(loop) : 0; }

function update() {
  const idle = !st.running && total() === 0;
  els.right.textContent = st.running ? 'Stop' : 'Start';
  els.right.className = 'round ' + (st.running ? 'red' : 'green');
  els.left.textContent = st.running || idle ? 'Lap' : 'Reset';
  els.left.disabled = idle;
  els.auto.disabled = st.running;
  renderLaps();
  cancelAnimationFrame(raf);
  loop();
  wake(st.running || listening);
}

els.right.onclick = () => (st.running ? stop() : start());
els.left.onclick = () => (st.running ? lap() : reset());

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') {
    if (e.target.tagName === 'BUTTON') return; // let the focused button handle it
    e.preventDefault();
    els.right.click();
  } else if (e.key === 'l' || e.key === 'r') {
    if (!els.left.disabled) els.left.click();
  } else if (e.key === 'v') {
    if (!els.auto.disabled) els.auto.click();
  }
});

/* ---------- Keep the screen on while timing or listening ---------- */

let lock = null;
async function wake(on) {
  try {
    if (on && !lock && navigator.wakeLock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!on && lock) {
      await lock.release();
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wake(st.running || listening);
});

/* ---------- Start when speaker detected ---------- */

// The mic signal is band-limited to the speech range. A frame counts as "loud" when it is
// clearly above the room's noise floor and as "voice" when its spectrum is also harmonic
// (low spectral flatness), which is what separates speech from applause, rustling or a cough.
// The timer starts when most of the last WINDOW ms was voice, backdated to the first voice frame.
const TICK = 20;          // ms between measurements
const CALIBRATE = 700;    // ms spent measuring the noise floor after arming
const WINDOW = 350;       // ms of sustained voice needed to trigger
const MIN_DB = -70;       // never trigger below this level (dBFS)
const MAX_FLATNESS = 0.3; // spectral flatness below this = harmonic, voice-like
const SENS_KEY = 'stopwatch:sensitivity';

let listening = false;
let audio = null;

try { els.sens.value = localStorage.getItem(SENS_KEY) ?? 50; } catch {}
els.sens.oninput = () => { try { localStorage.setItem(SENS_KEY, els.sens.value); } catch {} };
const margin = () => 30 - 0.24 * els.sens.value; // dB above the noise floor: 30 (low) .. 6 (high)

let statusTimer = 0;
function setStatus(text, ms = 0) {
  clearTimeout(statusTimer);
  els.status.textContent = text;
  if (ms) statusTimer = setTimeout(() => { els.status.textContent = ''; }, ms);
}

function setListening(on) {
  listening = on;
  els.listen.hidden = !on;
  els.auto.classList.toggle('on', on);
  els.auto.querySelector('span').textContent = on ? 'Cancel listening' : 'Start when speaker detected';
  wake(st.running || listening);
}

async function arm() {
  if (!navigator.mediaDevices?.getUserMedia) return setStatus('This browser has no microphone access (HTTPS needed).');
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC(); // created inside the tap so iOS allows it to run
  setListening(true);
  setStatus('Allow the microphone…');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false },
    });
  } catch (err) {
    ctx.close();
    setListening(false);
    return setStatus(err.name === 'NotAllowedError' ? 'Microphone access was denied.' : 'Could not open the microphone.');
  }
  if (!listening) { stream.getTracks().forEach((t) => t.stop()); ctx.close(); return; } // cancelled meanwhile
  await ctx.resume();

  const src = ctx.createMediaStreamSource(stream);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000;
  const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.2;
  src.connect(hp).connect(lp).connect(an);

  const td = new Float32Array(an.fftSize);
  const fd = new Float32Array(an.frequencyBinCount);
  const binHz = ctx.sampleRate / an.fftSize;
  const lo = Math.ceil(150 / binHz), hi = Math.floor(3000 / binHz), n = hi - lo + 1;
  const t0 = Date.now();
  const calib = [];
  const frames = [];
  let floor = null;

  setStatus('Calibrating… keep quiet for a moment');

  const detect = () => {
    const now = Date.now();
    an.getFloatTimeDomainData(td);
    let sum = 0;
    for (let i = 0; i < td.length; i++) sum += td[i] * td[i];
    const db = 10 * Math.log10(sum / td.length + 1e-12);

    an.getFloatFrequencyData(fd);
    let meanDb = 0, meanP = 0;
    for (let i = lo; i <= hi; i++) {
      const v = Math.max(fd[i], -160);
      meanDb += v; meanP += 10 ** (v / 10);
    }
    const flatness = 10 ** (meanDb / n / 10) / (meanP / n); // geometric mean / arithmetic mean

    if (now - t0 < CALIBRATE) { calib.push(db); draw(db, null, false, false); return; }
    if (floor === null) {
      calib.sort((a, b) => a - b);
      floor = calib[calib.length >> 1] ?? db;
      setStatus('Listening… the timer starts when the speaker does');
    }

    const thr = Math.max(floor + margin(), MIN_DB);
    const loud = db > thr;
    const voice = loud && flatness < MAX_FLATNESS;
    // Follow the noise floor: drop quickly, rise slowly (≈0.5 dB/s) while it's quiet.
    if (db < floor) floor = 0.8 * floor + 0.2 * db;
    else if (!loud) floor += 0.01;
    draw(db, thr, loud, voice);

    frames.push({ t: now, loud, voice });
    while (frames[0].t < now - WINDOW) frames.shift();
    if (now - frames[0].t < WINDOW - 2 * TICK) return;
    const loudShare = frames.filter((f) => f.loud).length / frames.length;
    const voiceShare = frames.filter((f) => f.voice).length / frames.length;
    if (loudShare >= 0.7 && voiceShare >= 0.5) {
      const onset = frames.find((f) => f.voice).t - TICK;
      start(onset);
      setStatus('Started when the speaker began', 4000);
    }
  };
  audio = { ctx, stream, timer: setInterval(detect, TICK) };
}

const toPct = (db) => Math.min(100, Math.max(0, ((db + 90) / 80) * 100)); // -90..-10 dBFS
function draw(db, thr, loud, voice) {
  els.fill.style.width = toPct(db) + '%';
  els.fill.className = voice ? 'voice' : loud ? 'loud' : '';
  els.mark.style.left = thr === null ? '100%' : toPct(thr) + '%';
}

function disarm() {
  if (audio) {
    clearInterval(audio.timer);
    audio.stream.getTracks().forEach((t) => t.stop());
    audio.ctx.close();
    audio = null;
  }
  if (listening) { setListening(false); setStatus(''); }
}

els.auto.onclick = () => (listening ? disarm() : arm());

update();
