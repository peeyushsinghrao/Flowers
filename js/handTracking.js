/* ===========================================================
   HandTracking — wires MediaPipe Hands to landmark smoothing
   and exposes simple per-frame "readings" for the app to use.
   Detection runs at whatever rate MediaPipe manages; rendering
   is decoupled and runs on its own requestAnimationFrame loop
   (see main.js) so the UI never stutters even if detection lags.
=========================================================== */
class HandTracker {
  constructor(videoEl, { onResults, modelComplexity = 1 } = {}){
    this.video = videoEl;
    this.onResultsCallback = onResults;
    this.leftSmoother = new LandmarkSmoother(21, { minCutoff: 0.9, beta: 0.5 });
    this.rightSmoother = new LandmarkSmoother(21, { minCutoff: 0.9, beta: 0.5 });

    this.hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    this.hands.onResults((results) => this._handleResults(results));

    this.ready = false;
    this.processing = false;
    this.rafId = null;
  }

  async initialize(){
    await this.hands.initialize();
    this.ready = true;
  }

  _handleResults(results){
    let leftLm = null, rightLm = null; // raw-frame handedness (see note below)
    const now = performance.now();

    if (results.multiHandLandmarks && results.multiHandedness){
      results.multiHandLandmarks.forEach((lm, i) => {
        const handedness = results.multiHandedness[i].label; // 'Left' or 'Right' in the RAW (unmirrored) frame
        // Camera output is mirrored for on-screen display, so MediaPipe's
        // "Left" (as seen by the physical sensor) corresponds to the
        // PERSON'S actual right hand once mirrored on screen — and vice versa.
        if (handedness === 'Left'){
          rightLm = this.rightSmoother.smooth(lm, now);
        } else {
          leftLm = this.leftSmoother.smooth(lm, now);
        }
      });
    }

    if (this.onResultsCallback){
      this.onResultsCallback({ leftLm, rightLm, rawResults: results, timestamp: now });
    }
  }

  startLoop(){
    const loop = async () => {
      if (this.ready && !this.processing && this.video.readyState >= 2){
        this.processing = true;
        try {
          await this.hands.send({ image: this.video });
        } catch(e){
          console.error('HandTracker: send failed', e);
        }
        this.processing = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  stopLoop(){
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}

/* ---------- Small geometry helpers used by main.js ---------- */
const HandMetrics = {
  dist(a, b){
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z||0) - (b.z||0));
  },

  // Openness of a hand: average fingertip distance from the wrist,
  // normalized into a roughly 0..1 range for "closed fist" -> "open hand".
  openness(lm){
    const wrist = lm[0];
    const tips = [8, 12, 16, 20].map(i => lm[i]);
    const avgDist = tips.reduce((s, t) => s + HandMetrics.dist(t, wrist), 0) / tips.length;
    return clamp((avgDist - 0.12) / (0.30 - 0.12), 0, 1);
  },

  // Spread of a hand: thumb-to-pinky distance, normalized 0..1.
  spread(lm){
    const thumb = lm[4];
    const pinky = lm[20];
    const d = HandMetrics.dist(thumb, pinky);
    return clamp((d - 0.05) / (0.28 - 0.05), 0, 1);
  },
};

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];
