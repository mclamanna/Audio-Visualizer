// ====================== js/audioEngine3.js ======================
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
let exportEndTime = 0;
let exportDuration = 0;

const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progressContainer');

// ====================== SETTINGS ======================
let rotationSpeed = 0.0025;
let trail = 0.92;
let bars = 240;
let fftSize = 2048;

let barColor = '#ec4899';
let centerColor = '#e0f2fe';
let centerSize = 0.48;
let innerRadius = 0.65;

let layers = 3;
let layerSpread = 0.12;
let glowIntensity = 1.8;

let smoothedBass = 0;

// ====================== CANVAS RESIZE ======================
function resizeCanvas() {
  const container = canvas.parentElement;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(container.clientWidth * dpr);
  canvas.height = Math.floor(container.clientHeight * dpr);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ====================== DETERMINISTIC DRAW (No more drift) ======================
function draw(targetCanvas, targetCtx, audioTime = null) {
  if (!analyser) return;
  analyser.getByteFrequencyData(dataArray);

  const w = targetCanvas.width;
  const h = targetCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const baseRadius = Math.min(cx, cy) * 0.18;

  targetCtx.fillStyle = `rgba(0, 0, 0, ${1 - trail})`;
  targetCtx.fillRect(0, 0, w, h);

  // Enhanced bass
  let rawBass = 0;
  for (let i = 0; i < 48; i++) rawBass += dataArray[i];
  rawBass = rawBass / (48 * 255);

  smoothedBass = Math.max(rawBass, smoothedBass * 0.85) * 0.7 + rawBass * 0.3;
  const bass = Math.pow(smoothedBass, 1.18);

  const pulse = baseRadius + bass * 135;

  // === KEY FIX: Rotation based on absolute audio time ===
  const currentAudioTime = audioTime !== null ? audioTime : (audioCtx ? audioCtx.currentTime - exportStartTime : 0);
  const rotation = (currentAudioTime * rotationSpeed * 60) + (bass * 0.8); // 60 = approx rAF rate

  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";

  const activeBars = (isExporting ? Math.min(bars, 200) : bars);

  for (let layer = 0; layer < layers; layer++) {
    const offset = (layer - (layers - 1) / 2) * layerSpread * pulse;
    const alphaMult = Math.pow(0.85, layer);
    const blurMult = 1 + layer * 0.6;

    targetCtx.shadowColor = barColor;
    targetCtx.shadowBlur = 18 * glowIntensity * blurMult;

    targetCtx.beginPath();

    for (let i = 0; i < activeBars; i++) {
      const angle = (i / activeBars) * Math.PI * 2 + rotation;
      const freqIndex = Math.floor((i / activeBars) * (dataArray.length * 0.72));
      const amp = (dataArray[freqIndex] || 0) / 255;

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
  targetCtx.shadowBlur = 0;

  // Center glow
  targetCtx.shadowBlur = 70 * glowIntensity;
  targetCtx.shadowColor = centerColor;
  targetCtx.fillStyle = `rgba(255,255,255,${0.75 + bass * 0.65})`;
  
  const finalCenterRadius = pulse * centerSize;
  if (finalCenterRadius > 2) {
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
      resizeCanvas();
    } catch (err) {
      status.textContent = '❌ Decode error';
      console.error(err);
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
  analyser.smoothingTimeConstant = 0.74;
  analyser.minDecibels = -92;
  analyser.maxDecibels = -28;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  source.connect(analyser).connect(audioCtx.destination);
  source.onended = () => { if (!isExporting) stopEverything(); };

  source.start();
  isPlaying = true;
  document.getElementById('playButton').textContent = '❚❚ Pause';
  smoothedBass = 0;
  animate();
});

document.getElementById('stopButton').addEventListener('click', stopEverything);

// ====================== CAPTURE ======================
document.getElementById('captureCurrent').addEventListener('click', () => {
  if (!analyser) return alert("Play audio first!");
  const [targetW, targetH] = document.getElementById('videoResolution').value.split('x').map(Number);

  const capCanvas = document.createElement('canvas');
  capCanvas.width = targetW; capCanvas.height = targetH;
  const capCtx = capCanvas.getContext('2d');
  draw(capCanvas, capCtx);
  
  const link = document.createElement('a');
  link.download = `radial-frame-${targetW}x${targetH}.png`;
  link.href = capCanvas.toDataURL('image/png', 1.0);
  link.click();
});

// ====================== VIDEO EXPORT ======================
document.getElementById('startExport').addEventListener('click', async () => {
  if (!audioBuffer || isExporting) return;

  isExporting = true;
  recordedChunks = [];
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
  analyser.smoothingTimeConstant = 0.74;
  analyser.minDecibels = -92;
  analyser.maxDecibels = -28;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  const dest = audioCtx.createMediaStreamDestination();
  source.connect(analyser).connect(dest);
  if (dest.stream.getAudioTracks().length > 0) {
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  exportDuration = audioBuffer.duration;
  exportStartTime = audioCtx.currentTime;
  exportEndTime = exportStartTime + exportDuration + 0.3;

  const bitrate = quality === 'ultra' ? 35e6 : quality === 'high' ? 20e6 : quality === 'premium' ? 15e6 : 10e6;

  let mimeType = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp9,opus';

  mediaRecorder = new MediaRecorder(stream, { 
    mimeType, 
    videoBitsPerSecond: bitrate, 
    audioBitsPerSecond: 320000 
  });

  mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
  mediaRecorder.onstop = finalizeExport;

  mediaRecorder.start(250);
  source.start(0);

  document.getElementById('startExport').style.display = 'none';
  document.getElementById('stopExport').style.display = 'block';
  document.getElementById('exportStatus').textContent = `Exporting ${w}×${h}...`;

  smoothedBass = 0;
  animate();
});

function finalizeExport() {
  const isMp4 = mediaRecorder?.mimeType.includes('mp4') || false;
  const blob = new Blob(recordedChunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `radial-visualizer-${Date.now()}.${isMp4 ? 'mp4' : 'webm'}`;
  a.click();
  URL.revokeObjectURL(url);

  document.getElementById('exportStatus').textContent = '✅ Export Complete!';
  setTimeout(resetUI, 1500);
}

// ====================== STOP ======================
function stopCurrentSource() {
  if (source) { try { source.stop(); } catch(e) {} source = null; }
}

function stopEverything() {
  isPlaying = false;
  isExporting = false;
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  stopCurrentSource();
  document.getElementById('playButton').textContent = '▶ Play';
  resetUI();
}

function resetUI() {
  document.getElementById('startExport').style.display = 'block';
  document.getElementById('stopExport').style.display = 'none';
  progressContainer.style.display = 'none';
  progressBar.style.width = '0%';
}

document.getElementById('stopExport').addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  stopEverything();
  document.getElementById('exportStatus').textContent = 'Export cancelled';
});

// ====================== SETTINGS ======================
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

  // Update displayed values...
  document.getElementById('rotValue').textContent = rotationSpeed.toFixed(4);
  document.getElementById('trailValue').textContent = trail.toFixed(2);
  document.getElementById('barsValue').textContent = bars;
  document.getElementById('centerSizeValue').textContent = centerSize.toFixed(2);
  document.getElementById('innerRadiusValue').textContent = innerRadius.toFixed(2);
  document.getElementById('layersValue').textContent = layers;
  document.getElementById('layerSpreadValue').textContent = layerSpread.toFixed(2);
  document.getElementById('glowIntensityValue').textContent = glowIntensity.toFixed(1);
}

// ====================== ANIMATION ======================
function animate() {
  if (!isPlaying && !isExporting) return;
  requestAnimationFrame(animate);

  if (isExporting && exportCtx) {
    const audioTime = audioCtx.currentTime - exportStartTime;
    draw(exportCanvas, exportCtx, audioTime);
    ctx.drawImage(exportCanvas, 0, 0, canvas.width, canvas.height);

    const progress = Math.min((audioTime / exportDuration) * 100, 100);
    progressBar.style.width = `${progress}%`;
    document.getElementById('exportStatus').textContent = `Exporting ${Math.floor(progress)}%`;

    if (audioCtx.currentTime >= exportEndTime) {
      if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
      return;
    }
  } 
  else if (isPlaying) {
    draw(canvas, ctx);
  }
}

// Attach listeners
['rotSpeed','trail','bars','fftSize','barColor','centerColor','centerSize','innerRadius','layers','layerSpread','glowIntensity']
  .forEach(id => document.getElementById(id).addEventListener('input', updateSettings));

updateSettings();