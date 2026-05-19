/**
 * Main application orchestrator — Phase 1 + Phase 2 + Phase 3 + Phase 4.
 * Wires up hardware checks, Gemini chat, voice interaction, and camera streaming.
 */
(() => {
  const $ = id => document.getElementById(id);

  const ui = {
    btnCheckAll:   $('btn-check-all'),
    btnTestSpeaker:$('btn-test-speaker'),
    cameraBadge:   $('hw-camera-badge'),
    cameraDetail:  $('hw-camera-detail'),
    micBadge:      $('hw-mic-badge'),
    micDetail:     $('hw-mic-detail'),
    speakerBadge:  $('hw-speaker-badge'),
    speakerDetail: $('hw-speaker-detail'),
    cameraPreview: $('camera-preview'),
    placeholder:   $('preview-placeholder'),
    visualizer:    $('mic-visualizer'),
    log:           $('system-log'),
    overallStatus: $('overall-status'),
    // Phase 2
    connBar:       $('connection-bar'),
    connDot:       $('conn-dot'),
    connText:      $('conn-text'),
    btnConnect:    $('btn-connect'),
    chatMessages:  $('chat-messages'),
    chatForm:      $('chat-form'),
    chatInput:     $('chat-input'),
    btnSend:       $('btn-send'),
    // Phase 3
    btnMic:        $('btn-mic'),
    micIcon:       $('mic-icon'),
    micLabel:      $('mic-label'),
    micPulse:      $('mic-pulse'),
    liveCaption:   $('live-caption'),
    liveCaptionText: $('live-caption-text'),
    liveCaptionInput: $('live-caption-input'),
    liveCaptionInputText: $('live-caption-input-text'),
    outputVisualizer: $('output-visualizer'),
    voiceStatus:   $('voice-status'),
    voiceDot:      $('voice-dot'),
    voiceText:     $('voice-text'),
    // Phase 4
    btnCameraToggle: $('btn-camera-toggle'),
    cameraFpsBadge:  $('camera-fps-badge'),
    cameraFpsText:   $('camera-fps-text'),
    cameraStreamingIndicator: $('camera-streaming-indicator')
  };

  // --- Logging ---
  function log(msg, level = 'info') {
    const entry = document.createElement('div');
    entry.className = `log__entry log__entry--${level}`;
    const ts = new Date().toLocaleTimeString();
    entry.textContent = `[${ts}] ${msg}`;
    ui.log.appendChild(entry);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  // --- Badge update ---
  function setBadge(badge, state, text) {
    badge.className = `status-badge status-badge--${state}`;
    badge.innerHTML = `<span class="status-dot"></span> ${text}`;
  }

  // ===========================
  // Phase 1 — Hardware Checks
  // ===========================

  async function runAllChecks() {
    ui.btnCheckAll.disabled = true;
    ui.btnCheckAll.textContent = 'Checking\u2026';
    ui.log.innerHTML = '';
    log('Starting hardware checks\u2026', 'info');

    const results = { camera: false, mic: false, speaker: false };

    // Camera
    setBadge(ui.cameraBadge, 'checking', 'Checking');
    log('Requesting camera access\u2026', 'info');
    const cam = await Hardware.checkCamera();
    if (cam.ok) {
      setBadge(ui.cameraBadge, 'ready', 'Ready');
      ui.cameraDetail.textContent = `${cam.label} (${cam.resolution})`;
      log(`Camera ready: ${cam.label}`, 'success');
      ui.cameraPreview.srcObject = Hardware.getCameraStream();
      ui.placeholder.style.display = 'none';
      results.camera = true;

      // Phase 4: Initialize camera handler with the video element
      CameraHandler.init(ui.cameraPreview);
    } else {
      setBadge(ui.cameraBadge, 'error', 'Error');
      ui.cameraDetail.textContent = cam.error;
      log(`Camera error: ${cam.error}`, 'error');
    }

    // Microphone
    setBadge(ui.micBadge, 'checking', 'Checking');
    log('Requesting microphone access\u2026', 'info');
    const mic = await Hardware.checkMicrophone();
    if (mic.ok) {
      setBadge(ui.micBadge, 'ready', 'Ready');
      ui.micDetail.textContent = mic.label;
      log(`Microphone ready: ${mic.label}`, 'success');
      Hardware.startMicVisualization(ui.visualizer);
      results.mic = true;
    } else {
      setBadge(ui.micBadge, 'error', 'Error');
      ui.micDetail.textContent = mic.error;
      log(`Microphone error: ${mic.error}`, 'error');
    }

    // Speaker
    setBadge(ui.speakerBadge, 'checking', 'Checking');
    log('Checking audio output\u2026', 'info');
    const spk = await Hardware.checkSpeaker();
    if (spk.ok) {
      setBadge(ui.speakerBadge, 'ready', 'Ready');
      ui.speakerDetail.textContent = spk.label;
      log(`Speaker ready: ${spk.label}`, 'success');
      results.speaker = true;
    } else {
      setBadge(ui.speakerBadge, 'error', 'Error');
      ui.speakerDetail.textContent = spk.error;
      log(`Speaker error: ${spk.error}`, 'error');
    }

    // Overall status
    const passed = Object.values(results).filter(Boolean).length;
    if (passed === 3) {
      ui.overallStatus.className = 'status-banner status-banner--success';
      ui.overallStatus.textContent = 'All hardware ready \u2014 you are good to go!';
      log('All checks passed.', 'success');
    } else if (passed > 0) {
      ui.overallStatus.className = 'status-banner status-banner--partial';
      ui.overallStatus.textContent = `${passed}/3 devices ready. Fix issues above and retry.`;
      log(`${passed}/3 devices ready.`, 'warning');
    } else {
      ui.overallStatus.className = 'status-banner status-banner--error';
      ui.overallStatus.textContent = 'No devices detected. Check permissions and hardware.';
      log('All checks failed.', 'error');
    }

    ui.btnCheckAll.disabled = false;
    ui.btnCheckAll.textContent = 'Run All Checks';
  }

  async function testSpeaker() {
    ui.btnTestSpeaker.disabled = true;
    ui.btnTestSpeaker.textContent = 'Playing\u2026';
    log('Playing test tone (440 Hz)\u2026', 'info');
    try {
      await Hardware.playTestTone(500);
      log('Test tone complete.', 'success');
    } catch (e) {
      log(`Tone failed: ${e.message}`, 'error');
    }
    ui.btnTestSpeaker.disabled = false;
    ui.btnTestSpeaker.textContent = 'Test Speaker';
  }

  // ===========================
  // Phase 2 + 3 — Gemini Chat & Voice
  // ===========================

  let currentAiBubble = null;
  let currentInputBubble = null;
  let geminiConnected = false;
  let aiSpeaking = false;
  let outputVizAnimId = null;
  let cameraFpsIntervalId = null;

  function setConnectionState(state, detail) {
    ui.connBar.className = 'connection-bar';

    switch (state) {
      case 'connecting':
        ui.connBar.classList.add('connection-bar--connecting');
        ui.connText.textContent = 'Connecting\u2026';
        ui.btnConnect.textContent = 'Connecting\u2026';
        ui.btnConnect.disabled = true;
        ui.btnMic.disabled = true;
        geminiConnected = false;
        log('Connecting to Gemini\u2026', 'info');
        break;

      case 'connected':
        ui.connBar.classList.add('connection-bar--connected');
        ui.connText.textContent = 'Connected to Gemini';
        ui.btnConnect.textContent = 'Disconnect';
        ui.btnConnect.disabled = false;
        ui.chatInput.disabled = false;
        ui.btnSend.disabled = false;
        ui.btnMic.disabled = false;
        // Phase 4: Enable camera toggle if camera is ready
        if (ui.cameraPreview.srcObject) {
          ui.btnCameraToggle.disabled = false;
        }
        ui.chatMessages.innerHTML = '';
        geminiConnected = true;
        log('Connected to Gemini Live API.', 'success');
        break;

      case 'disconnected':
        ui.connText.textContent = 'Disconnected';
        ui.btnConnect.textContent = 'Connect';
        ui.btnConnect.disabled = false;
        ui.chatInput.disabled = true;
        ui.btnSend.disabled = true;
        ui.btnMic.disabled = true;
        ui.btnCameraToggle.disabled = true;
        geminiConnected = false;
        stopMic();
        stopCameraStreaming();
        setVoiceStatus('inactive');
        log('Disconnected from Gemini.', 'warning');
        break;

      case 'error':
        ui.connBar.classList.add('connection-bar--error');
        ui.connText.textContent = `Error: ${detail || 'Connection failed'}`;
        ui.btnConnect.textContent = 'Retry';
        ui.btnConnect.disabled = false;
        ui.chatInput.disabled = true;
        ui.btnSend.disabled = true;
        ui.btnMic.disabled = true;
        ui.btnCameraToggle.disabled = true;
        geminiConnected = false;
        stopMic();
        stopCameraStreaming();
        setVoiceStatus('inactive');
        log(`Connection error: ${detail}`, 'error');
        break;
    }
  }

  // --- Voice Status Indicator ---
  function setVoiceStatus(state) {
    ui.voiceStatus.className = 'voice-status';

    switch (state) {
      case 'listening':
        ui.voiceStatus.classList.add('voice-status--listening');
        ui.voiceText.textContent = 'Listening\u2026';
        break;
      case 'speaking':
        ui.voiceStatus.classList.add('voice-status--speaking');
        ui.voiceText.textContent = 'AI speaking\u2026';
        break;
      default:
        ui.voiceText.textContent = 'Voice inactive';
        break;
    }
  }

  // --- Output Audio Visualizer ---
  function initOutputVisualizer() {
    const container = ui.outputVisualizer;
    if (!container || container.children.length > 0) return;

    const barCount = 16;
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'visualizer__bar';
      container.appendChild(bar);
    }
  }

  function animateOutputVisualizer(active) {
    const container = ui.outputVisualizer;
    if (!container) return;

    initOutputVisualizer();
    const bars = container.querySelectorAll('.visualizer__bar');

    if (outputVizAnimId) {
      cancelAnimationFrame(outputVizAnimId);
      outputVizAnimId = null;
    }

    if (!active) {
      bars.forEach(bar => { bar.style.height = '4px'; });
      return;
    }

    function draw() {
      bars.forEach(bar => {
        const h = Math.max(4, Math.random() * 42 + 6);
        bar.style.height = h + 'px';
      });
      outputVizAnimId = requestAnimationFrame(draw);
    }
    draw();
  }

  // --- Chat Bubble Helpers ---
  function addUserMessage(text) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg chat-msg--user';
    bubble.innerHTML = `<div class="chat-msg__label">You</div><div>${escapeHtml(text)}</div>`;
    ui.chatMessages.appendChild(bubble);
    ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
  }

  function showTypingIndicator() {
    removeTypingIndicator();
    const el = document.createElement('div');
    el.className = 'typing-indicator';
    el.id = 'typing-indicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    ui.chatMessages.appendChild(el);
    ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
  }

  function removeTypingIndicator() {
    const el = $('typing-indicator');
    if (el) el.remove();
  }

  function appendAiText(text) {
    removeTypingIndicator();

    if (!currentAiBubble) {
      currentAiBubble = document.createElement('div');
      currentAiBubble.className = 'chat-msg chat-msg--ai';
      currentAiBubble.innerHTML = `<div class="chat-msg__label">VisionGuide</div><div class="chat-msg__body"></div>`;
      ui.chatMessages.appendChild(currentAiBubble);
    }

    const body = currentAiBubble.querySelector('.chat-msg__body');
    body.textContent += text;
    ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
  }

  function handleInputTranscription(text) {
    if (!currentInputBubble) {
      currentInputBubble = document.createElement('div');
      currentInputBubble.className = 'chat-msg chat-msg--user chat-msg--voice';
      currentInputBubble.innerHTML = `<div class="chat-msg__label">You (voice)</div><div class="chat-msg__body"></div>`;
      ui.chatMessages.appendChild(currentInputBubble);
    }

    const body = currentInputBubble.querySelector('.chat-msg__body');
    body.textContent += text;
    ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;

    // Show input live caption
    ui.liveCaptionInput.hidden = false;
    ui.liveCaptionInputText.textContent = text;
  }

  function handleOutputTranscription(text) {
    appendAiText(text);

    // Update output live caption
    ui.liveCaption.hidden = false;
    ui.liveCaptionText.textContent = text;
  }

  function handleAudioResponse(base64Data) {
    // Mark AI as speaking
    if (!aiSpeaking) {
      aiSpeaking = true;
      setVoiceStatus('speaking');
      animateOutputVisualizer(true);
      if (currentAiBubble) currentAiBubble.classList.add('chat-msg--ai-speaking');
    }

    AudioHandler.playChunk(base64Data);
  }

  // Called when Gemini's VAD detects user started speaking (server-side barge-in)
  function handleInterrupted() {
    log('Gemini interrupted \u2014 user started speaking.', 'info');
    AudioHandler.stopPlayback();
    aiSpeaking = false;
    animateOutputVisualizer(false);
    if (currentAiBubble) currentAiBubble.classList.remove('chat-msg--ai-speaking');
    currentAiBubble = null;
    currentInputBubble = null;

    if (AudioHandler.isStreaming()) {
      setVoiceStatus('listening');
    } else {
      setVoiceStatus('inactive');
    }
  }

  function finalizeAiTurn() {
    removeTypingIndicator();

    // Stop AI speaking state
    aiSpeaking = false;
    animateOutputVisualizer(false);
    if (currentAiBubble) currentAiBubble.classList.remove('chat-msg--ai-speaking');

    // Revert voice status based on mic state
    if (AudioHandler.isStreaming()) {
      setVoiceStatus('listening');
    } else {
      setVoiceStatus('inactive');
    }

    currentAiBubble = null;
    currentInputBubble = null;

    // Hide live captions after a delay
    setTimeout(() => {
      ui.liveCaption.hidden = true;
      ui.liveCaptionText.textContent = '';
      ui.liveCaptionInput.hidden = true;
      ui.liveCaptionInputText.textContent = '';
    }, 3000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===========================
  // Phase 3 — Mic Toggle
  // ===========================

  async function toggleMic() {
    AudioHandler.ensureContext();

    if (AudioHandler.isStreaming()) {
      stopMic();
    } else {
      await startMic();
    }
  }

  async function startMic() {
    try {
      log('Starting microphone streaming\u2026', 'info');

      await AudioHandler.startStreaming((base64Chunk) => {
        // Just send audio — barge-in is handled server-side by Gemini's VAD
        GeminiClient.sendAudio(base64Chunk);
      });

      ui.btnMic.classList.add('btn--mic-active');
      ui.micLabel.textContent = 'Mic On';
      setVoiceStatus('listening');
      log('Microphone active \u2014 speak now.', 'success');
    } catch (e) {
      log(`Mic error: ${e.message}`, 'error');
    }
  }

  function stopMic() {
    AudioHandler.stopStreaming();
    AudioHandler.stopPlayback();
    ui.btnMic.classList.remove('btn--mic-active');
    ui.micLabel.textContent = 'Mic';
    setVoiceStatus('inactive');
    animateOutputVisualizer(false);
    aiSpeaking = false;
  }

  function handleConnect() {
    if (GeminiClient.isConnected()) {
      GeminiClient.disconnect();
      stopMic();
      stopCameraStreaming();
      return;
    }

    AudioHandler.ensureContext();

    GeminiClient.connect({
      onStatus: (state, detail) => setConnectionState(state, detail),
      onText: (text) => appendAiText(text),
      onAudio: (data) => handleAudioResponse(data),
      onInputTranscription: (text) => handleInputTranscription(text),
      onOutputTranscription: (text) => handleOutputTranscription(text),
      onTurnComplete: () => finalizeAiTurn(),
      onInterrupted: () => handleInterrupted()
    });
  }

  function handleSendMessage(e) {
    e.preventDefault();
    const text = ui.chatInput.value.trim();
    if (!text) return;

    addUserMessage(text);
    showTypingIndicator();
    GeminiClient.sendText(text);
    ui.chatInput.value = '';
    ui.chatInput.focus();
  }

  // ===========================
  // Phase 4 — Camera Streaming
  // ===========================

  function toggleCameraStreaming() {
    if (CameraHandler.isStreaming()) {
      stopCameraStreaming();
    } else {
      startCameraStreaming();
    }
  }

  function startCameraStreaming() {
    try {
      log('Starting camera streaming to AI (1 FPS)\u2026', 'info');

      CameraHandler.startCapture((base64Frame) => {
        GeminiClient.sendVideo(base64Frame);
      }, { fps: 1, quality: 0.4 });

      ui.btnCameraToggle.textContent = 'Stop Streaming';
      ui.btnCameraToggle.classList.add('btn--camera-active');
      ui.cameraFpsBadge.hidden = false;
      ui.cameraStreamingIndicator.hidden = false;
      ui.cameraFpsText.textContent = `${CameraHandler.getFps()} FPS`;

      // Update frame count display periodically
      cameraFpsIntervalId = setInterval(() => {
        if (CameraHandler.isStreaming()) {
          ui.cameraFpsText.textContent = `${CameraHandler.getFps()} FPS \u2022 ${CameraHandler.getFrameCount()} frames`;
        }
      }, 2000);

      log('Camera streaming active \u2014 AI can now see.', 'success');
    } catch (e) {
      log(`Camera streaming error: ${e.message}`, 'error');
    }
  }

  function stopCameraStreaming() {
    CameraHandler.stopCapture();
    ui.btnCameraToggle.textContent = 'Start Streaming';
    ui.btnCameraToggle.classList.remove('btn--camera-active');
    ui.cameraFpsBadge.hidden = true;
    ui.cameraStreamingIndicator.hidden = true;

    if (cameraFpsIntervalId) {
      clearInterval(cameraFpsIntervalId);
      cameraFpsIntervalId = null;
    }
  }

  // ===========================
  // Wire Events
  // ===========================

  ui.btnCheckAll.addEventListener('click', runAllChecks);
  ui.btnTestSpeaker.addEventListener('click', testSpeaker);
  ui.btnConnect.addEventListener('click', handleConnect);
  ui.chatForm.addEventListener('submit', handleSendMessage);
  ui.btnMic.addEventListener('click', toggleMic);
  ui.btnCameraToggle.addEventListener('click', toggleCameraStreaming);

  // Initialize the output visualizer bars on load
  initOutputVisualizer();

  window.addEventListener('beforeunload', () => {
    Hardware.cleanup();
    AudioHandler.stopStreaming();
    CameraHandler.stopCapture();
    GeminiClient.disconnect();
    if (outputVizAnimId) cancelAnimationFrame(outputVizAnimId);
    if (cameraFpsIntervalId) clearInterval(cameraFpsIntervalId);
  });
})();
