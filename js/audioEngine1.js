// =============================================
// audioEngine.js - With Instagram 1080x1350 Support
// =============================================

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioBuffer = null;
let source = null;
let analyser = null;
let dataArray = null;
let bufferLength = 0;

let isPlaying = false;
let isExporting = false;

let mediaRecorder = null;
let recordedChunks = [];
let exportCanvas = null;
let exportCtx = null;

// Main canvas (preview)
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: true });

// ====================== UTILITIES ======================
function map(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) / (inMax - inMin) * (outMax - outMin) + outMin;
}

function movingAverage(data, windowSize) {
    const smoothed = new Array(data.length);
    for (let i = 0; i < data.length; i++) {
        let sum = 0, count = 0;
        for (let j = Math.max(0, i - windowSize); j <= Math.min(data.length - 1, i + windowSize); j++) {
            sum += data[j];
            count++;
        }
        smoothed[i] = sum / count;
    }
    return smoothed;
}

function freqToX(freq, targetCanvas) {
    const minFreq = 20, maxFreq = 20000;
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    if (freq < minFreq || freq > maxFreq) return null;
    const logFreq = Math.log10(freq);
    return targetCanvas.width * (logFreq - logMin) / (logMax - logMin);
}

// ====================== CANVAS SETUP ======================
function resizeCanvas() {
    canvas.width = Math.min(window.innerWidth * 0.95, 1280);
    canvas.height = Math.min(window.innerHeight - 220, 720);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ====================== DRAWING ======================
function drawGridToCanvas(targetCanvas, targetCtx) {
    const labelFreqs = [20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 600, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 20000];
    targetCtx.strokeStyle = 'rgba(255,255,255,0.15)';
    targetCtx.lineWidth = 1;

    for (const freq of labelFreqs) {
        const x = freqToX(freq, targetCanvas);
        if (x !== null) {
            targetCtx.beginPath();
            targetCtx.moveTo(x, 0);
            targetCtx.lineTo(x, targetCanvas.height);
            targetCtx.stroke();
            targetCtx.fillStyle = 'rgba(255,255,255,0.7)';
            targetCtx.textAlign = 'center';
            targetCtx.font = '11px Arial';
            targetCtx.fillText(freq < 1000 ? freq : (freq / 1000) + 'k', x, targetCanvas.height - 8);
        }
    }

    for (let i = 0; i <= 6; i++) {
        const y = targetCanvas.height * (i / 6);
        targetCtx.beginPath();
        targetCtx.moveTo(0, y);
        targetCtx.lineTo(targetCanvas.width, y);
        targetCtx.stroke();
    }
}

// ====================== LOAD / PLAY / STOP ======================
function loadAudio(file) {
    if (!file) return;
    const playBtn = document.getElementById('playButton');
    const exportBtn = document.getElementById('startExport');
    const status = document.getElementById('exportStatus');

    playBtn.disabled = true;
    exportBtn.disabled = true;
    status.textContent = `Loading ${file.name}...`;

    const reader = new FileReader();
    reader.onload = e => {
        audioCtx.decodeAudioData(e.target.result, buffer => {
            audioBuffer = buffer;
            playBtn.disabled = false;
            exportBtn.disabled = false;
            status.textContent = `✅ Loaded: ${file.name} — ${(buffer.duration / 60).toFixed(2)} min`;
        }, err => {
            console.error(err);
            status.textContent = '❌ Decode failed';
        });
    };
    reader.readAsArrayBuffer(file);
}

function playAudio() {
    if (!audioBuffer) return;
    if (source) source.stop();

    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0.95;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioCtx.destination);

    source.start();
    isPlaying = true;
    animate();

    source.onended = () => isPlaying = false;
}

function stopAudio() {
    isPlaying = false;
    if (source) { try { source.stop(); } catch(e){} source = null; }
}

