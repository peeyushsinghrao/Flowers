/* ===========================================================
   Flower — painterly bezier-petal rendering.
   Two species (tulip / rose), organic watercolor-edge petals,
   layered glow, stem sway physics, wilt animation, plucking.
=========================================================== */
class Flower {
  constructor(x, y, opts = {}){
    this.normX = x;
    this.normY = y;
    this.baseX = x;
    this.baseY = y;
    this.species = opts.species || 'tulip';
    this.seed = Math.random() * 1000;

    // Animation state (all 0..1 unless noted)
    this.grow = 0;
    this.bloom = 0;
    this.wilt = 0;          // 0 = healthy, 1 = fully wilted
    this.targetGrow = 0;
    this.targetBloom = 0;
    this.isWilting = false;

    this.stemSwayPhase = Math.random() * Math.PI * 2;
    this.petals = this._buildPetals();
    this.pluckedPetals = new Set();
    this.scale = opts.scale || 1;

    this._lastTime = performance.now();
  }

  _buildPetals(){
    // Petal descriptors are species-specific; count/shape define the silhouette.
    if (this.species === 'rose'){
      const layers = [
        { count: 5, lenMul: 0.55, widMul: 0.85, angleOffset: 0 },
        { count: 6, lenMul: 0.75, widMul: 1.0, angleOffset: 0.3 },
        { count: 7, lenMul: 0.95, widMul: 1.05, angleOffset: 0.6 },
      ];
      const petals = [];
      layers.forEach((layer, li) => {
        for (let i = 0; i < layer.count; i++){
          petals.push({
            id: `r${li}_${i}`,
            angle: (i / layer.count) * Math.PI * 2 + layer.angleOffset,
            layer: li,
            lenMul: layer.lenMul,
            widMul: layer.widMul,
            wobble: Math.random() * Math.PI * 2,
          });
        }
      });
      return petals;
    }

    // tulip: fewer, larger, upright cupped petals
    const count = 6;
    const petals = [];
    for (let i = 0; i < count; i++){
      petals.push({
        id: `t_${i}`,
        angle: (i / count) * Math.PI * 2,
        layer: i % 2,
        lenMul: 0.9 + (i % 2) * 0.15,
        widMul: 1,
        wobble: Math.random() * Math.PI * 2,
      });
    }
    return petals;
  }

  setTargets(grow, bloom){
    this.targetGrow = grow;
    this.targetBloom = bloom;
  }

  startWilt(){ this.isWilting = true; }
  cancelWilt(){ this.isWilting = false; }

  pluckOnePetal(){
    const available = this.petals.filter(p => !this.pluckedPetals.has(p.id));
    if (available.length === 0) return null;
    const chosen = available[Math.floor(Math.random() * available.length)];
    this.pluckedPetals.add(chosen.id);
    return chosen;
  }

  update(now, particleSystem){
    const dt = Math.min(now - this._lastTime, 50);
    this._lastTime = now;

    if (this.isWilting){
      this.wilt += dt * 0.00045;
      this.wilt = Math.min(this.wilt, 1);
      // Wilting overrides targets — pull grow/bloom down
      this.targetGrow = Math.max(0, 1 - this.wilt) * this.grow;
      this.targetBloom = Math.max(0, 1 - this.wilt) * this.bloom;
      if (this.wilt >= 1){
        this.pluckedPetals.clear();
      }
    } else if (this.wilt > 0){
      this.wilt = Math.max(0, this.wilt - dt * 0.0006);
    }

    // Smooth easing toward targets (critically-damped-ish spring feel)
    const growEase = this.isWilting ? 0.02 : 0.07;
    const bloomEase = this.isWilting ? 0.02 : 0.08;
    this.grow += (this.targetGrow - this.grow) * growEase;
    this.bloom += (this.targetBloom - this.bloom) * bloomEase;

    this.stemSwayPhase += dt * 0.0011;

    if (particleSystem && this.bloom > 0.55){
      const headPos = this.getHeadPosition();
      particleSystem.emitAmbient(headPos.x, headPos.y, this.bloom, dt);
    }
  }

