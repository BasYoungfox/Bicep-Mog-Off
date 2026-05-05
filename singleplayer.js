const MP_VERSION = '0.10.14';
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const TIERS = [
  { key: 'sub3',     name: 'Sub-3',    desc: 'Skin and bone. The arm is still loading.' },
  { key: 'sub5',     name: 'Sub-5',    desc: 'Awareness unlocked. The journey begins.' },
  { key: 'ltn',      name: 'LTN',      desc: 'Low-tier normie. Visible effort, no payoff yet.' },
  { key: 'mtn',      name: 'MTN',      desc: 'Mid-tier normie. Civilian-respectable.' },
  { key: 'htn',      name: 'HTN',      desc: 'High-tier normie. Sleeves are starting to argue.' },
  { key: 'chad',     name: 'CHAD',     desc: 'Genuine arm. People notice in passing.' },
  { key: 'chadlite', name: 'CHADLITE', desc: 'Borderline mythical. Mogs in real time.' }
];

const POINT_DEFS = [
  { label: 'Peak height',             t: 0.50, perp:  0.22 },
  { label: 'Vein definition',         t: 0.40, perp:  0.13 },
  { label: 'Belly density',           t: 0.50, perp:  0.10 },
  { label: 'Bicep–tricep separation', t: 0.72, perp:  0.06 },
  { label: 'Insertion length',        t: 0.88, perp:  0.10 },
  { label: 'Skin tightness',          t: 0.28, perp:  0.12 }
];

const DETECT_INTERVAL_MS = 70;
const SMOOTH_LM = 0.40;
const SMOOTH_SCORE = 0.18;
const STALE_AFTER_MS = 600;

const canvasWrap = document.getElementById('canvasWrap');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const video = document.getElementById('video');
const canvasMsg = document.getElementById('canvasMsg');
const canvasLoading = document.getElementById('canvasLoading');
const loadingText = document.getElementById('loadingText');
const camHud = document.getElementById('camHud');

const startCam = document.getElementById('startCam');
const flipBtn = document.getElementById('flipBtn');
const stopBtn = document.getElementById('stopBtn');
const hint = document.getElementById('hint');

const ratingCard = document.getElementById('ratingCard');
const ratingValue = document.getElementById('ratingValue');
const scaleBars = document.getElementById('scaleBars');
const scaleLabels = document.getElementById('scaleLabels');
const pointsList = document.getElementById('pointsList');

let stream = null;
let facingMode = 'user';
let poseLandmarker = null;
let posePromise = null;
let running = false;
let rafId = null;
let lastDetectTs = -1;
let lastTrackedTs = 0;

let stateArm = null;
let stateScores = null;
let statePoints = null;
let displayedTier = -1;

initScale();

startCam.addEventListener('click', async () => {
  loadPose();
  await startCamera();
  startLoop();
});
flipBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  await startCamera();
});
stopBtn.addEventListener('click', () => stopAll());

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showMsg('Camera API not available', 'Try a different browser.');
    return;
  }
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    sizeCanvasToVideo();
    startCam.style.display = 'none';
    flipBtn.style.display = 'inline-block';
    stopBtn.style.display = 'inline-block';
    camHud.style.display = 'flex';
    showMsg('Step into frame', 'We need your shoulder, elbow, and wrist visible.', true);
    hint.textContent = 'Live tracking active. Move closer / further until points lock onto your arm.';
  } catch (err) {
    showMsg(
      err.name === 'NotAllowedError' ? 'Camera blocked' : 'Camera error',
      err.name === 'NotAllowedError' ? 'Allow camera access in your browser to continue.' : err.message
    );
  }
}

function sizeCanvasToVideo() {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const targetW = Math.min(720, vw);
  const ratio = targetW / vw;
  canvas.width = Math.round(vw * ratio);
  canvas.height = Math.round(vh * ratio);
}

