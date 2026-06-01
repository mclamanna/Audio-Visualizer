// Audio context setup
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioBuffer, source, analyser, dataArray, bufferLength;
let isPlaying = false;

// Video export variables
let mediaRecorder;
let recordedChunks = [];
let canvasStream;
let isExporting = false;
let selectedVideoFormat = 'mp4';
let selectedResolution = '1080x1080';
let selectedQuality = 'high';
let originalCanvasWidth, originalCanvasHeight;
let exportCanvas, exportCtx;

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
            document.getElementById('startExport').disabled = false;
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
    isPlaying = true;
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    source.onended = () => {
        isPlaying = false;
    };
    source.start();
    animate();
}

// Stop audio and visualization
function stopAudio() {
    isPlaying = false;
    if (source) {
        try {
            source.stop();
        } catch (e) {
            // Source may already be stopped
        }
        source = null;
    }
}

// Initialize video export
function startVideoExport() {
    if (!audioBuffer) {
        alert('Please load an audio file first.');
        return;
    }

    isExporting = true;
    recordedChunks = [];
    
    // Get export settings
    selectedVideoFormat = document.getElementById('videoFormat')?.value || 'mp4';
    selectedResolution = document.getElementById('videoResolution')?.value || '1080x1080';
    selectedQuality = document.getElementById('videoQuality')?.value || 'high';
    
    // Parse resolution
    const [width, height] = selectedResolution.split('x').map(Number);
    
    // Set up export canvas
    originalCanvasWidth = canvas.width;
    originalCanvasHeight = canvas.height;
    
    exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    exportCtx = exportCanvas.getContext('2d');
    
    // Create canvas stream for video from export canvas
    canvasStream = exportCanvas.captureStream(60); // 60 FPS
    
    // Play visualization audio through main context
    if (source) source.stop();
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    
    // Try to get audio stream from the audio context
    try {
        if (audioCtx.createMediaStreamDestination) {
            const mediaStreamDest = audioCtx.createMediaStreamDestination();
            source.connect(mediaStreamDest);
            const audioTracks = mediaStreamDest.stream.getAudioTracks();
            for (let track of audioTracks) {
                canvasStream.addTrack(track);
            }
        }
    } catch (e) {
        console.log('Note: Audio will play through speakers but may not be in video.');
    }
    
    // Get bitrate based on quality
    let videoBitsPerSecond;
    switch (selectedQuality) {
        case 'standard':
            videoBitsPerSecond = 5000000; // 5 Mbps
            break;
        case 'ultra':
            videoBitsPerSecond = 20000000; // 20 Mbps
            break;
        case 'high':
        default:
            videoBitsPerSecond = 10000000; // 10 Mbps
            break;
    }
    
    // Create media recorder with format-specific codec and quality
    let options;
    
    if (selectedVideoFormat === 'mp4' || selectedVideoFormat === 'mov') {
        // Try H.264 codec for MP4/MOV
        options = { 
            mimeType: 'video/mp4;codecs=h264',
            videoBitsPerSecond: videoBitsPerSecond
        };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { 
                mimeType: 'video/mp4',
                videoBitsPerSecond: videoBitsPerSecond
            };
        }
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            // Fallback to WebM if MP4 not supported
            options = { 
                mimeType: 'video/webm;codecs=vp9',
                videoBitsPerSecond: videoBitsPerSecond
            };
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { 
                    mimeType: 'video/webm;codecs=vp8',
                    videoBitsPerSecond: videoBitsPerSecond
                };
            }
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options = { 
                    mimeType: 'video/webm',
                    videoBitsPerSecond: videoBitsPerSecond
                };
            }
        }
    } else {
        // WebM default
        options = { 
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: videoBitsPerSecond
        };
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { 
                mimeType: 'video/webm;codecs=vp8',
                videoBitsPerSecond: videoBitsPerSecond
            };
        }
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options = { 
                mimeType: 'video/webm',
                videoBitsPerSecond: videoBitsPerSecond
            };
        }
    }
    
    mediaRecorder = new MediaRecorder(canvasStream, options);
    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };
    
    mediaRecorder.onstop = () => {
        finializeVideoExport();
    };
    
    mediaRecorder.start();
    source.start();
    isPlaying = true;
    
    // Update UI
    document.getElementById('startExport').style.display = 'none';
    document.getElementById('stopExport').style.display = 'block';
    document.getElementById('startExport').disabled = true;
    document.getElementById('playButton').disabled = true;
    document.getElementById('exportStatus').textContent = 'Recording video...';
    
    // Start animation loop
    animate();
    
    // Stop export when audio ends
    source.onended = () => {
        setTimeout(stopVideoExport, 500);
    };
}

