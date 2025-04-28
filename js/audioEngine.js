// Audio context setup
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioBuffer, source, analyser, dataArray, bufferLength;

// Canvas setup
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Resize canvas dynamically
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Frequency range for logarithmic scale
const minFreq = 20;
const maxFreq = 20000;
const logMin = Math.log10(minFreq);
const logMax = Math.log10(maxFreq);

// Utility function to map values
function map(value, inMin, inMax, outMin, outMax) {
    return (value - inMin) / (inMax - inMin) * (outMax - outMin) + outMin;
}

// Moving average for smoothing trend lines
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

// Load audio file
function loadAudio(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        audioCtx.decodeAudioData(e.target.result, function(buffer) {
            audioBuffer = buffer;
            document.getElementById('playButton').disabled = false;
        }, function(error) {
            console.error('Error decoding audio:', error);
            alert('Failed to load audio file.');
        });
    };
    reader.readAsArrayBuffer(file);
}

// Play audio and start visualization
function playAudio() {
    if (source) source.stop();
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    source.start();
    document.getElementById('stopButton').disabled = false;
    animate();
}

// Stop audio and visualization
function stopAudio() {
    if (source) {
        source.stop();
        source = null;
        document.getElementById('stopButton').disabled = true;
    }
}

// Event listeners
document.getElementById('audioFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) loadAudio(file);
});
document.getElementById('playButton').addEventListener('click', playAudio);
document.getElementById('stopButton').addEventListener('click', stopAudio);

// Animation loop
function animate() {
    if (!source) return;
    requestAnimationFrame(animate);
    analyser.getByteFrequencyData(dataArray);

    // Clear canvas with dark background
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    drawGrid();

    // Draw rainbow-colored frequency dots
    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq);
        if (x !== null) {
            const y = map(dataArray[i], 0, 255, canvas.height, 0);
            const hue = map(Math.log10(freq), logMin, logMax, 0, 300);
            ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Smooth data for trend lines
    const smoothedData1 = movingAverage(dataArray, 5); // Orange line
    const smoothedData2 = movingAverage(dataArray, 10); // Gray line

    // Draw red trend line
    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq);
        if (x !== null) {
            const y = map(smoothedData1[i], 0, 255, canvas.height, 0);
            i === 0 || freqToX((i - 1) * (audioCtx.sampleRate / 2) / bufferLength) === null ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
    }
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw gray trend line
    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq);
        if (x !== null) {
            const y = map(smoothedData2[i], 0, 255, canvas.height, 0);
            i === 0 || freqToX((i - 1) * (audioCtx.sampleRate / 2) / bufferLength) === null ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
    }
    ctx.strokeStyle = 'gray';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw peak markers on orange trend line
    const peaks = [];
    for (let i = 1; i < bufferLength - 1; i++) {
        if (smoothedData1[i] > smoothedData1[i - 1] && smoothedData1[i] > smoothedData1[i + 1]) {
            peaks.push({ index: i, value: smoothedData1[i] });
        }
    }
    peaks.sort((a, b) => b.value - a.value);
    const topPeaks = peaks.slice(0, 2);

    ctx.strokeStyle = 'orange';
    ctx.lineWidth = 2;
    for (const peak of topPeaks) {
        const freq = peak.index * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq);
        if (x !== null) {
            const y = map(smoothedData1[peak.index], 0, 255, canvas.height, 0);
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

// Convert frequency to x-position on logarithmic scale
function freqToX(freq) {
    if (freq < minFreq || freq > maxFreq) return null;
    const logFreq = Math.log10(freq);
    return canvas.width * (logFreq - logMin) / (logMax - logMin);
}

// Draw grid and frequency labels
function drawGrid() {
    const labelFreqs = [20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 600, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 20000];
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;

    // Vertical grid lines and labels
    for (const freq of labelFreqs) {
        const x = freqToX(freq);
        if (x !== null) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.font = '12px Arial';
            ctx.fillText(freq < 1000 ? freq : (freq / 1000) + 'k', x, canvas.height - 10);
        }
    }

    // Horizontal grid lines
    const numHorizontalLines = 5;
    for (let i = 0; i <= numHorizontalLines; i++) {
        const y = canvas.height * (1 - i / numHorizontalLines);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}