function showMsg(title, body, hintOnly = false) {
  canvasMsg.style.display = 'flex';
  canvasMsg.classList.toggle('hint-only', hintOnly);
  canvasMsg.querySelector('strong').textContent = title;
  canvasMsg.querySelector('p').textContent = body;
  canvasMsg.querySelector('.cam-icon').style.display = hintOnly ? 'none' : 'block';
}

function hideMsg() {
  canvasMsg.style.display = 'none';
}

function stopAll() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  startCam.style.display = 'inline-block';
  flipBtn.style.display = 'none';
  stopBtn.style.display = 'none';
  camHud.style.display = 'none';
  canvasWrap.classList.remove('tracking');
  showMsg('Camera off', 'Tap Start Camera to flex live.');
  resetState();
  ratingValue.textContent = '—';
  ratingCard.className = 'rating-card';
  initScale();
  pointsList.innerHTML = `<li style="border-top:none"><div style="flex:1; color:var(--muted); font-size:13px;">Start the camera and step into frame. Your rating updates in real time.</div></li>`;
  hint.textContent = 'Tip: good lighting, full arm visible. Tracker auto-locks on the more flexed arm.';
  displayedTier = -1;
}

function resetState() {
  stateArm = null;
  stateScores = null;
  statePoints = null;
  lastTrackedTs = 0;
}

window.addEventListener('beforeunload', stopAll);

async function loadPose() {
  if (poseLandmarker) return poseLandmarker;
  if (posePromise) return posePromise;
  canvasLoading.style.display = 'flex';
  loadingText.textContent = 'Loading pose model…';
  posePromise = (async () => {
    const vision = await import(MP_MODULE);
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4
    });
    try {
      poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    return poseLandmarker;
  })();
  try {
    await posePromise;
  } finally {
    canvasLoading.style.display = 'none';
  }
  return poseLandmarker;
}

function startLoop() {
  if (running) return;
  running = true;
  loop();
}

function loop() {
  if (!running) return;
  rafId = requestAnimationFrame(loop);

  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;

  if (canvas.width === 0 || Math.abs(canvas.width / canvas.height - vw / vh) > 0.01) {
    sizeCanvasToVideo();
  }

  const w = canvas.width, h = canvas.height;

  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  const now = performance.now();
  if (poseLandmarker && now - lastDetectTs > DETECT_INTERVAL_MS) {
    lastDetectTs = now;
    try {
      const result = poseLandmarker.detectForVideo(video, now);
      handleDetection(result, w, h, now);
    } catch (e) {
      console.warn('detection error', e);
    }
  }

  if (statePoints) {
    drawOverlayPoints(statePoints);
  }

  if (lastTrackedTs && performance.now() - lastTrackedTs > STALE_AFTER_MS) {
    if (statePoints || stateArm) {
      resetState();
      canvasWrap.classList.remove('tracking');
      showMsg('Lost track', 'Get your arm back in frame.', true);
      ratingValue.textContent = '—';
      ratingCard.className = 'rating-card';
      pointsList.innerHTML = `<li style="border-top:none"><div style="flex:1; color:var(--muted); font-size:13px;">No arm detected. Adjust position or lighting.</div></li>`;
      initScale();
      displayedTier = -1;
    }
  }
}

function handleDetection(result, w, h, now) {
  if (!result.landmarks || result.landmarks.length === 0) {
    return;
  }
  const mirrored = mirrorLandmarks(result.landmarks[0]);
  const arm = pickFlexedArm(mirrored);
  if (!arm) return;

  if (!stateArm) {
    stateArm = cloneArm(arm);
  } else {
    lerpArmInPlace(stateArm, arm, SMOOTH_LM);
  }
  stateArm.elbowAngle = elbowAngle(stateArm.s, stateArm.e, stateArm.w);

  const pts = placePointsOnArm(stateArm, w, h);
  const sc = scorePoints(pts, stateArm, w, h);

  if (!stateScores) {
    stateScores = sc.slice();
  } else {
    for (let i = 0; i < sc.length; i++) {
      stateScores[i] += (sc[i] - stateScores[i]) * SMOOTH_SCORE;
    }
  }

  pts.forEach((p, i) => p.score = Math.round(stateScores[i]));
  statePoints = pts;
  lastTrackedTs = now;
  canvasWrap.classList.add('tracking');
  hideMsg();

  updateSidebar(pts);
}