function stopVideoExport() {
    if (!isExporting || !mediaRecorder) return;
    
    isExporting = false;
    isPlaying = false;
    
    // Stop all sources
    if (source) {
        source.stop();
        source = null;
    }
    
    // Stop recording
    mediaRecorder.stop();
    
    // Update UI
    document.getElementById('exportStatus').textContent = 'Processing video...';
}

function finializeVideoExport() {
    // Create blob from recorded chunks with appropriate MIME type
    isPlaying = false;
    let mimeType = 'video/webm';
    let fileExtension = 'webm';
    
    if (selectedVideoFormat === 'mp4') {
        mimeType = 'video/mp4';
        fileExtension = 'mp4';
    } else if (selectedVideoFormat === 'mov') {
        mimeType = 'video/quicktime';
        fileExtension = 'mov';
    }
    
    const blob = new Blob(recordedChunks, { type: mimeType });
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    link.download = `audio-visualization-${timestamp}.${fileExtension}`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    // Restore canvas dimensions
    canvas.width = originalCanvasWidth;
    canvas.height = originalCanvasHeight;
    
    // Reset UI
    document.getElementById('startExport').style.display = 'block';
    document.getElementById('stopExport').style.display = 'none';
    document.getElementById('startExport').disabled = false;
    document.getElementById('playButton').disabled = false;
    document.getElementById('exportStatus').textContent = 'Video downloaded!';
    
    setTimeout(() => {
        document.getElementById('exportStatus').textContent = '';
    }, 3000);
}

// Event listeners
document.getElementById('audioFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) loadAudio(file);
});
document.getElementById('playButton').addEventListener('click', playAudio);
document.getElementById('stopButton').addEventListener('click', stopAudio);
document.getElementById('startExport').addEventListener('click', startVideoExport);
document.getElementById('stopExport').addEventListener('click', stopVideoExport);
document.getElementById('videoFormat').addEventListener('change', function(e) {
    selectedVideoFormat = e.target.value;
});
document.getElementById('videoResolution').addEventListener('change', function(e) {
    selectedResolution = e.target.value;
});
document.getElementById('videoQuality').addEventListener('change', function(e) {
    selectedQuality = e.target.value;
});