  getHeadPosition(){
    const maxStemLen = this._maxStemLen || 0;
    return { x: this._topX || this.baseX, y: this._topY || this.baseY };
  }

  draw(ctx, dims, dpr){
    this.baseX = this.normX * dims.width;
    this.baseY = this.normY * dims.height;

    const { width: w, height: h } = dims;
    const maxStemLen = h * 0.5 * this.scale;
    const stemLen = maxStemLen * this.grow;
    const sway = Math.sin(this.stemSwayPhase) * 10 * dpr * this.grow * (1 - this.wilt * 0.5);

    const baseX = this.baseX;
    const baseY = this.baseY;
    const wiltDroop = this.wilt * 40 * dpr;
    const topX = baseX + sway * 0.6;
    const topY = baseY - stemLen + wiltDroop;

    this._maxStemLen = maxStemLen;
    this._topX = topX;
    this._topY = topY;

    if (this.grow < 0.01) return;

    ctx.save();

    // --- Glow layer (drawn first, behind everything) ---
    this._drawGlow(ctx, topX, topY, dpr);

    // --- Stem ---
    this._drawStem(ctx, baseX, baseY, topX, topY, sway, dpr);

    // --- Leaves ---
    if (this.grow > 0.3){
      this._drawLeaf(ctx, baseX - 5*dpr, baseY - stemLen*0.32, -1, dpr);
      this._drawLeaf(ctx, baseX + 5*dpr, baseY - stemLen*0.58, 1, dpr);
    }

    // --- Flower head ---
    if (this.grow > 0.12){
      this._drawHead(ctx, topX, topY, dpr);
    }

    ctx.restore();
  }

