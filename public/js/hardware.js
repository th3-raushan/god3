/**
 * Hardware detection and verification module.
 * Tests camera, microphone, and speaker availability.
 */
const Hardware = (() => {
  let cameraStream = null;
  let micStream = null;
  let audioCtx = null;
  let analyser = null;
  let micSource = null;
  let vizAnimId = null;

  // --- Camera ---
  async function checkCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' }
      });
      cameraStream = stream;
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      return {
        ok: true,
        label: track.label || 'Camera detected',
        resolution: `${settings.width || '?'}x${settings.height || '?'}`
      };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  }

  function getCameraStream() {
    return cameraStream;
  }

  // --- Microphone ---
  async function checkMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream = stream;
      const track = stream.getAudioTracks()[0];
      return { ok: true, label: track.label || 'Microphone detected' };
    } catch (err) {
      return { ok: false, error: friendlyError(err) };
    }
  }

  function startMicVisualization(container) {
    if (!micStream) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(analyser);

    const barCount = analyser.frequencyBinCount;
    container.innerHTML = '';
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'visualizer__bar';
      container.appendChild(bar);
    }

    const data = new Uint8Array(barCount);
    const bars = container.querySelectorAll('.visualizer__bar');

    function draw() {
      analyser.getByteFrequencyData(data);
      bars.forEach((bar, i) => {
        const h = Math.max(4, (data[i] / 255) * 48);
        bar.style.height = h + 'px';
      });
      vizAnimId = requestAnimationFrame(draw);
    }
    draw();
  }

  function stopMicVisualization() {
    if (vizAnimId) cancelAnimationFrame(vizAnimId);
    vizAnimId = null;
  }

  // --- Speaker ---
  async function checkSpeaker() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') await ctx.resume();
      ctx.close();
      return { ok: true, label: 'Audio output available' };
    } catch (err) {
      return { ok: false, error: 'Web Audio API not supported' };
    }
  }

  function playTestTone(durationMs = 400) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.05);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationMs / 1000);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durationMs / 1000 + 0.05);

    return new Promise(resolve => {
      osc.onended = () => { ctx.close(); resolve(); };
    });
  }

  // --- Helpers ---
  function friendlyError(err) {
    if (err.name === 'NotAllowedError') return 'Permission denied. Please allow access in your browser settings.';
    if (err.name === 'NotFoundError') return 'Device not found. Please connect the hardware.';
    if (err.name === 'NotReadableError') return 'Device is in use by another application.';
    return err.message || 'Unknown error';
  }

  function cleanup() {
    stopMicVisualization();
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
  }

  return {
    checkCamera,
    getCameraStream,
    checkMicrophone,
    startMicVisualization,
    stopMicVisualization,
    checkSpeaker,
    playTestTone,
    cleanup
  };
})();
