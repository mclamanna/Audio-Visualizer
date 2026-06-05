const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

const mirrorMode = true;

// ====================== UTILITIES ======================
function map(v, iMin, iMax, oMin, oMax) {
  return ((v - iMin) / (iMax - iMin)) * (oMax - oMin) + oMin;
}

function freqToX(freq, targetCanvas) {
  const minFreq = 20, maxFreq = 20000;
  const logMin = Math.log10(minFreq), logMax = Math.log10(maxFreq);
  if (freq < minFreq || freq > maxFreq) return null;
  return targetCanvas.width * (Math.log10(freq) - logMin) / (logMax - logMin);
}

// ====================== CANVAS SETUP ======================
function resizeCanvas() {
  canvas.width = Math.min(window.innerWidth * 0.95, 1280);
  canvas.height = Math.min(window.innerHeight - 220, 720);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ====================== DRAWING ======================
function draw(targetCanvas, targetCtx) {
  analyser.getByteFrequencyData(dataArray);

  targetCtx.fillStyle = '#0a0a0a';
  targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

  drawGrid(targetCanvas, targetCtx);

  const barWidth = 3.5;
  for (let i = 0; i < dataArray.length; i++) {
    const freq = i * (audioCtx.sampleRate / 2) / dataArray.length;
    const x = freqToX(freq, targetCanvas);
    if (x === null) continue;

    const amplitude = dataArray[i] / 255;
    const height = amplitude * targetCanvas.height * 0.82;
    const hue = map(Math.log10(freq || 100), 1.3, 4.3, 280, 0);

    targetCtx.shadowBlur = 15;
    targetCtx.shadowColor = `hsl(${hue}, 100%, 70%)`;
    targetCtx.fillStyle = `hsl(${hue}, 100%, 65%)`;
    targetCtx.fillRect(x - barWidth/2, targetCanvas.height - height, barWidth, height);
  }
  targetCtx.shadowBlur = 0;

  // Smoothed line
  targetCtx.strokeStyle = '#ffffff';
  targetCtx.lineWidth = 2.8;
  targetCtx.shadowBlur = 10;
  targetCtx.shadowColor = '#fff';
  targetCtx.beginPath();
  for (let i = 0; i < dataArray.length; i += 2) {
    const freq = i * (audioCtx.sampleRate / 2) / dataArray.length;
    const x = freqToX(freq, targetCanvas);
    if (x === null) continue;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i-8); j <= Math.min(dataArray.length-1, i+8); j++) {
      sum += dataArray[j]; count++;
    }
    const avg = sum / count;
    const y = targetCanvas.height - (avg / 255 * targetCanvas.height * 0.82);
    i === 0 ? targetCtx.moveTo(x, y) : targetCtx.lineTo(x, y);
  }
  targetCtx.stroke();
  targetCtx.shadowBlur = 0;

  if (mirrorMode) {
    targetCtx.save();
    targetCtx.globalAlpha = 0.22;
    targetCtx.scale(1, -1);
    targetCtx.drawImage(targetCanvas, 0, -targetCanvas.height * 2, targetCanvas.width, targetCanvas.height);
    targetCtx.restore();
  }
}

function drawGrid(targetCanvas, targetCtx) {
  const freqs = [20, 30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  targetCtx.strokeStyle = 'rgba(255,255,255,0.1)';
  targetCtx.lineWidth = 1;
  for (const f of freqs) {
    const x = freqToX(f, targetCanvas);
    if (x) {
      targetCtx.beginPath();
      targetCtx.moveTo(x, 0);
      targetCtx.lineTo(x, targetCanvas.height);
      targetCtx.stroke();
      targetCtx.fillStyle = 'rgba(255,255,255,0.55)';
      targetCtx.font = '10px Arial';
      targetCtx.textAlign = 'center';
      targetCtx.fillText(f >= 1000 ? (f/1000)+'k' : f, x, targetCanvas.height - 5);
    }
  }
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
      status.textContent = `✅ Loaded: ${file.name} — ${(decodedBuffer.duration/60).toFixed(2)} min`;
    } catch (err) {
      console.error(err);
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
  analyser.fftSize = 4096;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  const gain = audioCtx.createGain();
  gain.gain.value = 0.95;

  source.connect(gain).connect(analyser).connect(audioCtx.destination);
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
  analyser.fftSize = 4096;
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

  mediaRecorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = finalizeExport;

  mediaRecorder.start(500);
  source.start();

  document.getElementById('startExport').style.display = 'none';
  document.getElementById('stopExport').style.display = 'inline-block';
  document.getElementById('exportStatus').textContent = `Exporting ${width}×${height}... (click Stop & Download anytime)`;

  animate();
});

function finalizeExport() {
  if (recordedChunks.length === 0) {
    document.getElementById('exportStatus').textContent = '❌ No data recorded';
  } else {
    const blob = new Blob(recordedChunks, { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spectrum-visualizer-${Date.now()}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
    document.getElementById('exportStatus').textContent = '✅ Video downloaded!';
  }
  resetUI();
}

document.getElementById('stopExport').addEventListener('click', () => {
  if (!isExporting) return;

  // Force flush + stop
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.requestData();
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, 250);
  }

  stopEverything();
});

function stopEverything() {
  isPlaying = false;
  isExporting = false;

  if (source) {
    try { source.stop(); } catch(e){}
    source = null;
  }
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
}

// ====================== RESET UI ======================
function resetUI() {
  isExporting = false;
  document.getElementById('startExport').style.display = 'inline-block';
  document.getElementById('stopExport').style.display = 'none';
  setTimeout(() => {
    document.getElementById('exportStatus').textContent = '';
  }, 4000);
}

// ====================== ANIMATION ======================
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