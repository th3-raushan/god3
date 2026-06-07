const express = require('express');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const GEMINI_WS_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const SYSTEM_INSTRUCTION = `You are VisionGuide, a friendly AI assistant for visually impaired users. You see through the user's camera and hear through their mic.

LANGUAGE: Only English and Hindi. Mirror the user's language. If unsure, use English. Never use any other language.

STYLE: Short, clear, conversational. 1-2 sentences max. Warm and calm tone.

VISION: You receive live camera frames. Describe obstacles, paths, doors, stairs. Give directions: left, right, ahead. Prioritize safety warnings. Keep it actionable. Read signs when asked. Say if you can't see clearly.`;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (browserWs) => {
  console.log('[WSS] Browser connected');

  let geminiWs = null;
  let setupDone = false;

  function connectGemini() {
    if (!GEMINI_KEY) {
      browserWs.send(JSON.stringify({ type: 'error', message: 'GEMINI_API_KEY not configured on server. Create a .env file.' }));
      return;
    }

    const url = `${GEMINI_WS_URL}?key=${GEMINI_KEY}`;
    geminiWs = new WebSocket(url);

    geminiWs.on('open', () => {
      console.log('[Gemini] WebSocket connected');

      const setupMsg = {
        setup: {
          model: 'models/gemini-3.1-flash-live-preview',
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature: 0.3,
          },
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }]
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 20,
              silenceDurationMs: 200
            }
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {}
        }
      };

      console.log('[Gemini] Sending setup:', JSON.stringify(setupMsg).substring(0, 300));
      geminiWs.send(JSON.stringify(setupMsg));
      console.log('[Gemini] Setup message sent');
    });

    geminiWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.setupComplete) {
          setupDone = true;
          console.log('[Gemini] Setup complete');
          browserWs.send(JSON.stringify({ type: 'connected' }));
          return;
        }

        if (msg.serverContent) {
          const parts = msg.serverContent.modelTurn?.parts || [];
          const turnComplete = msg.serverContent.turnComplete || false;
          const interrupted = msg.serverContent.interrupted || false;

          // If Gemini interrupted its own output (user started speaking), notify browser
          if (interrupted) {
            browserWs.send(JSON.stringify({ type: 'interrupted' }));
          }

          for (const part of parts) {
            // Skip thinking/reasoning parts — they add latency text we don't need
            if (part.thought) continue;

            if (part.text) {
              browserWs.send(JSON.stringify({ type: 'text', text: part.text }));
            }
            if (part.inlineData) {
              browserWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
            }
          }

          if (msg.serverContent.outputTranscription?.text) {
            browserWs.send(JSON.stringify({ type: 'outputTranscription', text: msg.serverContent.outputTranscription.text }));
          }

          if (msg.serverContent.inputTranscription?.text) {
            browserWs.send(JSON.stringify({ type: 'inputTranscription', text: msg.serverContent.inputTranscription.text }));
          }

          if (turnComplete) {
            browserWs.send(JSON.stringify({ type: 'turnComplete' }));
          }
        }

        // Log unhandled message types for debugging (skip routine session resumption updates)
        if (!msg.setupComplete && !msg.serverContent && !msg.sessionResumptionUpdate) {
          console.log('[Gemini] Other message:', JSON.stringify(msg).substring(0, 200));
        }
      } catch (e) {
        console.error('[Gemini] Parse error:', e.message);
      }
    });

    geminiWs.on('close', (code, reason) => {
      const reasonStr = reason ? reason.toString() : 'no reason';
      console.log(`[Gemini] Closed: code=${code} reason=${reasonStr}`);
      setupDone = false;

      // Send error for non-normal closes so the browser can display the reason
      if (code !== 1000) {
        browserWs.send(JSON.stringify({ type: 'error', message: `Gemini closed (${code}): ${reasonStr}` }));
      } else {
        browserWs.send(JSON.stringify({ type: 'disconnected', code, reason: reasonStr }));
      }
    });

    geminiWs.on('error', (err) => {
      console.error('[Gemini] Error:', err.message);
      browserWs.send(JSON.stringify({ type: 'error', message: err.message }));
    });
  }

  browserWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'connect') {
        connectGemini();
        return;
      }

      if (msg.type === 'text' && setupDone && geminiWs?.readyState === WebSocket.OPEN) {
        const payload = {
          clientContent: {
            turns: [{
              role: 'user',
              parts: [{ text: msg.text }]
            }],
            turnComplete: true
          }
        };
        geminiWs.send(JSON.stringify(payload));
        return;
      }

      if (msg.type === 'audio' && setupDone && geminiWs?.readyState === WebSocket.OPEN) {
        const payload = {
          realtimeInput: {
            audio: {
              mimeType: 'audio/pcm;rate=16000',
              data: msg.data
            }
          }
        };
        geminiWs.send(JSON.stringify(payload));
        return;
      }

      if (msg.type === 'video' && setupDone && geminiWs?.readyState === WebSocket.OPEN) {
        const payload = {
          realtimeInput: {
            video: {
              mimeType: 'image/jpeg',
              data: msg.data
            }
          }
        };
        geminiWs.send(JSON.stringify(payload));
        return;
      }
    } catch (e) {
      console.error('[WSS] Browser message parse error:', e.message);
    }
  });

  browserWs.on('close', () => {
    console.log('[WSS] Browser disconnected');
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  });
});

server.listen(PORT, () => {
  console.log(`VisionGuide server running → http://localhost:${PORT}`);
});
