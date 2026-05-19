/**
 * Gemini WebSocket client — browser side.
 * Connects to local server /ws, which proxies to Gemini Live API.
 */
const GeminiClient = (() => {
  let ws = null;
  let onText = null;
  let onTurnComplete = null;
  let onStatus = null;
  let onAudio = null;
  let onInputTranscription = null;
  let onOutputTranscription = null;
  let onInterrupted = null;

  function connect(callbacks = {}) {
    onText = callbacks.onText || (() => {});
    onTurnComplete = callbacks.onTurnComplete || (() => {});
    onStatus = callbacks.onStatus || (() => {});
    onAudio = callbacks.onAudio || (() => {});
    onInputTranscription = callbacks.onInputTranscription || (() => {});
    onOutputTranscription = callbacks.onOutputTranscription || (() => {});
    onInterrupted = callbacks.onInterrupted || (() => {});

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;

    onStatus('connecting');
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'connect' }));
    });

    ws.addEventListener('message', (evt) => {
      try {
        const msg = JSON.parse(evt.data);

        switch (msg.type) {
          case 'connected':
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
            onStatus('disconnected');
            break;
          case 'error':
            onStatus('error', msg.message);
            break;
        }
      } catch (e) {
        console.error('[GeminiClient] Parse error:', e);
      }
    });

    ws.addEventListener('close', () => {
      onStatus('disconnected');
      ws = null;
    });

    ws.addEventListener('error', () => {
      onStatus('error', 'WebSocket connection failed');
    });
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

  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function isConnected() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  return { connect, sendText, sendAudio, sendVideo, disconnect, isConnected };
})();