// Animation loop
function animate() {
    if (!isPlaying) return;
    requestAnimationFrame(animate);
    
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);

    // Choose rendering target: export canvas for high-res export, otherwise visible canvas
    const exportIsReady = isExporting && exportCanvas && exportCtx;
    const renderCanvas = exportIsReady ? exportCanvas : canvas;
    const renderCtx = exportIsReady ? exportCtx : ctx;
    const drawCanvas = renderCanvas;
    const drawCtx = renderCtx;
    
    // Clear canvas with dark background
    drawCtx.fillStyle = '#111';
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);

    // Draw grid
    drawGridToCanvas(drawCanvas, drawCtx);

    // Draw rainbow-colored frequency dots
    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq, drawCanvas);
        if (x !== null) {
            const y = map(dataArray[i], 0, 255, drawCanvas.height, 0);
            const hue = map(Math.log10(freq), logMin, logMax, 0, 300);
            drawCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
            drawCtx.beginPath();
            drawCtx.arc(x, y, 2, 0, Math.PI * 2);
            drawCtx.fill();
        }
    }

    // Smooth data for trend lines
    const smoothedData1 = movingAverage(dataArray, 5); // Orange line
    const smoothedData2 = movingAverage(dataArray, 10); // Gray line

    // Draw red trend line
    drawCtx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq, drawCanvas);
        if (x !== null) {
            const y = map(smoothedData1[i], 0, 255, drawCanvas.height, 0);
            i === 0 || freqToX((i - 1) * (audioCtx.sampleRate / 2) / bufferLength, drawCanvas) === null ? drawCtx.moveTo(x, y) : drawCtx.lineTo(x, y);
        }
    }
    drawCtx.strokeStyle = 'red';
    drawCtx.lineWidth = 1;
    drawCtx.stroke();

    // Draw gray trend line
    drawCtx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
        const freq = i * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq, drawCanvas);
        if (x !== null) {
            const y = map(smoothedData2[i], 0, 255, drawCanvas.height, 0);
            i === 0 || freqToX((i - 1) * (audioCtx.sampleRate / 2) / bufferLength, drawCanvas) === null ? drawCtx.moveTo(x, y) : drawCtx.lineTo(x, y);
        }
    }
    drawCtx.strokeStyle = 'gray';
    drawCtx.lineWidth = 1;
    drawCtx.strokeStyle = 'gray';
    drawCtx.lineWidth = 1;
    drawCtx.stroke();

    // Draw peak markers on orange trend line
    const peaks = [];
    for (let i = 1; i < bufferLength - 1; i++) {
        if (smoothedData1[i] > smoothedData1[i - 1] && smoothedData1[i] > smoothedData1[i + 1]) {
            peaks.push({ index: i, value: smoothedData1[i] });
        }
    }
    peaks.sort((a, b) => b.value - a.value);
    const topPeaks = peaks.slice(0, 2);

    drawCtx.strokeStyle = 'orange';
    drawCtx.lineWidth = 2;
    for (const peak of topPeaks) {
        const freq = peak.index * (audioCtx.sampleRate / 2) / bufferLength;
        const x = freqToX(freq, drawCanvas);
        if (x !== null) {
            const y = map(smoothedData1[peak.index], 0, 255, drawCanvas.height, 0);
            drawCtx.beginPath();
            drawCtx.arc(x, y, 5, 0, Math.PI * 2);
            drawCtx.stroke();
        }
    }


    // If exporting, copy the high-res render into the visible canvas (downscale for display)
    if (exportIsReady) {
        // keep export as source, draw into on-screen canvas for preview
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(renderCanvas, 0, 0, canvas.width, canvas.height);
    }

}

// Convert frequency to x-position on logarithmic scale
function freqToX(freq, targetCanvas = canvas) {
    if (freq < minFreq || freq > maxFreq) return null;
    const logFreq = Math.log10(freq);
    return targetCanvas.width * (logFreq - logMin) / (logMax - logMin);
}

// Draw grid and frequency labels
function drawGridToCanvas(targetCanvas, targetCtx) {
    const labelFreqs = [20, 30, 40, 50, 60, 80, 100, 200, 300, 400, 600, 800, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 20000];
    targetCtx.strokeStyle = 'rgba(255,255,255,0.2)';
    targetCtx.lineWidth = 1;

    // Vertical grid lines and labels
    for (const freq of labelFreqs) {
        const x = freqToX(freq, targetCanvas);
        if (x !== null) {
            targetCtx.beginPath();
            targetCtx.moveTo(x, 0);
            targetCtx.lineTo(x, targetCanvas.height);
            targetCtx.stroke();
            targetCtx.fillStyle = 'white';
            targetCtx.textAlign = 'center';
            targetCtx.font = '12px Arial';
            targetCtx.fillText(freq < 1000 ? freq : (freq / 1000) + 'k', x, targetCanvas.height - 10);
        }
    }

    // Horizontal grid lines
    const numHorizontalLines = 5;
    for (let i = 0; i <= numHorizontalLines; i++) {
        const y = targetCanvas.height * (1 - i / numHorizontalLines);
        targetCtx.beginPath();
        targetCtx.moveTo(0, y);
        targetCtx.lineTo(targetCanvas.width, y);
        targetCtx.stroke();
    }
}

// Backward compatibility - call drawGridToCanvas with main canvas
function drawGrid() {
    drawGridToCanvas(canvas, ctx);
}