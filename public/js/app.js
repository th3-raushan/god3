/**
 * Main application orchestrator — Gemini Live Style UI.
 * Single-button start: connects Gemini + starts mic + starts camera.
 * Bottom controls for mic/camera toggle and session end.
 */
(() => {
  const $ = id => document.getElementById(id);

  const ui = {
    liveBadge:      $('live-badge'),
    cameraFeed:     $('camera-feed'),
    viewportGlow:   $('viewport-glow'),
    idleScreen:     $('idle-screen'),
    btnStart:       $('btn-start'),
    transcript:     $('transcript'),
    transcriptText: $('transcript-text'),
    voiceIndicator: $('voice-indicator'),
    voiceLabel:     $('voice-label'),
    toast:          $('toast'),
    toastText:      $('toast-text'),
    controls:       $('controls'),
    btnMic:         $('btn-mic'),
    btnCam:         $('btn-cam'),
    btnEnd:         $('btn-end'),
    btnEmergency:   $('btn-emergency')
  };

  let sessionActive = false;
  let micActive = false;
  let camActive = false;
  let aiSpeaking = false;
  let toastTimer = null;
  let transcriptTimer = null;
  let backgroundCaptureTimer = null;

  // ===========================
  // Toast messages
  // ===========================
  function showToast(msg, duration = 3000) {
    ui.toastText.textContent = msg;
    ui.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, duration);
  }

  // ===========================
  // Voice activity indicator
  // ===========================
  function setVoiceState(state) {
    ui.voiceIndicator.className = 'voice-indicator';

    switch (state) {
      case 'listening':
        ui.voiceIndicator.hidden = false;
        ui.voiceIndicator.classList.add('vi--listening');
        ui.voiceLabel.textContent = 'Listening';
        ui.viewportGlow.className = 'viewport__glow glow--listening';
        break;
      case 'speaking':
        ui.voiceIndicator.hidden = false;
        ui.voiceIndicator.classList.add('vi--speaking');
        ui.voiceLabel.textContent = 'AI Speaking';
        ui.viewportGlow.className = 'viewport__glow glow--speaking';
        break;
      default:
        ui.voiceIndicator.hidden = true;
        ui.viewportGlow.className = 'viewport__glow';
        break;
    }
  }

  // ===========================
  // Transcription
  // ===========================
  function showTranscript(text) {
    ui.transcriptText.textContent = text;
    ui.transcript.hidden = false;
    if (transcriptTimer) clearTimeout(transcriptTimer);
  }

  function hideTranscript(delay = 4000) {
    if (transcriptTimer) clearTimeout(transcriptTimer);
    transcriptTimer = setTimeout(() => {
      ui.transcript.hidden = true;
      ui.transcriptText.textContent = '';
    }, delay);
  }

  // ===========================
  // Session start
  // ===========================
  async function startSession() {
    ui.btnStart.disabled = true;

    // 1. Check camera
    showToast('Checking camera…', 10000);
    const cam = await Hardware.checkCamera();
    if (!cam.ok) {
      showToast('Camera error: ' + cam.error, 5000);
      ui.btnStart.disabled = false;
      return;
    }

    // 2. Check mic
    showToast('Checking microphone…', 10000);
    const mic = await Hardware.checkMicrophone();
    if (!mic.ok) {
      showToast('Microphone error: ' + mic.error, 5000);
      ui.btnStart.disabled = false;
      return;
    }

    // 3. Show camera feed
    ui.cameraFeed.srcObject = Hardware.getCameraStream();
    ui.cameraFeed.classList.add('visible');

    // 4. Init camera handler
    CameraHandler.init(ui.cameraFeed);

    // 5. Connect to Gemini
    showToast('Connecting to Gemini…', 15000);

    AudioHandler.ensureContext();

    GeminiClient.connect({
      onStatus: (state, detail) => handleConnectionStatus(state, detail),
      onText: () => {},
      onAudio: (data) => handleAudio(data),
      onInputTranscription: (text) => handleInputTranscription(text),
      onOutputTranscription: (text) => handleOutputTranscription(text),
      onTurnComplete: () => handleTurnComplete(),
      onInterrupted: () => handleInterrupted()
    });
  }

  function handleConnectionStatus(state, detail) {
    switch (state) {
      case 'connecting':
        showToast('Connecting…', 15000);
        break;

      case 'connected':
        ui.toast.hidden = true;

        if (sessionActive) {
          // Reconnection — restart streams
          Safety.handleReconnected();
          showToast('Reconnected!', 3000);
          startMic();
          startCam();
        } else {
          // First connection
          sessionActive = true;
          ui.idleScreen.hidden = true;
          ui.controls.hidden = false;
          ui.liveBadge.hidden = false;
          ui.btnEmergency.hidden = false;

          // Start safety layer with keyboard shortcuts
          Safety.start({
            onEmergencyStop: () => endSession(),
            onToggleMic: () => toggleMic(),
          });

          startMic();
          startCam();
        }
        break;

      case 'reconnecting':
        showToast(detail || 'Reconnecting…', 20000);
        Safety.handleReconnecting(detail);
        // Pause streams while connection is down
        AudioHandler.stopStreaming();
        stopCam();
        micActive = false;
        setVoiceState('inactive');
        break;

      case 'failed':
        showToast(detail || 'Connection failed permanently', 8000);
        Safety.handleConnectionLost(detail);
        resetSession();
        break;

      case 'disconnected':
        showToast('Disconnected', 4000);
        resetSession();
        break;

      case 'error':
        showToast(detail || 'Connection failed', 6000);
        resetSession();
        break;
    }
  }

  // ===========================
  // Session end / reset
  // ===========================
  function endSession() {
    Safety.stop();
    AudioHandler.stopStreaming();
    AudioHandler.stopPlayback();
    CameraHandler.stopCapture();
    GeminiClient.disconnect();
    resetSession();
  }

  function resetSession() {
    sessionActive = false;
    micActive = false;
    camActive = false;
    aiSpeaking = false;
    if (backgroundCaptureTimer) { clearInterval(backgroundCaptureTimer); backgroundCaptureTimer = null; }

    ui.cameraFeed.classList.remove('visible');
    ui.cameraFeed.srcObject = null;
    ui.controls.hidden = true;
    ui.liveBadge.hidden = true;
    ui.transcript.hidden = true;
    ui.idleScreen.hidden = false;
    ui.btnStart.disabled = false;
    ui.btnMic.classList.remove('is-muted');
    ui.btnCam.classList.remove('is-muted');
    ui.btnEmergency.hidden = true;

    setVoiceState('inactive');
    Hardware.cleanup();
  }

  // ===========================
  // Mic toggle
  // ===========================
  async function startMic() {
    try {
      await AudioHandler.startStreaming((base64Chunk) => {
        GeminiClient.sendAudio(base64Chunk);
      });
      micActive = true;
      ui.btnMic.classList.remove('is-muted');
      if (!aiSpeaking) setVoiceState('listening');
    } catch (e) {
      showToast('Mic error: ' + e.message);
    }
  }

  function stopMic() {
    AudioHandler.stopStreaming();
    AudioHandler.stopPlayback();
    micActive = false;
    ui.btnMic.classList.add('is-muted');
    if (!aiSpeaking) setVoiceState('inactive');
  }

  function toggleMic() {
    AudioHandler.ensureContext();
    if (micActive) {
      stopMic();
    } else {
      startMic();
    }
  }

  // ===========================
  // Camera (on-demand frame capture)
  // ===========================

  /** Send a single frame to Gemini for visual context. */
  function sendFrame() {
    if (!camActive) return;
    CameraHandler.captureOnDemand((base64Frame) => {
      GeminiClient.sendVideo(base64Frame);
    });
  }

  function startCam() {
    camActive = true;
    ui.btnCam.classList.remove('is-muted');
    // Send initial frame for context
    sendFrame();
    // Background capture every 5s for passive scene awareness
    if (backgroundCaptureTimer) clearInterval(backgroundCaptureTimer);
    backgroundCaptureTimer = setInterval(() => sendFrame(), 5000);
  }

  function stopCam() {
    camActive = false;
    ui.btnCam.classList.add('is-muted');
    if (backgroundCaptureTimer) { clearInterval(backgroundCaptureTimer); backgroundCaptureTimer = null; }
  }

  function toggleCam() {
    if (camActive) {
      stopCam();
    } else {
      startCam();
    }
  }

  // ===========================
  // Gemini response handlers
  // ===========================
  function handleAudio(base64Data) {
    if (!aiSpeaking) {
      aiSpeaking = true;
      setVoiceState('speaking');
    }
    AudioHandler.playChunk(base64Data);
  }

  function handleInputTranscription(text) {
    showTranscript('You: ' + text);
    sendFrame(); // Send a fresh frame so Gemini has current visual context
  }

  function handleOutputTranscription(text) {
    showTranscript(text);
  }

  function handleTurnComplete() {
    aiSpeaking = false;
    if (micActive) {
      setVoiceState('listening');
    } else {
      setVoiceState('inactive');
    }
    hideTranscript(4000);
  }

  function handleInterrupted() {
    AudioHandler.stopPlayback();
    aiSpeaking = false;
    if (micActive) {
      setVoiceState('listening');
    } else {
      setVoiceState('inactive');
    }
  }

  // ===========================
  // Wire events
  // ===========================
  ui.btnStart.addEventListener('click', startSession);
  ui.btnMic.addEventListener('click', toggleMic);
  ui.btnCam.addEventListener('click', toggleCam);
  ui.btnEnd.addEventListener('click', endSession);
  ui.btnEmergency.addEventListener('click', () => Safety.triggerEmergencyStop());

  window.addEventListener('beforeunload', () => {
    if (sessionActive) {
      AudioHandler.stopStreaming();
      CameraHandler.stopCapture();
      GeminiClient.disconnect();
      Hardware.cleanup();
    }
  });
})();
