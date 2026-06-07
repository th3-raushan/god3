/**
 * Safety Layer — connection health monitoring, emergency fallback,
 * and safety-critical features for blind navigation assistance.
 *
 * Provides:
 * - Browser Speech Synthesis fallback when Gemini is unreachable
 * - Emergency stop trigger (button + Space key)
 * - Connection loss / reconnection notifications via TTS
 * - Keyboard shortcuts: Space = emergency stop, M = toggle mic
 */
const Safety = (() => {
  const MESSAGES = {
    connectionLost: 'Connection lost. Please stop and stay where you are.',
    connectionError: 'System error. Please stop moving and wait.',
    emergencyStop: 'Emergency stop activated. Please stay where you are.',
    reconnecting: 'Reconnecting. Please wait.',
    reconnected: 'Connection restored. You may continue.',
  };

  let active = false;
  let emergencyStopped = false;
  let spokenReconnecting = false;
  let callbacks = {};
  let keyHandler = null;

  // ──────────────────────────────────────
  // Speech Synthesis (offline fallback)
  // ──────────────────────────────────────

  /**
   * Speak a message using browser Speech Synthesis.
   * This is the safety fallback when Gemini audio is unavailable.
   */
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.lang = 'en-US';
    window.speechSynthesis.speak(utterance);
  }

  // ──────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────

  /**
   * Start the safety layer when a session begins.
   * @param {Object} cbs - { onEmergencyStop, onToggleMic }
   */
  function start(cbs = {}) {
    callbacks = cbs;
    active = true;
    emergencyStopped = false;
    spokenReconnecting = false;
    bindKeyboard();
  }

  /**
   * Stop the safety layer when a session ends.
   */
  function stop() {
    active = false;
    emergencyStopped = false;
    spokenReconnecting = false;
    unbindKeyboard();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  // ──────────────────────────────────────
  // Emergency Stop
  // ──────────────────────────────────────

  /**
   * Trigger an emergency stop — speaks a warning and notifies the app.
   */
  function triggerEmergencyStop() {
    if (emergencyStopped) return;
    emergencyStopped = true;
    speak(MESSAGES.emergencyStop);
    if (callbacks.onEmergencyStop) callbacks.onEmergencyStop();
  }

  function isEmergencyStopped() {
    return emergencyStopped;
  }

  function resetEmergency() {
    emergencyStopped = false;
  }

  // ──────────────────────────────────────
  // Connection event handlers
  // ──────────────────────────────────────

  /**
   * Called when the WebSocket connection is lost unexpectedly.
   */
  function handleConnectionLost(reason) {
    if (!active) return;
    const msg = reason
      ? `Connection lost: ${reason}. Please stop and stay where you are.`
      : MESSAGES.connectionLost;
    speak(msg);
  }

  /**
   * Called when a connection error occurs.
   */
  function handleConnectionError(error) {
    if (!active) return;
    speak(MESSAGES.connectionError);
  }

  /**
   * Called when auto-reconnection starts.
   * Only speaks once per reconnection cycle to avoid being annoying.
   */
  function handleReconnecting(detail) {
    if (!active) return;
    if (!spokenReconnecting) {
      speak(MESSAGES.reconnecting);
      spokenReconnecting = true;
    }
  }

  /**
   * Called when reconnection succeeds.
   */
  function handleReconnected() {
    if (!active) return;
    spokenReconnecting = false;
    emergencyStopped = false;
    speak(MESSAGES.reconnected);
  }

  // ──────────────────────────────────────
  // Keyboard shortcuts
  // ──────────────────────────────────────

  /**
   * Bind keyboard shortcuts for accessibility.
   *   Space = Emergency Stop
   *   M     = Toggle Microphone
   */
  function bindKeyboard() {
    unbindKeyboard();
    keyHandler = (e) => {
      // Don't intercept when typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!active) return;

      if (e.code === 'Space') {
        e.preventDefault();
        triggerEmergencyStop();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        if (callbacks.onToggleMic) callbacks.onToggleMic();
      }
    };
    window.addEventListener('keydown', keyHandler);
  }

  function unbindKeyboard() {
    if (keyHandler) {
      window.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  }

  // ──────────────────────────────────────
  // Public API
  // ──────────────────────────────────────

  return {
    start,
    stop,
    speak,
    triggerEmergencyStop,
    isEmergencyStopped,
    resetEmergency,
    handleConnectionLost,
    handleConnectionError,
    handleReconnecting,
    handleReconnected,
  };
})();
