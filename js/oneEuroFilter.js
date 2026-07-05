/* ===========================================================
   One-Euro Filter
   Standard low-jitter, low-lag signal smoothing filter,
   commonly used for smoothing noisy hand/pose landmarks.
   Reference algorithm: Casiez, Roussel & Vogel, 2012.
=========================================================== */
class LowPassFilter {
  constructor(){
    this.y = null;
    this.initialized = false;
  }
  filter(value, alpha){
    let result;
    if (!this.initialized){
      result = value;
      this.initialized = true;
    } else {
      result = alpha * value + (1 - alpha) * this.y;
    }
    this.y = result;
    return result;
  }
  lastValue(){ return this.y; }
}

class OneEuroFilter {
  /**
   * @param {number} freq       estimated sampling frequency (Hz)
   * @param {number} minCutoff  minimum cutoff frequency (lower = smoother, more lag)
   * @param {number} beta       speed coefficient (higher = less lag on fast motion)
   * @param {number} dCutoff    cutoff for the derivative filter
   */
  constructor(freq = 30, minCutoff = 1.0, beta = 0.3, dCutoff = 1.0){
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.lastTime = null;
  }

  alpha(cutoff){
    const te = 1.0 / this.freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  filter(value, timestampMs){
    if (this.lastTime != null && timestampMs != null){
      const dt = (timestampMs - this.lastTime) / 1000;
      if (dt > 0) this.freq = 1.0 / dt;
    }
    this.lastTime = timestampMs;

    const prevValue = this.xFilter.lastValue();
    const dx = (prevValue == null) ? 0 : (value - prevValue) * this.freq;
    const edx = this.dxFilter.filter(dx, this.alpha(this.dCutoff));

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(value, this.alpha(cutoff));
  }
}

/**
 * Convenience wrapper: smooths an array of {x,y,z} landmarks,
 * keeping one OneEuroFilter per coordinate per landmark index.
 */
class LandmarkSmoother {
  constructor(numLandmarks = 21, opts = {}){
    const { minCutoff = 0.8, beta = 0.4, dCutoff = 1.0, freq = 30 } = opts;
    this.filters = [];
    for (let i = 0; i < numLandmarks; i++){
      this.filters.push({
        x: new OneEuroFilter(freq, minCutoff, beta, dCutoff),
        y: new OneEuroFilter(freq, minCutoff, beta, dCutoff),
        z: new OneEuroFilter(freq, minCutoff, beta, dCutoff),
      });
    }
  }

  smooth(landmarks, timestampMs){
    return landmarks.map((pt, i) => {
      const f = this.filters[i];
      return {
        x: f.x.filter(pt.x, timestampMs),
        y: f.y.filter(pt.y, timestampMs),
        z: f.z.filter(pt.z || 0, timestampMs),
      };
    });
  }
}
