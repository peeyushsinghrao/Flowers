/* ===========================================================
   Recorder — records the composited canvas (video + flower
   effects) + microphone audio, chunked every N minutes for
   incremental Supabase upload, with a safety-ceiling max
   duration. Finalizes and saves (local download + Supabase)
   on explicit Stop OR when the tab is actually closed/hidden
   long enough to be considered gone.

   IMPORTANT BROWSER LIMITATION (by design, not a bug):
   A browser tab cannot keep recording after it has actually
   been closed — all JS execution and camera/mic access stops
   the instant the tab is gone. "Keep recording on close" is
   implemented here as "auto-finalize whatever was captured
   up to the moment the tab starts closing," using pagehide /
   beforeunload + sendBeacon-style best-effort delivery. A hard
   crash or force-quit cannot be caught by any web API.
=========================================================== */
class SessionRecorder {
  constructor({ canvas, videoEl, onStatus, onTimerUpdate }){
    this.canvas = canvas;               // the composited output canvas (drawn every frame by main.js)
    this.videoEl = videoEl;
    this.onStatus = onStatus || (() => {});
    this.onTimerUpdate = onTimerUpdate || (() => {});

    this.mediaRecorder = null;
    this.micStream = null;
    this.combinedStream = null;
    this.chunks = [];             // buffer for the CURRENT (not-yet-uploaded) chunk
    this.chunkIndex = 0;
    this.sessionId = null;
    this.mimeType = null;

    this.isRecording = false;
    this.startTime = null;
    this.timerInterval = null;
    this.maxDurationTimeout = null;

    this._boundFinalizeOnUnload = this._finalizeOnUnload.bind(this);
  }

