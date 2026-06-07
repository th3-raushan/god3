/**
 * Gemini WebSocket client — browser side.
 * Connects to local server /ws, which proxies to Gemini Live API.
 * Includes auto-reconnect with exponential backoff.
 */
const GeminiClient = (() => {
  let ws = null;
  let storedCallbacks = {};
  let reconnectEnabled = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  const MAX_RECONNECTS = 5;
  const BASE_DELAY_MS = 1500;
  const MAX_DELAY_MS = 15000;

  // Active callback references
  let onText, onTurnComplete, onStatus, onAudio;
  let onInputTranscription, onOutputTranscription, onInterrupted;

  /**
   * Connect to the server WebSocket and establish a Gemini session.
   * @param {Object} callbacks - Event callbacks
   */
  function connect(callbacks = {}) {
    storedCallbacks = callbacks;
    reconnectAttempts = 0;
    reconnectEnabled = true;
    _openSocket();
  }

  /**
   * Internal — create a new WebSocket connection.
   * Uses a local `socket` reference so stale close/message handlers
   * from old connections don't interfere with new ones.
   */
  function _openSocket() {
    // Clean up any existing connection
    if (ws) { try { ws.close(); } catch (_) {} }
    ws = null;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

    _assignCallbacks(storedCallbacks);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;

    // Only show 'connecting' on the initial connection, not during reconnects
    if (reconnectAttempts === 0) {
      onStatus('connecting');
    }

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      _scheduleReconnect();
      return;
    }
    ws = socket;

    socket.addEventListener('open', () => {
      // Tell the server to open a Gemini session
      socket.send(JSON.stringify({ type: 'connect' }));
    });

    socket.addEventListener('message', (evt) => {
      // Ignore messages from stale sockets
      if (ws !== socket) return;

      try {
        const msg = JSON.parse(evt.data);

        switch (msg.type) {
          case 'connected':
            reconnectAttempts = 0;
            onStatus('connected');
            break;
          case 'text':
            onText(msg.text);
            break;
          case 'audio':
            onAudio(msg.data);
            break;
          case 'inputTranscription':
            onInputTranscription(msg.text);
            break;
          case 'outputTranscription':
            onOutputTranscription(msg.text);
            break;
          case 'turnComplete':
            onTurnComplete();
            break;
          case 'interrupted':
            onInterrupted();
            break;
          case 'disconnected':
          case 'error':
            // Gemini session ended on the server side — attempt reconnect
            if (reconnectEnabled) {
              _scheduleReconnect();
            } else {
              onStatus(msg.type === 'error' ? 'error' : 'disconnected', msg.message);
            }
            break;
        }
      } catch (e) {
        console.error('[GeminiClient] Parse error:', e);
      }
    });

    socket.addEventListener('close', () => {
      // Ignore close events from stale sockets
      if (ws !== socket) return;
      ws = null;

      if (reconnectEnabled) {
        _scheduleReconnect();
      } else {
        onStatus('disconnected');
      }
    });

    socket.addEventListener('error', () => {
      // The 'close' event always follows — reconnection is handled there
    });
  }

  function _assignCallbacks(cbs) {
    onText = cbs.onText || (() => {});
    onTurnComplete = cbs.onTurnComplete || (() => {});
    onStatus = cbs.onStatus || (() => {});
    onAudio = cbs.onAudio || (() => {});
    onInputTranscription = cbs.onInputTranscription || (() => {});
    onOutputTranscription = cbs.onOutputTranscription || (() => {});
    onInterrupted = cbs.onInterrupted || (() => {});
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   */
  function _scheduleReconnect() {
    if (!reconnectEnabled) return;
    if (reconnectTimer) return; // Already scheduled

    if (reconnectAttempts >= MAX_RECONNECTS) {
      reconnectEnabled = false;
      onStatus('failed', `Unable to reconnect after ${MAX_RECONNECTS} attempts`);
      return;
    }

    reconnectAttempts++;
    const delay = Math.min(BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1), MAX_DELAY_MS);

    onStatus('reconnecting', `Attempt ${reconnectAttempts}/${MAX_RECONNECTS}`);

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      _openSocket();
    }, delay);
  }

  function sendText(text) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'text', text }));
      return true;
    }
    return false;
  }

  function sendAudio(base64Data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'audio', data: base64Data }));
    }
  }

  function sendVideo(base64JpegData) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'video', data: base64JpegData }));
    }
  }

  /**
   * Intentionally disconnect — disables auto-reconnect.
   */
  function disconnect() {
    reconnectEnabled = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { ws.close(); ws = null; }
  }

  function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  return { connect, sendText, sendAudio, sendVideo, disconnect, isConnected };
})();
