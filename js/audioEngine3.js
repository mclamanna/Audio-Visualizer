const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioBuffer = null, source = null, analyser = null, dataArray = null;
let isPlaying = false, isExporting = false;
let mediaRecorder = null, recordedChunks = [], exportCanvas = null, exportCtx = null;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: true });

// ====================== CUSTOMIZABLE SETTINGS ======================
let rotation = 0;                    // Current rotation angle
let trail = 0.91;                    // Background fade (0.85 = strong trails, 0.98 = clean/no trails)
const bars = 200;                    // Number of radiating lines (higher = denser, slower)
const fftSize = 2048;                // Audio resolution (higher = more detail, more CPU)

// ====================== UTILITIES ======================
function map(v, iMin, iMax, oMin, oMax) {
  return ((v - iMin) / (iMax - iMin)) * (oMax - oMin) + oMin;
}

// ====================== CANVAS SETUP ======================
function resizeCanvas() {
  canvas.width = Math.min(window.innerWidth * 0.95, 1280);
  canvas.height = Math.min(window.innerHeight - 220, 720);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ====================== MAIN DRAW FUNCTION (VISUALS) ======================
function draw(targetCanvas, targetCtx) {
  analyser.getByteFrequencyData(dataArray);

  // === BACKGROUND FADE (Trail effect) ===
  targetCtx.fillStyle = `rgba(0, 0, 0, ${1 - trail})`;
  targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

  const centerX = targetCanvas.width / 2;
  const centerY = targetCanvas.height / 2;
  const baseRadius = Math.min(centerX, centerY) * 0.18;

  // === BASS DETECTION ===
  let bass = 0;
  for (let i = 0; i < 30; i++) bass += dataArray[i];
  bass = bass / 30 / 255;                    // bass is now 0.0 → 1.0

  const pulse = baseRadius + bass * 110;     // How much the center grows with bass

  // === ROTATION SPEED ===
  rotation += 0.003 + bass * 0.018;          // Base speed + extra when bass hits

  // === RADIATING BURST LINES ===
  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2 + rotation;
    
    // Map visual bar to frequency data
    const freqIndex = Math.floor(i / bars * dataArray.length * 0.65);
    let amp = dataArray[freqIndex] / 255;     // 0.0 → 1.0 amplitude

    // Line length
    const length = pulse + amp * Math.min(centerX, centerY) * 0.95;

    const x1 = centerX + Math.cos(angle) * (pulse * 0.6);
    const y1 = centerY + Math.sin(angle) * (pulse * 0.6);
    const x2 = centerX + Math.cos(angle) * length;
    const y2 = centerY + Math.sin(angle) * length;

    const alpha = Math.pow(amp, 0.6) * 0.95;   // Softer response curve

    // === MAIN LINE COLOR & STYLE ===
    targetCtx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;   // ← Change color here
    targetCtx.lineWidth = 1.8 + amp * 7;
    targetCtx.shadowBlur = 18;
    targetCtx.shadowColor = '#ffffff';         // ← Glow color
    targetCtx.beginPath();
    targetCtx.moveTo(x1, y1);
    targetCtx.lineTo(x2, y2);
    targetCtx.stroke();

    // Extra bright core for strong hits
    if (amp > 0.65) {
      targetCtx.shadowBlur = 45;
      targetCtx.lineWidth = 0.9;
      targetCtx.stroke();
    }
  }

  // === CENTER CORE ===
  targetCtx.shadowBlur = 80;
  targetCtx.fillStyle = `rgba(255,255,255,${0.75 + bass * 0.45})`;  // ← Change center color
  targetCtx.beginPath();
  targetCtx.arc(centerX, centerY, pulse * 0.45, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.shadowBlur = 0;
}

// ====================== AUDIO LOADING ======================
document.getElementById('audioFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById('exportStatus');
  status.textContent = `Loading ${file.name}...`;

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const decodedBuffer = await audioCtx.decodeAudioData(ev.target.result);
      audioBuffer = decodedBuffer;
      document.getElementById('playButton').disabled = false;
      document.getElementById('startExport').disabled = false;
      status.textContent = `✅ Loaded: ${file.name}`;
    } catch (err) {
      status.textContent = '❌ Decode failed (try 16-bit WAV)';
    }
  };
  reader.readAsArrayBuffer(file);
});

// ====================== PLAY / STOP ======================
document.getElementById('playButton').addEventListener('click', () => {
  if (!audioBuffer) return;
  if (source) source.stop();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = fftSize;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  source.connect(analyser).connect(audioCtx.destination);
  source.start();
  isPlaying = true;
  animate();
});

document.getElementById('stopButton').addEventListener('click', stopEverything);

// ====================== EXPORT ======================
document.getElementById('startExport').addEventListener('click', async () => {
  if (!audioBuffer || isExporting) return;

  isExporting = true;
  recordedChunks = [];

  const [width, height] = document.getElementById('videoResolution').value.split('x').map(Number);
  const quality = document.getElementById('videoQuality').value;

  exportCanvas = document.createElement('canvas');
  exportCanvas.width = width;
  exportCanvas.height = height;
  exportCtx = exportCanvas.getContext('2d', { alpha: false });

  const stream = exportCanvas.captureStream(60);

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = fftSize;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  const dest = audioCtx.createMediaStreamDestination();
  source.connect(analyser).connect(dest);
  analyser.connect(audioCtx.destination);
  if (dest.stream.getAudioTracks().length > 0) {
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  const bitrate = quality === 'ultra' ? 28000000 : quality === 'high' ? 18000000 : 10000000;

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    videoBitsPerSecond: bitrate,
    audioBitsPerSecond: 320000
  });

  mediaRecorder.ondataavailable = e => e.data?.size && recordedChunks.push(e.data);
  mediaRecorder.onstop = finalizeExport;

  mediaRecorder.start(250);
  source.start();

  document.getElementById('startExport').style.display = 'none';
  document.getElementById('stopExport').style.display = 'inline-block';
  document.getElementById('exportStatus').textContent = `Exporting ${width}×${height}...`;

  animate();
});

function finalizeExport() {
  if (recordedChunks.length === 0) {
    document.getElementById('exportStatus').textContent = '❌ No video data recorded';
  } else {
    const blob = new Blob(recordedChunks, { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `radial-explosion-${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
    document.getElementById('exportStatus').textContent = '✅ Download started!';
  }
  resetUI();
}

document.getElementById('stopExport').addEventListener('click', () => {
  if (!isExporting || !mediaRecorder) return;
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.requestData();
    setTimeout(() => { if (mediaRecorder) mediaRecorder.stop(); }, 200);
  }
  stopEverything();
});

function stopEverything() {
  isPlaying = false;
  isExporting = false;
  if (source) { try { source.stop(); } catch(e){} source = null; }
}

function resetUI() {
  isExporting = false;
  document.getElementById('startExport').style.display = 'inline-block';
  document.getElementById('stopExport').style.display = 'none';
  setTimeout(() => document.getElementById('exportStatus').textContent = '', 5000);
}

// ====================== ANIMATION LOOP ======================
function animate() {
  if (!isPlaying && !isExporting) return;
  requestAnimationFrame(animate);

  const targetCanvas = isExporting ? exportCanvas : canvas;
  const targetCtx = isExporting ? exportCtx : ctx;

  draw(targetCanvas, targetCtx);

  if (isExporting) {
    ctx.drawImage(exportCanvas, 0, 0, canvas.width, canvas.height);
  }
}