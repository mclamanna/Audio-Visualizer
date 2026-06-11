// js/audioEngine3.js
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: true });

let audioCtx = null;
let audioBuffer = null;
let source = null;
let analyser = null;
let dataArray = null;

let isPlaying = false;
let isExporting = false;
let mediaRecorder = null;
let recordedChunks = [];
let exportCanvas = null;
let exportCtx = null;
let exportStartTime = 0;

const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progressContainer');

// ====================== CUSTOMIZABLE SETTINGS ======================
let rotation = 0;
let rotationSpeed = 0.0025;
let trail = 0.92;
let bars = 240;
let fftSize = 2048;

let barColor = '#ec4899';
let centerColor = '#e0f2fe';
let centerSize = 0.48;
let innerRadius = 0.65;

// Layering & Depth
let layers = 3;
let layerSpread = 0.12;
let glowIntensity = 1.8;

// ====================== DRAW FUNCTION ======================
function draw(targetCanvas, targetCtx) {
  if (!analyser) return;
  analyser.getByteFrequencyData(dataArray);

  targetCtx.fillStyle = `rgba(0, 0, 0, ${1 - trail})`;
  targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

  const cx = targetCanvas.width / 2;
  const cy = targetCanvas.height / 2;
  const baseRadius = Math.min(cx, cy) * 0.18;

  let bass = 0;
  for (let i = 0; i < 40; i++) bass += dataArray[i];
  bass = bass / 40 / 255;

  const pulse = baseRadius + bass * 120;
  rotation += rotationSpeed + bass * 0.022;

  for (let layer = 0; layer < layers; layer++) {
    const offset = (layer - (layers - 1) / 2) * layerSpread * pulse;
    const alphaMult = Math.pow(0.85, layer);
    const blurMult = 1 + layer * 0.6;

    targetCtx.shadowColor = barColor;
    targetCtx.shadowBlur = 18 * glowIntensity * blurMult;
    targetCtx.lineJoin = "round";

    targetCtx.beginPath();
    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2 + rotation;
      const freqIndex = Math.floor((i / bars) * (dataArray.length * 0.7));
      const amp = dataArray[freqIndex] / 255;

      const length = pulse + amp * Math.min(cx, cy) * 0.92;
      const startRadius = pulse * innerRadius + offset;

      const x1 = cx + Math.cos(angle) * startRadius;
      const y1 = cy + Math.sin(angle) * startRadius;
      const x2 = cx + Math.cos(angle) * length;
      const y2 = cy + Math.sin(angle) * length;

      const alpha = Math.pow(amp, 0.55) * 0.95 * alphaMult;

      targetCtx.strokeStyle = barColor;
      targetCtx.lineWidth = (2.8 + amp * 9) * (1 - layer * 0.15);
      targetCtx.globalAlpha = alpha;

      targetCtx.moveTo(x1, y1);
      targetCtx.lineTo(x2, y2);
    }
    targetCtx.stroke();
  }

  targetCtx.globalAlpha = 1.0;

  // Center Glow
  targetCtx.shadowBlur = 70 * glowIntensity;
  targetCtx.shadowColor = centerColor;
  targetCtx.fillStyle = `rgba(255,255,255,${0.75 + bass * 0.55})`;
  const finalCenterRadius = pulse * centerSize;
  if (finalCenterRadius > 3) {
    targetCtx.beginPath();
    targetCtx.arc(cx, cy, finalCenterRadius, 0, Math.PI * 2);
    targetCtx.fill();
  }
  targetCtx.shadowBlur = 0;
}

// ====================== AUDIO LOADING ======================
document.getElementById('audioFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const status = document.getElementById('exportStatus');
  status.textContent = `Decoding ${file.name}...`;

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      audioBuffer = await audioCtx.decodeAudioData(ev.target.result);
      document.getElementById('playButton').disabled = false;
      document.getElementById('startExport').disabled = false;
      document.getElementById('captureCurrent').disabled = false;
      document.getElementById('capture30s').disabled = false;
      status.textContent = `Ready: ${file.name}`;
    } catch (err) {
      status.textContent = '❌ Decode error';
    }
  };
  reader.readAsArrayBuffer(file);
});

// ====================== PLAY / STOP ======================
document.getElementById('playButton').addEventListener('click', () => {
  if (!audioBuffer || isExporting) return;
  stopCurrentSource();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = fftSize;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  source.connect(analyser).connect(audioCtx.destination);
  source.onended = () => { if (!isExporting) stopEverything(); };

  source.start();
  isPlaying = true;
  document.getElementById('playButton').textContent = '❚❚ Pause';
  animate();
});

document.getElementById('stopButton').addEventListener('click', stopEverything);

// ====================== HIGH-RES CAPTURE CURRENT FRAME ======================
document.getElementById('captureCurrent').addEventListener('click', () => {
  if (!analyser) {
    alert("Play audio first to capture a frame!");
    return;
  }
  const [targetW, targetH] = document.getElementById('videoResolution').value.split('x').map(Number);

  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = targetW;
  captureCanvas.height = targetH;
  const captureCtx = captureCanvas.getContext('2d', { alpha: true });

  draw(captureCanvas, captureCtx);

  const link = document.createElement('a');
  link.download = `radial-frame-${targetW}x${targetH}.png`;
  link.href = captureCanvas.toDataURL('image/png', 1.0);
  link.click();
});

