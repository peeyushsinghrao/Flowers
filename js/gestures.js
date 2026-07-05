/* ===========================================================
   Gestures — debounced fist / pinch / two-hand-cup detection.
   Uses hysteresis + hold-time so a single noisy frame can't
   trigger or cancel a gesture.
=========================================================== */
class GestureDetector {
  constructor(config){
    this.cfg = config;

    // Fist (per hand)
    this.fistHoldStart = { left: null, right: null };
    this.fistActive = { left: false, right: false };

    // Pinch (per hand)
    this.pinchHoldStart = { left: null, right: null };
    this.pinchFired = { left: false, right: false };

    // Two-hand cup
    this.cupHoldStart = null;
    this.cupActive = false;

    // Callbacks (assigned externally)
    this.onFistStart = null;
    this.onFistEnd = null;
    this.onPinch = null;
    this.onCupStart = null;
    this.onCupEnd = null;
  }

  _dist(a, b){
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z||0) - (b.z||0));
  }

  // A fist: all four fingertips close to the palm (near the MCP joints).
  _isFist(lm){
    const wrist = lm[0];
    const tips = [8, 12, 16, 20];
    const mcps = [5, 9, 13, 17];
    let closedCount = 0;
    for (let i = 0; i < 4; i++){
      const tipDist = this._dist(lm[tips[i]], wrist);
      const mcpDist = this._dist(lm[mcps[i]], wrist);
      if (tipDist < mcpDist * 1.15) closedCount++;
    }
    return closedCount >= 3;
  }

  _pinchDistance(lm){
    return this._dist(lm[4], lm[8]); // thumb tip to index tip
  }

  updateHand(label, landmarks, now){
    // --- Fist detection with hold + hysteresis ---
    const isFist = this._isFist(landmarks);
    if (isFist){
      if (this.fistHoldStart[label] == null) this.fistHoldStart[label] = now;
      const held = now - this.fistHoldStart[label];
      if (held >= this.cfg.FIST_HOLD_MS && !this.fistActive[label]){
        this.fistActive[label] = true;
        if (this.onFistStart) this.onFistStart(label);
      }
    } else {
      this.fistHoldStart[label] = null;
      if (this.fistActive[label]){
        this.fistActive[label] = false;
        if (this.onFistEnd) this.onFistEnd(label);
      }
    }

    // --- Pinch detection (fires once per pinch, needs release to re-fire) ---
    const pinchDist = this._pinchDistance(landmarks);
    if (pinchDist < this.cfg.PINCH_DIST){
      if (this.pinchHoldStart[label] == null) this.pinchHoldStart[label] = now;
      const held = now - this.pinchHoldStart[label];
      if (held >= this.cfg.PINCH_HOLD_MS && !this.pinchFired[label]){
        this.pinchFired[label] = true;
        if (this.onPinch) this.onPinch(label);
      }
    } else if (pinchDist > this.cfg.PINCH_DIST * 1.6){
      // require a clear release (hysteresis gap) before re-arming
      this.pinchHoldStart[label] = null;
      this.pinchFired[label] = false;
    }
  }

  // Two-hand cup: both wrists relatively close together, both hands roughly
  // upright/facing camera (approximated via palm openness + proximity).
  updateTwoHands(leftLm, rightLm, now){
    if (!leftLm || !rightLm){
      this.cupHoldStart = null;
      if (this.cupActive){
        this.cupActive = false;
        if (this.onCupEnd) this.onCupEnd();
      }
      return;
    }

    const leftWrist = leftLm[0];
    const rightWrist = rightLm[0];
    const handDist = this._dist(leftWrist, rightWrist);

    const closeEnough = handDist < this.cfg.CUP_MAX_HAND_DIST;

    if (closeEnough){
      if (this.cupHoldStart == null) this.cupHoldStart = now;
      const held = now - this.cupHoldStart;
      if (held >= this.cfg.CUP_HOLD_MS && !this.cupActive){
        this.cupActive = true;
        if (this.onCupStart) this.onCupStart();
      }
    } else {
      this.cupHoldStart = null;
      if (this.cupActive){
        this.cupActive = false;
        if (this.onCupEnd) this.onCupEnd();
      }
    }
  }

  isAnyFistActive(){
    return this.fistActive.left || this.fistActive.right;
  }
}
