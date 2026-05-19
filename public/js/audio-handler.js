/**
 * Audio handler — mic capture (16kHz PCM) and playback (24kHz PCM).
 * Uses AudioWorklet for low-latency mic processing.
 * Playback uses a dedicated 24kHz AudioContext for gapless output.
 */
const AudioHandler = (() => {
  // Input (mic) context — browser's native sample rate
  let inputCtx = null;
  let micStream = null;
  let micSource = null;
  let workletNode = null;
  let streaming = false;
  let onChunk = null;

  // Output (playback) context — 24kHz to match Gemini's output
  let outputCtx = null;
  let activeSources = [];
  let nextPlayTime = 0;

  // Jitter buffer: minimal delay before first chunk for smoother playback
  const JITTER_BUFFER_MS = 0.05; // 50ms — low latency

  async function initInput() {
    if (inputCtx) return;
    inputCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (inputCtx.state === 'suspended') await inputCtx.resume();
    await inputCtx.audioWorklet.addModule('/js/audio-worklet-processor.js');
  }

  function initOutput() {
    if (outputCtx) return;
    try {
      // 24kHz context eliminates resampling artifacts for Gemini audio
      outputCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    } catch (_) {
      // Fallback to default sample rate if 24kHz not supported
      outputCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (outputCtx.state === 'suspended') outputCtx.resume();
  }

  async function startStreaming(chunkCallback) {
    if (streaming) return;
    onChunk = chunkCallback;

    await initInput();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 48000 }
      }
    });

    micSource = inputCtx.createMediaStreamSource(micStream);
    workletNode = new AudioWorkletNode(inputCtx, 'pcm-processor');

    workletNode.port.onmessage = (evt) => {
      if (evt.data.pcm && onChunk) {
        const base64 = arrayBufferToBase64(evt.data.pcm);
        onChunk(base64);
      }
    };

    micSource.connect(workletNode);
    workletNode.connect(inputCtx.destination); // keeps worklet alive
    streaming = true;
  }

  function stopStreaming() {
    if (!streaming) return;
    streaming = false;
    onChunk = null;

    if (workletNode) { workletNode.disconnect(); workletNode = null; }
    if (micSource) { micSource.disconnect(); micSource = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  }

  function playChunk(base64Data) {
    initOutput();
    if (!outputCtx) return;
    if (outputCtx.state === 'suspended') outputCtx.resume();

    // Decode base64 → Int16 PCM → Float32
    const raw = atob(base64Data);
    const len = raw.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = raw.charCodeAt(i);

    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

    // Create buffer at 24kHz (Gemini output sample rate)
    const buf = outputCtx.createBuffer(1, float32.length, 24000);
    buf.getChannelData(0).set(float32);

    const source = outputCtx.createBufferSource();
    source.buffer = buf;
    source.connect(outputCtx.destination);

    // Schedule gapless playback with jitter buffer lookahead
    const now = outputCtx.currentTime;
    if (nextPlayTime < now) {
      // First chunk or after a gap — add jitter buffer delay
      nextPlayTime = now + JITTER_BUFFER_MS;
    }

    source.start(nextPlayTime);
    nextPlayTime += buf.duration;

    activeSources.push(source);
    source.onended = () => {
      activeSources = activeSources.filter(s => s !== source);
    };
  }

  function stopPlayback() {
    activeSources.forEach(s => { try { s.stop(); } catch (_) { } });
    activeSources = [];
    nextPlayTime = 0;
  }

  function isStreaming() { return streaming; }

  function ensureContext() {
    if (inputCtx && inputCtx.state === 'suspended') inputCtx.resume();
    if (outputCtx && outputCtx.state === 'suspended') outputCtx.resume();
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  return { startStreaming, stopStreaming, playChunk, stopPlayback, isStreaming, ensureContext };
})();