// ====================== HIGH-RES 30s THUMBNAIL ======================
document.getElementById('capture30s').addEventListener('click', () => {
  if (!audioBuffer) return;
  const [targetW, targetH] = document.getElementById('videoResolution').value.split('x').map(Number);

  const tempSource = audioCtx.createBufferSource();
  tempSource.buffer = audioBuffer;
  const tempAnalyser = audioCtx.createAnalyser();
  tempAnalyser.fftSize = fftSize;
  tempSource.connect(tempAnalyser);
  tempSource.start(0, 30);

  setTimeout(() => {
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = targetW;
    captureCanvas.height = targetH;
    const captureCtx = captureCanvas.getContext('2d', { alpha: true });
    draw(captureCanvas, captureCtx);

    const link = document.createElement('a');
    link.download = `radial-30s-${targetW}x${targetH}.png`;
    link.href = captureCanvas.toDataURL('image/png', 1.0);
    link.click();
  }, 120);
});

// ====================== VIDEO EXPORT ======================
document.getElementById('startExport').addEventListener('click', async () => {
  if (!audioBuffer || isExporting) return;

  isExporting = true;
  recordedChunks = [];
  exportStartTime = audioCtx.currentTime;

  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';

  const [w, h] = document.getElementById('videoResolution').value.split('x').map(Number);
  const quality = document.getElementById('videoQuality').value;

  exportCanvas = document.createElement('canvas');
  exportCanvas.width = w;
  exportCanvas.height = h;
  exportCtx = exportCanvas.getContext('2d', { alpha: false });

  const stream = exportCanvas.captureStream(60);

  stopCurrentSource();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = fftSize;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  const dest = audioCtx.createMediaStreamDestination();
  source.connect(analyser).connect(dest);
  if (dest.stream.getAudioTracks().length > 0) {
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  // ✅ FIXED: Auto-stop recorder when audio ends
  source.onended = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  };

  const bitrate = quality === 'ultra' ? 35e6 : quality === 'high' ? 20e6 : quality === 'premium' ? 15e6 : 10e6;
  let mimeType = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp9';

  mediaRecorder = new MediaRecorder(stream, { 
    mimeType, 
    videoBitsPerSecond: bitrate, 
    audioBitsPerSecond: 320000 
  });

  mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
  mediaRecorder.onstop = finalizeExport;

  mediaRecorder.start(250);
  source.start(0); // start from beginning

  document.getElementById('startExport').style.display = 'none';
  document.getElementById('stopExport').style.display = 'block';
  document.getElementById('exportStatus').textContent = `Exporting ${w}×${h}...`;

  animate();
});

function finalizeExport() {
  const isMp4 = mediaRecorder.mimeType.includes('mp4');
  const blob = new Blob(recordedChunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `radial-explosion-${Date.now()}.${isMp4 ? 'mp4' : 'webm'}`;
  a.click();
  URL.revokeObjectURL(url);

  document.getElementById('exportStatus').textContent = '✅ Export complete!';
  resetUI();
}

document.getElementById('stopExport').addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  stopEverything();
});

function stopCurrentSource() {
  if (source) { 
    try { source.stop(); } catch(e){}
    source = null; 
  }
}

function stopEverything() {
  isPlaying = false;
  isExporting = false;
  stopCurrentSource();
  document.getElementById('playButton').textContent = '▶ Play';
  resetUI();
}

function resetUI() {
  document.getElementById('startExport').style.display = 'block';
  document.getElementById('stopExport').style.display = 'none';
  progressContainer.style.display = 'none';
}

// ====================== REAL-TIME CONTROLS ======================
function updateSettings() {
  rotationSpeed = parseFloat(document.getElementById('rotSpeed').value);
  trail = parseFloat(document.getElementById('trail').value);
  bars = parseInt(document.getElementById('bars').value);
  fftSize = parseInt(document.getElementById('fftSize').value);
  barColor = document.getElementById('barColor').value;
  centerColor = document.getElementById('centerColor').value;
  centerSize = parseFloat(document.getElementById('centerSize').value);
  innerRadius = parseFloat(document.getElementById('innerRadius').value);
  
  layers = parseInt(document.getElementById('layers').value);
  layerSpread = parseFloat(document.getElementById('layerSpread').value);
  glowIntensity = parseFloat(document.getElementById('glowIntensity').value);

  document.getElementById('rotValue').textContent = rotationSpeed.toFixed(4);
  document.getElementById('trailValue').textContent = trail.toFixed(2);
  document.getElementById('barsValue').textContent = bars;
  document.getElementById('centerSizeValue').textContent = centerSize.toFixed(2);
  document.getElementById('innerRadiusValue').textContent = innerRadius.toFixed(2);
}

// ====================== ANIMATION ======================
function animate() {
  if (!isPlaying && !isExporting) return;
  requestAnimationFrame(animate);

  if (isExporting && exportCtx) {
    draw(exportCanvas, exportCtx);
    ctx.drawImage(exportCanvas, 0, 0, canvas.width, canvas.height);

    const elapsed = audioCtx.currentTime - exportStartTime;
    const progress = Math.min((elapsed / audioBuffer.duration) * 100, 100);
    progressBar.style.width = `${progress}%`;
    document.getElementById('exportStatus').textContent = `Exporting ${Math.floor(progress)}%`;
  } else if (isPlaying) {
    draw(canvas, ctx);
  }
}

// Attach listeners
['rotSpeed','trail','bars','fftSize','barColor','centerColor','centerSize','innerRadius','layers','layerSpread','glowIntensity']
  .forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateSettings);
  });

updateSettings();