function mirrorLandmarks(lm) {
  return lm.map(p => ({ x: 1 - p.x, y: p.y, z: p.z, visibility: p.visibility }));
}

function pickFlexedArm(lm) {
  const left  = { s: lm[12], e: lm[14], w: lm[16] };
  const right = { s: lm[11], e: lm[13], w: lm[15] };

  function rate(arm) {
    const v = (arm.s.visibility + arm.e.visibility + arm.w.visibility) / 3;
    if (v < 0.45) return -Infinity;
    const angle = elbowAngle(arm.s, arm.e, arm.w);
    return v * 100 + (180 - angle);
  }

  const lr = rate(left);
  const rr = rate(right);
  if (lr === -Infinity && rr === -Infinity) return null;
  return lr >= rr ? left : right;
}

function cloneArm(a) {
  return {
    s: { ...a.s },
    e: { ...a.e },
    w: { ...a.w }
  };
}

function lerpArmInPlace(target, src, alpha) {
  for (const k of ['s', 'e', 'w']) {
    target[k].x += (src[k].x - target[k].x) * alpha;
    target[k].y += (src[k].y - target[k].y) * alpha;
    target[k].visibility = src[k].visibility;
  }
}

function elbowAngle(s, e, w) {
  const v1x = s.x - e.x, v1y = s.y - e.y;
  const v2x = w.x - e.x, v2y = w.y - e.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))) * 180 / Math.PI;
}

function placePointsOnArm(arm, w, h) {
  const sx = arm.s.x * w, sy = arm.s.y * h;
  const ex = arm.e.x * w, ey = arm.e.y * h;
  const wx = arm.w.x * w, wy = arm.w.y * h;

  const dx = ex - sx, dy = ey - sy;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const ux = dx / len, uy = dy / len;
  let nx = -uy, ny = ux;

  const wpx = wx - ex, wpy = wy - ey;
  const dotN = wpx * nx + wpy * ny;
  if (dotN < 0) { nx = -nx; ny = -ny; }

  return POINT_DEFS.map(def => {
    const x = sx + ux * len * def.t + nx * len * def.perp;
    const y = sy + uy * len * def.t + ny * len * def.perp;
    return { label: def.label, x, y };
  });
}

function scorePoints(points, arm, w, h) {
  const upperLen = Math.hypot((arm.e.x - arm.s.x) * w, (arm.e.y - arm.s.y) * h);
  const radius = Math.max(8, upperLen * 0.10);

  const stds = points.map(p => sampleStd(p.x, p.y, radius));
  const globalAvg = stds.reduce((a, b) => a + b, 0) / Math.max(1, stds.length);

  const flexBonus = Math.max(0, (180 - arm.elbowAngle)) * 0.25;
  const forearmLen = Math.hypot((arm.w.x - arm.e.x) * w, (arm.w.y - arm.e.y) * h);
  const insertionRatio = forearmLen / Math.max(1, upperLen);
  const insertionScore = Math.min(95, 35 + insertionRatio * 35);

  return points.map((p, i) => {
    const local = stds[i];
    let s = 25 + local * 1.6;
    if (i === 0) s += flexBonus * 0.6;
    if (i === 4) s = (s + insertionScore) / 2;
    s += (local - globalAvg) * 0.6;
    return Math.max(12, Math.min(98, s));
  });
}

