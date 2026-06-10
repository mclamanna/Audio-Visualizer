let audioCtx = null;
let audioBuffer = null, source = null, analyser = null, dataArray = null;
let isPlaying = false, isExporting = false;
let mediaRecorder = null, recordedChunks = [], exportCanvas = null, exportCtx = null;
let exportStartTime = 0;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: true });

const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progressContainer');

// ====================== CUSTOMIZABLE SETTINGS ======================
let rotation = 0;                    
let trail = 0.91;                    
const bars = 200;                    
const fftSize = 2048;                

// ====================== CANVAS SETUP ======================
function resizeCanvas() {
  canvas.width = Math.min(window.innerWidth * 0.95, 1280);
  canvas.height = Math.min(window.innerHeight - 220, 720);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ====================== MAIN DRAW FUNCTION (VISUALS) ======================
function draw(targetCanvas, targetCtx) {
  if (!analyser) return;
  analyser.getByteFrequencyData(dataArray);

  targetCtx.fillStyle = `rgba(0, 0, 0, ${1 - trail})`;
  targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);

  const centerX = targetCanvas.width / 2;
  const centerY = targetCanvas.height / 2;
  const baseRadius = Math.min(centerX, centerY) * 0.18;

  let bass = 0;
  for (let i = 0; i < 30; i++) bass += dataArray[i];
  bass = bass / 30 / 255; 

  const pulse = baseRadius + bass * 110;     
  rotation += 0.003 + bass * 0.018;          

  targetCtx.shadowColor = '#ffffff';
  targetCtx.beginPath();

  for (let i = 0; i < bars; i++) {
    const angle = (i / bars) * Math.PI * 2 + rotation;
    const freqIndex = Math.floor(i / bars * dataArray.length * 0.65);
    let amp = dataArray[freqIndex] / 255;     

    const length = pulse + amp * Math.min(centerX, centerY) * 0.95;
    const x1 = centerX + Math.cos(angle) * (pulse * 0.6);
    const y1 = centerY + Math.sin(angle) * (pulse * 0.6);
    const x2 = centerX + Math.cos(angle) * length;
    const y2 = centerY + Math.sin(angle) * length;

    const alpha = Math.pow(amp, 0.6) * 0.95;   

    targetCtx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;   
    targetCtx.lineWidth = 1.8 + amp * 7;
    targetCtx.shadowBlur = amp > 0.65 ? 30 : 10; 
    
    targetCtx.moveTo(x1, y1);
    targetCtx.lineTo(x2, y2);
  }
  targetCtx.stroke();

  targetCtx.shadowBlur = 50;
  targetCtx.fillStyle = `rgba(255, 255, 255, ${0.75 + bass * 0.45})`;  
  targetCtx.beginPath();
  targetCtx.arc(centerX, centerY, pulse * 0.45, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.shadowBlur = 0; 
}

// ====================== AUDIO LOADING ======================
document.getElementById('audioFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  const status = document.getElementById('exportStatus');
  status.textContent = `Loading ${file.name}...`;

  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      audioBuffer = await audioCtx.decodeAudioData(ev.target.result);
      document.getElementById('playButton').disabled = false;
      document.getElementById('startExport').disabled = false;
      status.textContent = `Loaded: ${file.name}`;
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
  if (audioCtx.state === 'suspended') audioCtx.resume();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = fftSize;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  source.connect(analyser).connect(audioCtx.destination);
  source.onended = () => { if (!isExporting) stopEverything(); };

  source.start();
  isPlaying = true;
  animate();
});

document.getElementById('stopButton').addEventListener('click', stopEverything);

// ====================== EXPORT OPERATIONS ======================
document.getElementById('startExport').addEventListener('click', async () => {
  if (!audioBuffer || isExporting) return;
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  isExporting = true;
  recordedChunks = [];
  
  exportStartTime = audioCtx.currentTime;
  progressBar.style.width = '0%';
  progressContainer.style.display = 'block';

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
  
  if (dest.stream.getAudioTracks().length > 0) {
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  }

  const bitrate = quality === 'ultra' ? 28000000 : quality === 'high' ? 18000000 : 10000000;

  let selectedMime = 'video/mp4;codecs=avc1.42E01E,mp4a.40.2';
  if (!MediaRecorder.isTypeSupported(selectedMime)) {
    selectedMime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  }

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: selectedMime,
    videoBitsPerSecond: bitrate,
    audioBitsPerSecond: 320000
  });

  mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = finalizeExport;

  mediaRecorder.start(250);
  
  source.onended = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  };
  
  source.start();

  document.getElementById('startExport').style.display = 'none';
  document.getElementById('stopExport').style.display = 'inline-block';
  document.getElementById('exportStatus').textContent = `Exporting ${width}×${height}...`;

  animate();
});

function finalizeExport() {
  const extension = mediaRecorder && mediaRecorder.mimeType.includes('mp4') ? 'mp4' : 'webm';
  if (recordedChunks.length === 0) {
    document.getElementById('exportStatus').textContent = '❌ No video data recorded';
  } else {
    const blob = new Blob(recordedChunks, { type: `video/${extension}` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `radial-explosion-${Date.now()}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
    document.getElementById('exportStatus').textContent = '✅ Download started!';
  }
  resetUI();
}

document.getElementById('stopExport').addEventListener('click', () => {
  if (!isExporting || !mediaRecorder) return;
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  stopEverything();
});

function stopEverything() {
  isPlaying = false;
  isExporting = false;
  if (source) { try { source.stop(); } catch(e){} source = null; }
  resetUI();
}

function resetUI() {
  document.getElementById('startExport').style.display = 'inline-block';
  document.getElementById('stopExport').style.display = 'none';
  progressContainer.style.display = 'none';
}

// ====================== ANIMATION LOOP ======================
function animate() {
  if (!isPlaying && !isExporting) return;
  requestAnimationFrame(animate);

  if (isPlaying && !isExporting) {
    draw(canvas, ctx);
  }
  
  if (isExporting && exportCanvas && exportCtx) {
    draw(exportCanvas, exportCtx);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(exportCanvas, 0, 0, canvas.width, canvas.height);

    if (audioBuffer) {
      const elapsed = audioCtx.currentTime - exportStartTime;
      const percentage = Math.min((elapsed / audioBuffer.duration) * 100, 100);
      progressBar.style.width = `${percentage}%`;
      document.getElementById('exportStatus').textContent = `Exporting: ${Math.floor(percentage)}%`;
    }
  }
}
