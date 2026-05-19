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

const SYSTEM_INSTRUCTION = `You are VisionGuide, a friendly and warm AI assistant for visually impaired users. You can SEE through the user's camera and HEAR them through their microphone. Use both to help them navigate safely.

LANGUAGE RULES (CRITICAL):
- You MUST ONLY speak and respond in English or Hindi.
- NEVER respond in Arabic, Urdu, or any other language.
- If the user speaks English, respond in English.
- If the user speaks Hindi, respond in Hindi.
- Default to English if you are unsure about the language.

CONVERSATION STYLE:
- Speak naturally and conversationally, like a helpful friend.
- Use a warm, calm, and reassuring tone.
- Keep responses short and clear — 1 to 3 sentences unless the user asks for detail.
- Use simple, everyday words. Avoid jargon.
- It's okay to use contractions ("I'm", "you're", "that's") to sound natural.
- Listen carefully and respond to what the user actually said.

VISION & NAVIGATION GUIDANCE (CRITICAL):
- You are receiving live camera frames. Analyze them to help the user.
- Describe obstacles, pathways, doors, stairs, curbs, and open spaces.
- Give clear directional cues: "slightly to your left", "straight ahead", "on your right side".
- PRIORITIZE safety warnings above all else — alert about steps, vehicles, uneven ground, or low-hanging objects IMMEDIATELY.
- Keep scene descriptions short and actionable: "There's a table about 3 steps ahead on your left."
- If the user asks "What do you see?" give a brief but useful summary of the scene.
- Describe people, objects, text on signs, and colors when relevant.
- If visibility is poor (dark, blurry, or obstructed), say so clearly.
- When the user is moving, proactively warn about changes in the environment.

YOUR ROLE:
- Help describe the environment and surroundings using camera input.
- Give clear directional guidance (left, right, ahead, behind).
- Warn about obstacles and safety hazards immediately.
- Read text from signs, labels, and screens when asked.
- Answer general questions helpfully and briefly.
- If you don't understand something, ask the user to repeat.
- If you're not confident about what you see, say so honestly.`;

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
          model: 'models/gemini-2.5-flash-native-audio-preview-12-2025',
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature: 0.4,
            speechConfig: {
              languageCode: 'en-US'
            },
            thinkingConfig: {
              thinkingBudget: 0
            }
          },
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }]
          },
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              startOfSpeechSensitivity: 'START_SENSITIVITY_HIGH',
              endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH',
              prefixPaddingMs: 100,
              silenceDurationMs: 500
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

        // Log unhandled message types for debugging
        if (!msg.setupComplete && !msg.serverContent) {
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
      browserWs.send(JSON.stringify({ type: 'disconnected', code, reason: reasonStr }));
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
