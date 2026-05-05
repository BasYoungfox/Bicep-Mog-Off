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

const camStage   = document.getElementById('camStage');
const video      = document.getElementById('video');
const camHud     = document.getElementById('camHud');
const camOverlay = document.getElementById('camOverlay');
const countdown  = document.getElementById('countdown');
const startCam   = document.getElementById('startCam');
const captureBtn = document.getElementById('captureBtn');
const flipBtn    = document.getElementById('flipBtn');
const resetBtn   = document.getElementById('resetBtn');
const hint       = document.getElementById('hint');

const analysisEl  = document.getElementById('analysis');
const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d', { willReadFrequently: true });
const canvasLoading = document.getElementById('canvasLoading');
const loadingText = document.getElementById('loadingText');
const ratingCard  = document.getElementById('ratingCard');
const ratingValue = document.getElementById('ratingValue');
const scaleBars   = document.getElementById('scaleBars');
const scaleLabels = document.getElementById('scaleLabels');
const pointsList  = document.getElementById('pointsList');

let stream = null;
let facingMode = 'user';
let capturedImage = null;
let poseLandmarker = null;
let posePromise = null;

startCam.addEventListener('click', () => {
  startCamera();
  loadPose();
});
flipBtn.addEventListener('click', () => {
  facingMode = facingMode === 'user' ? 'environment' : 'user';
  startCamera();
});
captureBtn.addEventListener('click', () => runCountdownAndCapture());
resetBtn.addEventListener('click', () => resetAll());

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showCamError('Camera API not available in this browser.');
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
    camStage.classList.add('live');
    camStage.classList.remove('error');
    camHud.style.display = 'flex';
    startCam.style.display = 'none';
    captureBtn.style.display = 'inline-block';
    flipBtn.style.display = 'inline-block';
    hint.textContent = 'When you\'re ready, hit Capture & Rate. 3-second timer gives you time to pose.';
  } catch (err) {
    showCamError(err.name === 'NotAllowedError'
      ? 'Camera blocked. Allow camera access in your browser to continue.'
      : 'Couldn\'t start camera: ' + err.message);
  }
}

function showCamError(msg) {
  camStage.classList.add('error');
  camStage.classList.remove('live');
  camOverlay.querySelector('strong').textContent = msg;
  camOverlay.querySelector('p').textContent = 'Try again, or check your browser camera permissions.';
  camHud.style.display = 'none';
}

function runCountdownAndCapture() {
  let n = 3;
  countdown.style.display = 'flex';
  countdown.textContent = n;
  captureBtn.disabled = true;
  flipBtn.disabled = true;
  const timer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      countdown.textContent = n;
      countdown.animate(
        [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
        { duration: 220, easing: 'ease-out' }
      );
    } else {
      clearInterval(timer);
      countdown.textContent = 'FLEX';
      setTimeout(() => {
        countdown.style.display = 'none';
        captureBtn.disabled = false;
        flipBtn.disabled = false;
        capture();
      }, 350);
    }
  }, 800);
}

function capture() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d');
  octx.translate(w, 0);
  octx.scale(-1, 1);
  octx.drawImage(video, 0, 0, w, h);

  const img = new Image();
  img.onload = () => {
    capturedImage = img;
    stopCamera();
    analysisEl.style.display = 'grid';
    resetBtn.style.display = 'inline-block';
    captureBtn.style.display = 'none';
    flipBtn.style.display = 'none';
    drawAnalysis(img);
    analysisEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  img.src = off.toDataURL('image/jpeg', 0.92);
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  camStage.classList.remove('live');
  camHud.style.display = 'none';
}

function resetAll() {
  capturedImage = null;
  analysisEl.style.display = 'none';
  resetBtn.style.display = 'none';
  startCam.style.display = 'inline-block';
  camOverlay.querySelector('strong').textContent = 'Camera off';
  camOverlay.querySelector('p').textContent = 'Allow camera access, get in frame, hit the pose.';
  camStage.classList.remove('error');
  hint.textContent = 'Tip: good lighting, arm at chest height, palm forward.';
}

window.addEventListener('beforeunload', stopCamera);

async function loadPose() {
  if (poseLandmarker) return poseLandmarker;
  if (posePromise) return posePromise;
  posePromise = (async () => {
    const vision = await import(MP_MODULE);
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
    try {
      poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
        runningMode: 'IMAGE',
        numPoses: 1,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4
      });
    } catch {
      poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 1
      });
    }
    return poseLandmarker;
  })();
  return posePromise;
}

