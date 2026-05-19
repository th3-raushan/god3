/**
 * Camera handler — webcam frame capture and streaming.
 * Captures frames as JPEG using Canvas API and streams to server via WebSocket.
 * Phase 4: Scene understanding for blind navigation.
 */
const CameraHandler = (() => {
  let videoEl = null;
  let canvas = null;
  let ctx = null;
  let captureInterval = null;
  let streaming = false;
  let onFrame = null;
  let fps = 1;                   // Default: 1 frame per second
  let jpegQuality = 0.4;         // JPEG compression quality (lower = faster)
  let targetWidth = 512;
  let targetHeight = 384;
  let frameCount = 0;

  /**
   * Initialize with an existing <video> element that already has a camera stream.
   * @param {HTMLVideoElement} video — the video element with srcObject set
   */
  function init(video) {
    videoEl = video;

    // Create an offscreen canvas for frame extraction
    canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    ctx = canvas.getContext('2d');
  }

  /**
   * Start capturing frames and sending them via callback.
   * @param {Function} frameCallback — receives base64 JPEG string for each frame
   * @param {Object} options — optional { fps, quality }
   */
  function startCapture(frameCallback, options = {}) {
    if (streaming) return;
    if (!videoEl || !videoEl.srcObject) {
      throw new Error('Camera not initialized. Run hardware check first.');
    }

    onFrame = frameCallback;
    fps = options.fps || 1;
    jpegQuality = options.quality || 0.4;
    frameCount = 0;

    streaming = true;

    // Capture at the configured FPS
    const intervalMs = Math.round(1000 / fps);
    captureInterval = setInterval(() => {
      captureFrame();
    }, intervalMs);

    // Capture first frame immediately
    captureFrame();
  }

  /**
   * Capture a single frame from the video element.
   */
  function captureFrame() {
    if (!videoEl || !ctx || !onFrame) return;
    if (videoEl.readyState < 2) return; // Video not ready yet

    // Draw the current video frame to the canvas (resized to target dimensions)
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    // Convert to JPEG base64
    const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
    // Strip the "data:image/jpeg;base64," prefix — server expects raw base64
    const base64 = dataUrl.split(',')[1];

    if (base64 && onFrame) {
      onFrame(base64);
      frameCount++;
    }
  }

  /**
   * Stop capturing frames.
   */
  function stopCapture() {
    if (captureInterval) {
      clearInterval(captureInterval);
      captureInterval = null;
    }
    streaming = false;
    onFrame = null;
    frameCount = 0;
  }

  /**
   * Update the capture FPS on the fly.
   * @param {number} newFps
   */
  function setFps(newFps) {
    fps = Math.max(0.5, Math.min(5, newFps)); // Clamp between 0.5 and 5 FPS

    // If currently streaming, restart with new interval
    if (streaming && onFrame) {
      clearInterval(captureInterval);
      const intervalMs = Math.round(1000 / fps);
      captureInterval = setInterval(() => {
        captureFrame();
      }, intervalMs);
    }
  }

  /**
   * Update JPEG quality on the fly.
   * @param {number} quality — 0.0 to 1.0
   */
  function setQuality(quality) {
    jpegQuality = Math.max(0.3, Math.min(1.0, quality));
  }

  function isStreaming() { return streaming; }
  function getFps() { return fps; }
  function getFrameCount() { return frameCount; }

  return {
    init,
    startCapture,
    stopCapture,
    captureFrame,
    setFps,
    setQuality,
    isStreaming,
    getFps,
    getFrameCount
  };
})();