function sampleStd(cx, cy, radius) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const ww = Math.min(canvas.width - x0, Math.floor(radius * 2));
  const hh = Math.min(canvas.height - y0, Math.floor(radius * 2));
  if (ww < 4 || hh < 4) return 15;
  const data = ctx.getImageData(x0, y0, ww, hh).data;
  let sum = 0, sumSq = 0, n = 0;
  for (let i = 0; i < data.length; i += 8) {
    const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    sum += lum; sumSq += lum * lum; n++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return Math.sqrt(variance);
}

function drawOverlayPoints(points) {
  const w = canvas.width, h = canvas.height;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 59, 48, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();

  points.forEach((p, i) => {
    const labelOffsetX = p.x < w / 2 ? -100 : 30;
    const labelOffsetY = p.y < h / 2 ? -10 : 20;
    const lx = Math.max(8, Math.min(w - 160, p.x + labelOffsetX));
    const ly = Math.max(20, Math.min(h - 8, p.y + labelOffsetY));

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 176, 32, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(lx + (labelOffsetX < 0 ? 80 : 10), ly - 6);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#ff3b30';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), p.x, p.y + 0.5);
    ctx.restore();

    const text = `${p.label}  ${p.score}`;
    ctx.save();
    ctx.font = 'bold 11px Inter, sans-serif';
    const tw = ctx.measureText(text).width + 14;
    ctx.fillStyle = 'rgba(20, 20, 28, 0.92)';
    ctx.strokeStyle = 'rgba(255, 176, 32, 0.6)';
    ctx.lineWidth = 1;
    roundRect(ctx, lx, ly - 14, tw, 20, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffb020';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 7, ly - 4);
    ctx.restore();
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function initScale() {
  scaleBars.innerHTML = '';
  scaleLabels.innerHTML = '';
  TIERS.forEach((t) => {
    const bar = document.createElement('div');
    bar.className = 'step';
    scaleBars.appendChild(bar);
    const lbl = document.createElement('span');
    lbl.textContent = t.name;
    scaleLabels.appendChild(lbl);
  });
}

function updateSidebar(points) {
  const overall = stateScores.reduce((a, b) => a + b, 0) / stateScores.length;
  const idx = Math.min(TIERS.length - 1, Math.max(0, Math.floor(overall / (100 / TIERS.length))));
  const tier = TIERS[idx];

  if (idx !== displayedTier) {
    ratingValue.textContent = tier.name;
    ratingCard.className = 'rating-card tier-' + tier.key;
    Array.from(scaleBars.children).forEach((bar, i) => {
      bar.classList.toggle('on', i <= idx);
    });
    Array.from(scaleLabels.children).forEach((lbl, i) => {
      lbl.classList.toggle('active', i === idx);
    });
    displayedTier = idx;
  }

  const liNodes = pointsList.children;
  const expectedRows = points.length + 1;
  if (liNodes.length !== expectedRows) {
    pointsList.innerHTML = '';
    const intro = document.createElement('li');
    intro.style.borderTop = 'none';
    intro.innerHTML = `<div style="flex:1"><div class="label" id="tierDesc"></div><div class="score" id="compositeScore"></div></div>`;
    pointsList.appendChild(intro);
    points.forEach((p, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="num">${i + 1}</div>
        <div style="flex:1">
          <div class="label">${p.label}</div>
          <div class="score" data-score="${i}"></div>
        </div>
      `;
      pointsList.appendChild(li);
    });
  }

  document.getElementById('tierDesc').textContent = tier.desc;
  document.getElementById('compositeScore').textContent = `Composite: ${Math.round(overall)} / 100`;
  points.forEach((p, i) => {
    const el = pointsList.querySelector(`[data-score="${i}"]`);
    if (el) el.textContent = `${p.score} / 100 · ${verdictFor(p.score)}`;
  });
}

function verdictFor(s) {
  if (s < 30) return 'cooked';
  if (s < 50) return 'needs work';
  if (s < 70) return 'solid';
  if (s < 85) return 'mogger';
  return 'elite';
}
