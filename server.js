const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });
const app = express();

app.use('/outputs', express.static(path.join(__dirname, 'outputs')));

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const inPath = req.file.path;
  const outName = `${req.file.filename}.mp4`;
  const outDir = path.join(__dirname, 'outputs');
  const outPath = path.join(outDir, outName);
  fs.mkdirSync(outDir, { recursive: true });

  const ff = spawn('ffmpeg', [
    '-y', '-i', inPath,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outPath
  ]);

  ff.stderr.on('data', (d) => console.log(d.toString()));

  ff.on('close', (code) => {
    try { fs.unlinkSync(inPath); } catch (e) {}
    if (code === 0) {
      return res.json({ url: `/outputs/${outName}` });
    }
    return res.status(500).json({ error: 'Transcode failed', code });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ffmpeg server listening on http://localhost:${PORT}`));
