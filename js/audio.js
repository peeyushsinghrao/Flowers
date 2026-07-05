/* ===========================================================
   Audio — soft synthesized chime, no external sound files.
   Only plays if the user has enabled the sound toggle.
=========================================================== */
const AppAudio = (function(){
  let ctx = null;
  let enabled = false;
  let hasChimedThisBloom = false;

  function ensureContext(){
    if (!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended'){
      ctx.resume();
    }
    return ctx;
  }

  function setEnabled(val){
    enabled = val;
    if (enabled) ensureContext();
  }

  // A gentle two-note bell, built from sine oscillators with a soft envelope.
  function playBloomChime(){
    if (!enabled) return;
    const ac = ensureContext();
    if (!ac) return;

    const now = ac.currentTime;
    const notes = [880, 1318.5]; // A5, E6 — a soft open fifth

    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const start = now + i * 0.09;
      const attack = 0.02;
      const decay = 1.1;

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.14, start + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);

      osc.connect(gain);
      gain.connect(ac.destination);

      osc.start(start);
      osc.stop(start + attack + decay + 0.05);
    });
  }

  // Small click/pluck sound for petal-plucking, very short & soft.
  function playPluck(){
    if (!enabled) return;
    const ac = ensureContext();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.15);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  // Called every frame with current bloom value; fires chime once per bloom cycle.
  function onBloomUpdate(bloomValue){
    if (bloomValue > 0.92 && !hasChimedThisBloom){
      hasChimedThisBloom = true;
      playBloomChime();
    }
    if (bloomValue < 0.3){
      hasChimedThisBloom = false; // re-arm for the next bloom
    }
  }

  return { setEnabled, playBloomChime, playPluck, onBloomUpdate };
})();