// ====================== VIDEO EXPORT ======================
async function startVideoExport() {
    if (!audioBuffer) return alert('Load a .wav first');
    if (isExporting) return;

    isExporting = true;
    recordedChunks = [];

    try {
        const [width, height] = document.getElementById('videoResolution').value.split('x').map(Number);
        const quality = document.getElementById('videoQuality').value;

        exportCanvas = document.createElement('canvas');
        exportCanvas.width = width;
        exportCanvas.height = height;
        exportCtx = exportCanvas.getContext('2d', { alpha: false });

        const canvasStream = exportCanvas.captureStream(30);

        // Audio chain (popping fix)
        source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.95;

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        const audioDest = audioCtx.createMediaStreamDestination();

        source.connect(gainNode);
        gainNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        analyser.connect(audioDest);

        const audioTrack = audioDest.stream.getAudioTracks()[0];
        if (audioTrack) canvasStream.addTrack(audioTrack);

        const videoBitrate = quality === 'ultra' ? 20000000 : quality === 'high' ? 14000000 : 9000000;

        let options = {
            mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            videoBitsPerSecond: videoBitrate,
            audioBitsPerSecond: 320000
        };

        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'video/mp4';
        }

        mediaRecorder = new MediaRecorder(canvasStream, options);

        mediaRecorder.ondataavailable = e => e.data?.size > 0 && recordedChunks.push(e.data);
        mediaRecorder.onstop = finalizeVideoExport;

        mediaRecorder.start(500);
        await new Promise(r => setTimeout(r, 80));
        source.start(0);

        isPlaying = true;

        document.getElementById('startExport').style.display = 'none';
        document.getElementById('stopExport').style.display = 'block';
        document.getElementById('exportStatus').textContent = `Exporting ${width}×${height} (Instagram Ready)...`;

        animate();
        source.onended = () => setTimeout(stopVideoExport, 800);

    } catch (err) {
        console.error(err);
        alert('Export error: ' + err.message);
        isExporting = false;
    }
}

function stopVideoExport() {
    if (!isExporting) return;
    isExporting = false;
    isPlaying = false;
    if (source) { try { source.stop(); } catch(e){} source = null; }
    if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
}

function finalizeVideoExport() {
    if (recordedChunks.length === 0) return alert('No data recorded.');

    const blob = new Blob(recordedChunks, { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `visualizer-${Date.now()}.mp4`;
    link.click();
    URL.revokeObjectURL(url);
    resetUI();
}

function resetUI() {
    document.getElementById('startExport').style.display = 'block';
    document.getElementById('stopExport').style.display = 'none';
    document.getElementById('exportStatus').textContent = '✅ Export complete!';
    setTimeout(() => document.getElementById('exportStatus').textContent = '', 4000);
}

// ====================== ANIMATION ======================
function animate() {
    if (!isPlaying) return;
    requestAnimationFrame(animate);
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);

    const targetCanvas = isExporting ? exportCanvas : canvas;
    const targetCtx = isExporting ? exportCtx : ctx;

    targetCtx.fillStyle = '#111';
    targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    drawGridToCanvas(targetCanvas, targetCtx);

    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq, targetCanvas);
        if (x !== null) {
            const y = map(dataArray[i], 0, 255, targetCanvas.height, 0);
            const hue = map(Math.log10(freq), 1.3, 4.3, 0, 300);
            targetCtx.fillStyle = `hsl(${hue}, 100%, 55%)`;
            targetCtx.beginPath();
            targetCtx.arc(x, y, 2.5, 0, Math.PI * 2);
            targetCtx.fill();
        }
    }

    const s1 = movingAverage(dataArray, 4);
    const s2 = movingAverage(dataArray, 12);

    targetCtx.strokeStyle = '#ff3333'; targetCtx.lineWidth = 2;
    targetCtx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq, targetCanvas);
        if (x !== null) {
            const y = map(s1[i], 0, 255, targetCanvas.height, 0);
            i === 0 ? targetCtx.moveTo(x, y) : targetCtx.lineTo(x, y);
        }
    }
    targetCtx.stroke();

    targetCtx.strokeStyle = '#888'; targetCtx.lineWidth = 1.5;
    targetCtx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq, targetCanvas);
        if (x !== null) {
            const y = map(s2[i], 0, 255, targetCanvas.height, 0);
            i === 0 ? targetCtx.moveTo(x, y) : targetCtx.lineTo(x, y);
        }
    }
    targetCtx.stroke();

    if (isExporting) ctx.drawImage(exportCanvas, 0, 0, canvas.width, canvas.height);
}

// Event Listeners
document.getElementById('audioFile').addEventListener('change', e => e.target.files[0] && loadAudio(e.target.files[0]));
document.getElementById('playButton').addEventListener('click', playAudio);
document.getElementById('stopButton').addEventListener('click', stopAudio);
document.getElementById('startExport').addEventListener('click', startVideoExport);
document.getElementById('stopExport').addEventListener('click', stopVideoExport);