async function drawAnalysis(img) {
  const maxW = 720;
  const ratio = img.width > maxW ? maxW / img.width : 1;
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);

  canvasLoading.style.display = 'flex';
  loadingText.textContent = poseLandmarker ? 'Detecting your arm…' : 'Loading pose model…';
  ratingValue.textContent = '…';
  scaleBars.innerHTML = '';
  scaleLabels.innerHTML = '';
  pointsList.innerHTML = '';

  let detector;
  try {
    detector = await loadPose();
  } catch (err) {
    canvasLoading.style.display = 'none';
    renderNoArm('Couldn\'t load the pose detector. Check your connection and try again.');
    return;
  }

  loadingText.textContent = 'Detecting your arm…';
  await new Promise(r => requestAnimationFrame(r));

  let result;
  try {
    result = detector.detect(canvas);
  } catch (err) {
    canvasLoading.style.display = 'none';
    renderNoArm('Detection failed. Try retaking the photo.');
    return;
  }

  canvasLoading.style.display = 'none';

  if (!result.landmarks || result.landmarks.length === 0) {
    renderNoArm('Couldn\'t see a person in frame. Make sure your shoulder, elbow, and wrist are all visible.');
    return;
  }

  const arm = pickFlexedArm(result.landmarks[0]);
  if (!arm) {
    renderNoArm('Couldn\'t lock onto your arm. Get your shoulder, elbow, and wrist all in the shot, with good light.');
    return;
  }

  const points = placePointsOnArm(arm, w, h);
  const scores = scorePoints(points, arm, w, h);
  points.forEach((p, i) => p.score = scores[i]);
  const overall = scores.reduce((a, b) => a + b, 0) / scores.length;

  drawOverlay(points);
  renderRating(overall, points);
}

function pickFlexedArm(lm) {
  const left  = { s: lm[11], e: lm[13], w: lm[15], side: 'left'  };
  const right = { s: lm[12], e: lm[14], w: lm[16], side: 'right' };

  function rate(arm) {
    const v = (arm.s.visibility + arm.e.visibility + arm.w.visibility) / 3;
    if (v < 0.45) return -Infinity;
    const angle = elbowAngle(arm.s, arm.e, arm.w);
    return v * 100 + (180 - angle);
  }

  const lr = rate(left);
  const rr = rate(right);
  if (lr === -Infinity && rr === -Infinity) return null;
  const winner = lr >= rr ? left : right;
  winner.elbowAngle = elbowAngle(winner.s, winner.e, winner.w);
  return winner;
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
  const radius = Math.max(10, upperLen * 0.10);

  const baseStds = points.map(p => sampleStd(p.x, p.y, radius));
  const globalAvg = baseStds.reduce((a, b) => a + b, 0) / baseStds.length;

  const flexBonus = Math.max(0, (180 - arm.elbowAngle)) * 0.25;

  const forearmLen = Math.hypot((arm.w.x - arm.e.x) * w, (arm.w.y - arm.e.y) * h);
  const insertionRatio = forearmLen / Math.max(1, upperLen);
  const insertionScore = Math.min(95, 35 + insertionRatio * 35);

  return points.map((p, i) => {
    const local = baseStds[i];
    let s = 25 + local * 1.6;
    if (i === 0) s += flexBonus * 0.6;
    if (i === 4) s = (s + insertionScore) / 2;
    s += (local - globalAvg) * 0.6;
    return Math.round(Math.max(12, Math.min(98, s)));
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
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    sum += lum; sumSq += lum * lum; n++;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return Math.sqrt(variance);
}

function drawOverlay(points) {
  const w = canvas.width, h = canvas.height;
  ctx.drawImage(capturedImage, 0, 0, w, h);

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

function renderRating(overall, points) {
  const idx = Math.min(TIERS.length - 1, Math.max(0, Math.floor(overall / (100 / TIERS.length))));
  const tier = TIERS[idx];

  ratingValue.textContent = tier.name;
  ratingCard.className = 'rating-card tier-' + tier.key;

  scaleBars.innerHTML = '';
  scaleLabels.innerHTML = '';
  TIERS.forEach((t, i) => {
    const bar = document.createElement('div');
    bar.className = 'step' + (i <= idx ? ' on' : '');
    scaleBars.appendChild(bar);
    const lbl = document.createElement('span');
    lbl.textContent = t.name;
    if (i === idx) lbl.className = 'active';
    scaleLabels.appendChild(lbl);
  });

  pointsList.innerHTML = '';
  const intro = document.createElement('li');
  intro.innerHTML = `<div style="flex:1"><div class="label">${tier.desc}</div><div class="score">Composite score: ${Math.round(overall)} / 100</div></div>`;
  intro.style.borderTop = 'none';
  pointsList.appendChild(intro);

  points.forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="num">${i + 1}</div>
      <div style="flex:1">
        <div class="label">${p.label}</div>
        <div class="score">${p.score} / 100 · ${verdictFor(p.score)}</div>
      </div>
    `;
    pointsList.appendChild(li);
  });
}

function renderNoArm(msg) {
  ratingValue.textContent = '—';
  scaleBars.innerHTML = '';
  scaleLabels.innerHTML = '';
  pointsList.innerHTML = `
    <li class="error-state" style="border-top:none">
      <div style="flex:1">
        <strong>No arm detected</strong>
        ${msg}
      </div>
    </li>`;
  ctx.drawImage(capturedImage, 0, 0, canvas.width, canvas.height);
}

function verdictFor(s) {
  if (s < 30) return 'cooked';
  if (s < 50) return 'needs work';
  if (s < 70) return 'solid';
  if (s < 85) return 'mogger';
  return 'elite';
}
