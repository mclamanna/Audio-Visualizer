// js/audioEngine3.js
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

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: true });

let rotation = 0;
const bars = 240;
const fftSize = 4096;
let trail = 0.92;           // Slightly higher = smoother trails

// ====================== RESIZE ======================
function resizeCanvas() {
  const maxW = Math.min(window.innerWidth * 0.95, 1280);
  const maxH = Math.min(window.innerHeight - 300, 720);
  canvas.width = maxW;
  canvas.height = maxH;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ====================== DRAW (Clean & Fast) ======================
function draw(targetCanvas, targetCtx) {
  if (!analyser) return;
  analyser.getByteFrequencyData(dataArray);

  const w = targetCanvas.width;
  const h = targetCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const baseRadius = Math.min(cx, cy) * 0.18;

  // Background fade
  targetCtx.fillStyle = `rgba(0, 0, 0, ${1 - trail})`;
  targetCtx.fillRect(0, 0, w, h);

  let bass = 0;
  for (let i = 0; i < 48; i++) bass += dataArray[i];
  bass = bass / 48 / 255;

  const pulse = baseRadius + bass * 135;
  rotation += 0.004 + bass * 0.028;

  // Bars
  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2 + rotation;
    const freqIndex = Math.floor((i / bars) * (dataArray.length * 0.68));
    let amp = dataArray[freqIndex] / 255;

    const inner = pulse * 0.72;
    const outer = pulse + amp * Math.min(cx, cy) * 0.95;

    const x1 = cx + Math.cos(angle) * inner;
    const y1 = cy + Math.sin(angle) * inner;
    const x2 = cx + Math.cos(angle) * outer;
    const y2 = cy + Math.sin(angle) * outer;

    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.moveTo(x1, y1);
    targetCtx.lineTo(x2, y2);

    const alpha = Math.pow(amp, 0.45) * 0.98;
    targetCtx.strokeStyle = `rgba(240, 245, 255, ${alpha})`;
    targetCtx.lineWidth = 2.4 + amp * 11;
    targetCtx.lineCap = "round";

    targetCtx.shadowColor = amp > 0.65 ? '#a5b4fc' : '#c4d0ff';
    targetCtx.shadowBlur = amp > 0.6 ? 48 : 22;
    targetCtx.stroke();
    targetCtx.restore();
  }

  // Center Orb
  targetCtx.shadowBlur = 110;
  targetCtx.shadowColor = '#e0e7ff';
  targetCtx.fillStyle = `rgba(255,255,255,${0.9 + bass * 0.4})`;
  targetCtx.beginPath();
  targetCtx.arc(cx, cy, pulse * 0.52, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.shadowBlur = 0;
}

// ====================== AUDIO SETUP ======================
document.getElementById('audioFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  document.getElementById('exportStatus').textContent = `Loading ${file.name}...`;

  const reader = new FileReader();
  reader.onload = async ev => {
    audioBuffer = await audioCtx.decodeAudioData(ev.target.result);
    
    document.getElementById('playButton').disabled = false;
    document.getElementById('startExport').disabled = false;
    document.getElementById('captureCurrent').disabled = false;
    document.getElementById('capture30s').disabled = false;
    
    document.getElementById('exportStatus').textContent = `Loaded: ${file.name} (${audioBuffer.duration.toFixed(1)}s)`;
  };
  reader.readAsArrayBuffer(file);
});

// ====================== PLAYBACK ======================
document.getElementById('playButton').addEventListener('click', () => {
  if (!audioBuffer || isExporting) return;
  stopEverything();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = fftSize;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  source.connect(analyser).connect(audioCtx.destination);
  source.onended = () => stopEverything();

  source.start();
  isPlaying = true;
  requestAnimationFrame(animate);
});

document.getElementById('stopButton').addEventListener('click', stopEverything);

// ====================== PNG CAPTURE ======================
function capturePNG(filename = "radial") {
  const [width, height] = document.getElementById('videoResolution').value.split('x').map(Number);
  const temp = document.createElement('canvas');
  temp.width = width;
  temp.height = height;
  const tCtx = temp.getContext('2d', { alpha: false });
  
  draw(temp, tCtx);

  const link = document.createElement('a');
  link.download = `${filename}-${Date.now()}.png`;
  link.href = temp.toDataURL('image/png', 1.0);
  link.click();
}