  _drawGlow(ctx, topX, topY, dpr){
    const intensity = Math.max(this.grow * 0.5, this.bloom) * (1 - this.wilt * 0.7);
    if (intensity < 0.05) return;
    const radius = (55 + this.bloom * 150) * dpr * this.scale;
    const pulse = 1 + Math.sin(performance.now() / 480) * 0.03 * this.bloom;

    const grad = ctx.createRadialGradient(topX, topY, 0, topX, topY, radius * pulse);
    const roseGlow = this.species === 'rose';
    const c1 = roseGlow ? '232,135,154' : '212,165,116';
    grad.addColorStop(0, `rgba(${c1},${0.5 * intensity})`);
    grad.addColorStop(0.5, `rgba(${c1},${0.22 * intensity})`);
    grad.addColorStop(1, `rgba(${c1},0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(topX, topY, radius * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawStem(ctx, baseX, baseY, topX, topY, sway, dpr){
    const wiltFade = 1 - this.wilt * 0.4;
    ctx.strokeStyle = `rgba(127,174,138,${0.95 * wiltFade})`;
    ctx.lineWidth = 5 * dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    const midX = baseX + sway;
    const midY = baseY - (baseY - topY) * 0.5;
    ctx.quadraticCurveTo(midX, midY, topX, topY);
    ctx.stroke();

    // subtle highlight down the stem for a painterly feel
    ctx.strokeStyle = `rgba(180,214,180,${0.35 * wiltFade})`;
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath();
    ctx.moveTo(baseX - 1*dpr, baseY);
    ctx.quadraticCurveTo(midX - 1*dpr, midY, topX - 1*dpr, topY);
    ctx.stroke();
  }

  _drawLeaf(ctx, x, y, dir, dpr){
    const leafGrow = Math.min(1, (this.grow - 0.3) / 0.5);
    if (leafGrow <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dir * 0.55);
    const grad = ctx.createLinearGradient(0, -8*dpr, 0, 8*dpr);
    grad.addColorStop(0, 'rgba(150,196,155,0.9)');
    grad.addColorStop(1, 'rgba(100,150,110,0.9)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, 17*dpr*leafGrow, 7*dpr*leafGrow, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  _drawHead(ctx, topX, topY, dpr){
    ctx.save();
    ctx.translate(topX, topY);

    const openAmt = this.bloom;
    const wiltFade = 1 - this.wilt;

    // draw back-layer petals first (layer index sorting: higher layer = drawn later/on top for rose)
    const sorted = [...this.petals].sort((a,b) => a.layer - b.layer);

    for (const petal of sorted){
      if (this.pluckedPetals.has(petal.id)) continue;
      this._drawSinglePetal(ctx, petal, openAmt, wiltFade, dpr);
    }

    // center
    this._drawCenter(ctx, openAmt, wiltFade, dpr);

    ctx.restore();
  }

  _drawSinglePetal(ctx, petal, openAmt, wiltFade, dpr){
    const isRose = this.species === 'rose';
    const baseLen = (isRose ? 20 : 26) * dpr * petal.lenMul * this.scale;
    const baseWidth = (isRose ? 11 : 13) * dpr * petal.widMul * this.scale;

    const len = baseLen * (0.35 + 0.65 * openAmt);
    const width = baseWidth * (0.5 + 0.5 * openAmt);

    // How far the petal center sits from the flower's core, spreading as it opens
    const spread = len * (isRose ? 0.35 : 0.55) * openAmt;
    const wobble = Math.sin(performance.now() / 900 + petal.wobble) * 2 * dpr * openAmt;

    const px = Math.cos(petal.angle) * spread + wobble;
    const py = Math.sin(petal.angle) * spread * 0.55 - len * 0.12 * openAmt;

    ctx.save();
    ctx.translate(px, py * (isRose ? 1 : 1) - (isRose ? 0 : 4*dpr));
    ctx.rotate(petal.angle + Math.PI / 2);

    const droop = wiltFade < 1 ? (1 - wiltFade) * 1.1 : 0;
    ctx.rotate(droop);

    this._paintPetalShape(ctx, len, width, openAmt, wiltFade, isRose, petal);

    ctx.restore();
  }

  // Organic watercolor-ish petal: layered bezier outline + soft inner gradient + irregular alpha edge.
  _paintPetalShape(ctx, len, width, openAmt, wiltFade, isRose, petal){
    const halfW = width / 2;
    const colorTop = isRose ? '246,198,208' : '255,214,224';
    const colorBottom = isRose ? '232,135,154' : '232,135,154';
    const alpha = (isRose ? 0.92 : 0.9) * wiltFade;

    // Base petal silhouette via bezier curve (teardrop/almond organic shape)
    ctx.beginPath();
    ctx.moveTo(0, len / 2);
    ctx.bezierCurveTo(halfW * 1.15, len * 0.15, halfW * 0.9, -len * 0.35, 0, -len / 2);
    ctx.bezierCurveTo(-halfW * 0.9, -len * 0.35, -halfW * 1.15, len * 0.15, 0, len / 2);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, -len/2, 0, len/2);
    grad.addColorStop(0, `rgba(${colorTop},${alpha})`);
    grad.addColorStop(1, `rgba(${colorBottom},${alpha * 0.85})`);
    ctx.fillStyle = grad;
    ctx.shadowColor = `rgba(232,135,154,${0.55 * openAmt})`;
    ctx.shadowBlur = 10 * openAmt;
    ctx.fill();

    // Soft rim highlight (gives the watercolor-edge feel without heavy per-pixel noise cost)
    ctx.strokeStyle = `rgba(255,240,245,${0.25 * openAmt * wiltFade})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    // A subtle center vein
    ctx.strokeStyle = `rgba(200,110,130,${0.3 * openAmt})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, len * 0.4);
    ctx.lineTo(0, -len * 0.4);
    ctx.stroke();
  }

  _drawCenter(ctx, openAmt, wiltFade, dpr){
    const isRose = this.species === 'rose';
    const r = (isRose ? 7 : 6) * dpr * (0.6 + 0.4 * openAmt) * this.scale;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    if (isRose){
      grad.addColorStop(0, `rgba(255,225,180,${wiltFade})`);
      grad.addColorStop(1, `rgba(220,150,120,${0.9*wiltFade})`);
    } else {
      grad.addColorStop(0, `rgba(255,235,150,${wiltFade})`);
      grad.addColorStop(1, `rgba(255,180,60,${0.9*wiltFade})`);
    }
    ctx.fillStyle = grad;
    ctx.shadowColor = `rgba(255,220,120,${0.8 * openAmt})`;
    ctx.shadowBlur = 14 * dpr * openAmt;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ===========================================================
   FlowerScene — manages one or many Flower instances
   (single mode vs bouquet mode), plus the particle system.
=========================================================== */
class FlowerScene {
  constructor(species = 'tulip'){
    this.species = species;
    this.mode = 'single'; // 'single' | 'bouquet'
    this.particles = new ParticleSystem(70);
    this.flowers = [];
    this._initSingle();
  }

  _initSingle(){
    this.flowers = [new Flower(0.5, 0.92, { species: this.species, scale: 1 })];
  }

  setSpecies(species){
    this.species = species;
    this.flowers.forEach(f => {
      f.species = species;
      f.petals = f._buildPetals();
      f.pluckedPetals.clear();
    });
  }

  enterBouquetMode(){
    if (this.mode === 'bouquet') return;
    this.mode = 'bouquet';
    const positions = [
      { x: 0.38, y: 0.94, scale: 0.85 },
      { x: 0.5,  y: 0.96, scale: 1.0  },
      { x: 0.62, y: 0.94, scale: 0.85 },
    ];
    const prevGrow = this.flowers[0]?.grow || 0;
    const prevBloom = this.flowers[0]?.bloom || 0;
    this.flowers = positions.map(p => {
      const f = new Flower(p.x, p.y, { species: this.species, scale: p.scale });
      f.grow = prevGrow;
      f.bloom = prevBloom;
      return f;
    });
  }

  exitBouquetMode(){
    if (this.mode === 'single') return;
    this.mode = 'single';
    const prevGrow = this.flowers[0]?.grow || 0;
    const prevBloom = this.flowers[0]?.bloom || 0;
    this._initSingle();
    this.flowers[0].grow = prevGrow;
    this.flowers[0].bloom = prevBloom;
  }

  setTargets(grow, bloom){
    this.flowers.forEach(f => f.setTargets(grow, bloom));
  }

  startWilt(){ this.flowers.forEach(f => f.startWilt()); }
  cancelWilt(){ this.flowers.forEach(f => f.cancelWilt()); }

  pluckRandomPetal(){
    // Pluck from the primary (first / largest) flower for visual clarity.
    const target = this.flowers[Math.floor(this.flowers.length / 2)] || this.flowers[0];
    if (!target) return;
    const plucked = target.pluckOnePetal();
    if (plucked){
      const head = target.getHeadPosition();
      this.particles.burst(head.x, head.y, 14);
      return true;
    }
    return false;
  }

  update(now, dims){
    this.flowers.forEach(f => f.update(now, this.particles));
    this.particles.update(Math.min(now - (this._lastNow || now), 50));
    this._lastNow = now;
  }

  draw(ctx, dims, dpr){
    this.flowers.forEach(f => f.draw(ctx, dims, dpr));
    this.particles.draw(ctx, dpr);
  }

  getAvgBloom(){
    if (!this.flowers.length) return 0;
    return this.flowers.reduce((s,f) => s + f.bloom, 0) / this.flowers.length;
  }

  getAvgGrow(){
    if (!this.flowers.length) return 0;
    return this.flowers.reduce((s,f) => s + f.grow, 0) / this.flowers.length;
  }
}
