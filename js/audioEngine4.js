// js/audioEngine3.js
let audioCtx, audioBuffer, source, analyser, dataArray;
let isPlaying = false;

let scene, camera, renderer;
let centralSphere, barsMesh, particles;
let rotation = 0;

const canvas = document.getElementById('canvas');
const numBars = 120;   // Fewer but taller bars for tower effect

// ====================== INIT ======================
function initThree() {
  renderer = new THREE.WebGLRenderer({ 
    canvas, 
    antialias: true, 
    alpha: true 
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 8, 25);

  camera = new THREE.PerspectiveCamera(55, 1200/800, 0.1, 100);
  camera.position.set(0, -4, 6);     // Low angle looking up
  camera.lookAt(0, 6, 0);

  // Lights
  scene.add(new THREE.AmbientLight(0xaaaaaa, 0.4));
  const topLight = new THREE.PointLight(0xffffff, 4, 100);
  topLight.position.set(0, 15, 0);
  scene.add(topLight);

  // Central glowing orb
  centralSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 64, 64),
    new THREE.MeshPhongMaterial({ 
      color: 0xffffff, 
      emissive: 0x77aaff,
      shininess: 120,
      specular: 0xffffff
    })
  );
  centralSphere.position.y = 7;
  scene.add(centralSphere);

  // Tall vertical bars in a cylinder
  barsMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.18, 0.18, 18),   // Very tall
    new THREE.MeshPhongMaterial({ 
      color: 0xccddee, 
      emissive: 0x5588ff,
      shininess: 20
    }),
    numBars
  );
  scene.add(barsMesh);

  // Particles (sparkle effect)
  const pCount = 1800;
  const positions = new Float32Array(pCount * 3);
  for (let i = 0; i < pCount * 3; i += 3) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.2 + Math.random() * 1.8;
    positions[i]     = Math.cos(angle) * radius;
    positions[i + 1] = Math.random() * 18 - 2;   // tall vertical spread
    positions[i + 2] = Math.sin(angle) * radius;
  }
  particles = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3)),
    new THREE.PointsMaterial({
      size: 0.06,
      color: 0xaaccff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false
    })
  );
  scene.add(particles);
}

// ====================== RESIZE ======================
function resize() {
  if (!renderer || !camera) return;
  const w = Math.min(window.innerWidth * 0.95, 1280);
  const h = Math.min(window.innerHeight - 280, 720);
  
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ====================== UPDATE ======================
function update() {
  if (!analyser) return;
  analyser.getByteFrequencyData(dataArray);

  let bass = 0;
  for (let i = 0; i < 50; i++) bass += dataArray[i];
  bass = bass / 50 / 255;

  // Pulse central orb
  const pulse = 1 + bass * 1.6;
  centralSphere.scale.setScalar(pulse);

  rotation += 0.003 + bass * 0.04;

  // Update bars
  const dummy = new THREE.Object3D();
  for (let i = 0; i < numBars; i++) {
    const angle = (i / numBars) * Math.PI * 2 + rotation;
    const freqIndex = Math.floor((i / numBars) * (dataArray.length * 0.65));
    const amp = dataArray[freqIndex] / 255;

    const heightFactor = 0.6 + amp * 1.8;

    dummy.position.x = Math.cos(angle) * 3.4;
    dummy.position.z = Math.sin(angle) * 3.4;
    dummy.position.y = 6;                    // center height
    dummy.scale.set(1, heightFactor, 1);
    dummy.rotation.y = angle + Math.PI / 2;
    dummy.updateMatrix();
    barsMesh.setMatrixAt(i, dummy.matrix);
  }
  barsMesh.instanceMatrix.needsUpdate = true;

  // Particles react
  particles.rotation.y = rotation * 0.25;
  particles.scale.setScalar(1 + bass * 0.4);
}

// ====================== ANIMATION ======================
function animate() {
  requestAnimationFrame(animate);
  update();
  renderer.render(scene, camera);
}

// ====================== AUDIO ======================
document.getElementById('audioFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const reader = new FileReader();
  reader.onload = async ev => {
    audioBuffer = await audioCtx.decodeAudioData(ev.target.result);
    document.getElementById('playButton').disabled = false;
    document.getElementById('startExport').disabled = false;
    document.getElementById('captureCurrent').disabled = false;
    document.getElementById('capture30s').disabled = false;
    document.getElementById('exportStatus').textContent = `Loaded: ${file.name}`;
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('playButton').addEventListener('click', () => {
  if (!audioBuffer) return;
  stopEverything();

  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 4096;
  dataArray = new Uint8Array(analyser.frequencyBinCount);

  source.connect(analyser).connect(audioCtx.destination);
  source.onended = stopEverything;
  source.start();
  isPlaying = true;
});

document.getElementById('stopButton').addEventListener('click', stopEverything);

document.getElementById('captureCurrent').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = `radial-tower-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png', 1.0);
  link.click();
});

function stopEverything() {
  isPlaying = false;
  if (source) try { source.stop(); } catch(e) {}
  document.getElementById('startExport').style.display = 'block';
  document.getElementById('stopExport').style.display = 'none';
  document.getElementById('progressContainer').style.display = 'none';
}

// ====================== START ======================
initThree();
resize();
animate();