document.getElementById('captureCurrent').addEventListener('click', () => capturePNG("radial-current"));
document.getElementById('capture30s').addEventListener('click', capture30sThumbnail);

// Better 30s thumbnail
async function capture30sThumbnail() {
  if (!audioBuffer) return;
  const status = document.getElementById('exportStatus');
  status.textContent = "Rendering 30s thumbnail...";

  const tempSource = audioCtx.createBufferSource();
  tempSource.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = fftSize;
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  tempSource.connect(analyser);

  const seek = Math.min(30, audioBuffer.duration * 0.6);
  const originalRot = rotation;
  rotation = seek * 2.1;

  // Simulate time
  for (let i = 0; i < 18; i++) {
    analyser.getByteFrequencyData(dataArray);
    rotation += 0.04;
    await new Promise(r => setTimeout(r, 16));
  }

  capturePNG("radial-30s");
  rotation = originalRot;
  status.textContent = "✅ 30s thumbnail saved";
}

// ====================== VIDEO EXPORT ======================
document.getElementById('startExport').addEventListener('click', startExport);

async function startExport() {
  if (!audioBuffer || isExporting) return;

  isExporting = true;
  recordedChunks = [];

  document.getElementById('startExport').style.display = 'none';
  document.getElementById('stopExport').style.display = 'block';
  document.getElementById('progressContainer').style.display = 'block';
  document.getElementById('exportStatus').textContent = 'Preparing export...';

  const [width, height] = document.getElementById('videoResolution').value.split('x').map(Number);
  const quality = document.getElementById('videoQuality').value;

  // Create export canvas
  exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  exportCtx = exportCanvas.getContext('2d', { alpha: false });

  const stream = exportCanvas.captureStream(60);

  // Audio
  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = fftSize;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  const dest = audioCtx.createMediaStreamDestination();
  source.connect(analyser).connect(dest);
  if (dest.stream.getAudioTracks().length) {
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  // Quality settings
  const bitrates = { ultra: 52000000, high: 28000000, premium: 18000000, standard: 12000000 };
  const bitrate = bitrates[quality] || 18000000;

  let mimeType = 'video/mp4;codecs=avc1.640028';
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp9';

  mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
    audioBitsPerSecond: 384000
  });

  mediaRecorder.ondataavailable = e => recordedChunks.push(e.data);
  mediaRecorder.onstop = finalizeExport;

  mediaRecorder.start(250);
  source.start();

  const startTime = audioCtx.currentTime;
  source.onended = () => mediaRecorder.stop();

  // Animation loop for export
  function exportLoop() {
    if (!isExporting) return;
    requestAnimationFrame(exportLoop);

    draw(exportCanvas, exportCtx);

    // Mirror to preview
    ctx.drawImage(exportCanvas, 0, 0, canvas.width, canvas.height);

    const progress = Math.min(((audioCtx.currentTime - startTime) / audioBuffer.duration) * 100, 100);
    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('exportStatus').textContent = `Exporting ${Math.floor(progress)}%`;
  }

  exportLoop();
}

function finalizeExport() {
  const ext = mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(recordedChunks, { type: `video/${ext}` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `radial-explosion-${Date.now()}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);

  document.getElementById('exportStatus').textContent = '✅ Export finished!';
  stopEverything();
}

document.getElementById('stopExport').addEventListener('click', () => {
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  stopEverything();
});

function stopEverything() {
  isPlaying = false;
  isExporting = false;
  if (source) {
    try { source.stop(); } catch(e){}
    source = null;
  }
  resetUI();
}

function resetUI() {
  document.getElementById('startExport').style.display = 'block';
  document.getElementById('stopExport').style.display = 'none';
  document.getElementById('progressContainer').style.display = 'none';
}

// Shared animation loop
function animate() {
  if (!isPlaying && !isExporting) return;
  requestAnimationFrame(animate);

  if (isPlaying && !isExporting) {
    draw(canvas, ctx);
  }
}