  _pickMimeType(){
    for (const mt of CONFIG.RECORD_MIME_CANDIDATES){
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(mt)) return mt;
    }
    return '';
  }

  async _getMicStream(){
    if (this.micStream) return this.micStream;
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return this.micStream;
  }

  async start(){
    if (this.isRecording) return;

    let micStream;
    try {
      micStream = await this._getMicStream();
    } catch(e){
      this.onStatus('mic-denied', e);
      // Continue without audio rather than blocking recording entirely.
      micStream = null;
    }

    const canvasStream = this.canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];
    if (micStream) tracks.push(...micStream.getAudioTracks());
    this.combinedStream = new MediaStream(tracks);

    this.mimeType = this._pickMimeType();
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined;

    try {
      this.mediaRecorder = new MediaRecorder(this.combinedStream, options);
    } catch(e){
      this.onStatus('start-error', e);
      return;
    }

    this.sessionId = `session_${Date.now()}`;
    this.chunkIndex = 0;
    this.chunks = [];
    this.isRecording = true;
    this.startTime = Date.now();

    this.mediaRecorder.ondataavailable = (evt) => {
      if (evt.data && evt.data.size > 0){
        this.chunks.push(evt.data);
        // Each timeslice boundary hands us a complete chunk of buffered data;
        // upload it immediately rather than waiting for a separate timer.
        this._flushChunk(false);
      }
    };

    this.mediaRecorder.onstop = () => {
      this._flushChunk(true);
    };

    // Fire dataavailable automatically every RECORD_CHUNK_MS — this is what
    // lets us upload incrementally instead of one giant blob at the end.
    this.mediaRecorder.start(CONFIG.RECORD_CHUNK_MS);

    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      this.onTimerUpdate(elapsed);
    }, 1000);

    this.maxDurationTimeout = setTimeout(() => {
      this.onStatus('max-duration-reached');
      this.stop();
    }, CONFIG.RECORD_MAX_MS);

    window.addEventListener('pagehide', this._boundFinalizeOnUnload);
    window.addEventListener('beforeunload', this._boundFinalizeOnUnload);
    document.addEventListener('visibilitychange', this._visibilityHandler = () => {
      // Backgrounding/tab-switching does NOT stop recording — only real close does.
      // This handler exists as a hook point if we want future "still recording"
      // reminders when the user returns to the tab.
    });

    this.onStatus('started');
  }

  // Upload whatever is currently buffered as one chunk file, without stopping recording.
  // NOTE: with MediaRecorder, only the FIRST chunk contains full container headers;
  // subsequent chunks are valid WebM *fragments* but won't play standalone in most
  // players (e.g. double-click in Finder). They are still byte-correct and, when
  // concatenated in order, play back fine — which is exactly how the final local
  // download is built (_saveLocalFinal concatenates all parts). If you need each
  // Supabase chunk to be independently playable, the reliable fix is re-muxing
  // server-side (e.g. ffmpeg concat) rather than anything the browser can do alone.
  async _flushChunk(isFinal){
    if (this.chunks.length === 0) return;
    const blobParts = this.chunks;
    this.chunks = [];
    const blob = new Blob(blobParts, { type: this.mimeType || 'video/webm' });
    this.chunkIndex += 1;
    const idx = this.chunkIndex;

    this.onStatus(isFinal ? 'finalizing' : 'uploading-chunk', { index: idx });

    const ext = (this.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
    const path = `videos/${this.sessionId}/chunk_${String(idx).padStart(3,'0')}.${ext}`;

    try {
      const client = getSupabaseClient();
      if (client){
        const { error } = await client.storage
          .from(CONFIG.SUPABASE_BUCKET)
          .upload(path, blob, { contentType: this.mimeType || 'video/webm', upsert: false });
        if (error) throw error;
      }
      this.onStatus(isFinal ? 'finalized-uploaded' : 'chunk-uploaded', { index: idx });
    } catch(e){
      console.error('Chunk upload failed', e);
      this.onStatus('chunk-upload-error', { index: idx, error: e });
    }

    // Local save: only the FINAL chunk also gets offered as a full local download,
    // per spec ("save locally on stop"). We keep every chunk blob to concatenate.
    this._allBlobs = (this._allBlobs || []).concat(blobParts);
    if (isFinal){
      this._saveLocalFinal();
    }
  }

  _saveLocalFinal(){
    if (!this._allBlobs || this._allBlobs.length === 0) return;
    const ext = (this.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
    const fullBlob = new Blob(this._allBlobs, { type: this.mimeType || 'video/webm' });
    const url = URL.createObjectURL(fullBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.sessionId}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    this._allBlobs = [];
  }

  _cleanupTimers(){
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.maxDurationTimeout) clearTimeout(this.maxDurationTimeout);
    this.timerInterval = null;
    this.maxDurationTimeout = null;
  }

  stop(){
    if (!this.isRecording) return;
    this.isRecording = false;
    this._cleanupTimers();

    window.removeEventListener('pagehide', this._boundFinalizeOnUnload);
    window.removeEventListener('beforeunload', this._boundFinalizeOnUnload);
    if (this._visibilityHandler) document.removeEventListener('visibilitychange', this._visibilityHandler);

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive'){
      this.mediaRecorder.requestData(); // flush any pending buffered data first
      this.mediaRecorder.stop();
    }

    if (this.micStream){
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }

    this.onStatus('stopped');
  }

  // Best-effort finalize when the tab is actually closing. We cannot upload a
  // large multi-minute blob reliably during unload (browsers cut network
  // requests off), so this focuses on flushing whatever the recorder already
  // has buffered as fast as possible; already-uploaded chunks are safe in
  // Supabase regardless of how this final flush goes.
  _finalizeOnUnload(){
    if (!this.isRecording) return;
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive'){
        this.mediaRecorder.requestData();
        this.mediaRecorder.stop();
      }
    } catch(e){
      // best effort only
    }
    this.isRecording = false;
    this._cleanupTimers();
  }

  getElapsedMs(){
    if (!this.startTime) return 0;
    return Date.now() - this.startTime;
  }
}

function formatElapsed(ms){
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
