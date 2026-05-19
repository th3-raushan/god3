/**
 * AudioWorklet processor — downsample browser mic to 16kHz Int16 PCM.
 * Runs in a dedicated audio thread for zero-latency processing.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._sampleCounter = 0;
    // 320 samples = 20ms at 16kHz — smaller chunks = lower latency
    this._chunkSize = 320;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const ratio = sampleRate / 16000;

    for (let i = 0; i < channel.length; i++) {
      this._sampleCounter++;
      if (this._sampleCounter >= ratio) {
        this._sampleCounter -= ratio;
        const s = Math.max(-1, Math.min(1, channel[i]));
        this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
      }
    }

    while (this._buffer.length >= this._chunkSize) {
      const chunk = new Int16Array(this._buffer.splice(0, this._chunkSize));
      this.port.postMessage({ pcm: chunk.buffer }, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
