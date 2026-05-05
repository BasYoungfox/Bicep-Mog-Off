const TIERS = [
  { key: 'sub3',     name: 'Sub-3',    desc: 'Skin and bone. The arm is still loading.' },
  { key: 'sub5',     name: 'Sub-5',    desc: 'Awareness unlocked. The journey begins.' },
  { key: 'ltn',      name: 'LTN',      desc: 'Low-tier normie. Visible effort, no payoff yet.' },
  { key: 'mtn',      name: 'MTN',      desc: 'Mid-tier normie. Civilian-respectable.' },
  { key: 'htn',      name: 'HTN',      desc: 'High-tier normie. Sleeves are starting to argue.' },
  { key: 'chad',     name: 'CHAD',     desc: 'Genuine arm. People notice in passing.' },
  { key: 'chadlite', name: 'CHADLITE', desc: 'Borderline mythical. Mogs in real time.' }
];

const POINT_TEMPLATES = [
  { label: 'Peak height',             base: 0.25 },
  { label: 'Vein definition',         base: 0.15 },
  { label: 'Belly density',           base: 0.20 },
  { label: 'Bicep–tricep separation', base: 0.15 },
  { label: 'Insertion length',        base: 0.15 },
  { label: 'Skin tightness',          base: 0.10 }
];

const camStage  = document.getElementById('camStage');
const video     = document.getElementById('video');
const camHud    = document.getElementById('camHud');
const camOverlay = document.getElementById('camOverlay');
const countdown = document.getElementById('countdown');
const startCam  = document.getElementById('startCam');
const captureBtn= document.getElementById('captureBtn');
const flipBtn   = document.getElementById('flipBtn');
const resetBtn  = document.getElementById('resetBtn');
const hint      = document.getElementById('hint');

const analysisEl = document.getElementById('analysis');
const canvas     = document.getElementById('canvas');
const ctx        = canvas.getContext('2d');
const ratingCard = document.getElementById('ratingCard');
const ratingValue= document.getElementById('ratingValue');
const scaleBars  = document.getElementById('scaleBars');
const scaleLabels= document.getElementById('scaleLabels');
const pointsList = document.getElementById('pointsList');

let stream = null;
let facingMode = 'user';
let capturedImage = null;

startCam.addEventListener('click', () => startCamera());
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

function drawAnalysis(img) {
  const maxW = 720;
  const ratio = img.width > maxW ? maxW / img.width : 1;
  const w = Math.round(img.width * ratio);
  const h = Math.round(img.height * ratio);
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);

  const pixelScore = computePixelScore(w, h);
  const points = generatePoints(w, h, pixelScore);
  const overall = points.reduce((a, p) => a + p.score, 0) / points.length;

  drawOverlay(points);
  renderRating(overall, points);
}

function computePixelScore(w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  let sum = 0, contrast = 0, prev = 0;
  const step = 4 * 16;
  for (let i = 0; i < data.length; i += step) {
    const lum = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    sum += lum;
    contrast += Math.abs(lum - prev);
    prev = lum;
  }
  const samples = data.length / step;
  const avg = sum / samples;
  const contrastAvg = contrast / samples;
  return Math.min(100, (contrastAvg * 1.4) + (avg > 60 && avg < 200 ? 20 : 5));
}

function generatePoints(w, h, pixelScore) {
  const seed = Math.floor(pixelScore * 1000) + Date.now() % 10000;
  const rand = mulberry32(seed);

  const anchors = [
    { x: 0.42, y: 0.30 },
    { x: 0.55, y: 0.42 },
    { x: 0.50, y: 0.58 },
    { x: 0.38, y: 0.55 },
    { x: 0.62, y: 0.30 },
    { x: 0.48, y: 0.72 }
  ];

  return POINT_TEMPLATES.map((tpl, i) => {
    const drift = pixelScore * 0.5 + (rand() - 0.5) * 30;
    const score = Math.max(10, Math.min(98, drift + (rand() * 25)));
    const a = anchors[i];
    const x = a.x * w + (rand() - 0.5) * w * 0.06;
    const y = a.y * h + (rand() - 0.5) * h * 0.06;
    return { ...tpl, x, y, score: Math.round(score) };
  });
}

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function drawOverlay(points) {
  const w = canvas.width, h = canvas.height;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

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
    const labelOffsetX = p.x < w / 2 ? -90 : 30;
    const labelOffsetY = p.y < h / 2 ? -10 : 20;
    const lx = Math.max(8, Math.min(w - 150, p.x + labelOffsetX));
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

function verdictFor(s) {
  if (s < 30) return 'cooked';
  if (s < 50) return 'needs work';
  if (s < 70) return 'solid';
  if (s < 85) return 'mogger';
  return 'elite';
}
