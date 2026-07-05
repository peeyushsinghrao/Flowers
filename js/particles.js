/* ===========================================================
   Particles — soft pollen / sparkle drift near a bloomed flower.
   Lightweight pooled system, no external assets.
=========================================================== */
class ParticleSystem {
  constructor(maxParticles = 60){
    this.maxParticles = maxParticles;
    this.particles = [];
  }

  spawn(x, y, opts = {}){
    if (this.particles.length >= this.maxParticles) return;
    const {
      color = 'rgba(212,165,116,OPACITY)',
      speed = 0.4,
      size = 2,
      life = 1800,
      spread = 40,
      gold = Math.random() > 0.5,
    } = opts;

    this.particles.push({
      x: x + (Math.random() - 0.5) * spread,
      y: y + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * speed,
      vy: -Math.random() * speed - 0.15,
      size: size * (0.6 + Math.random() * 0.8),
      life,
      age: 0,
      gold,
      drift: Math.random() * Math.PI * 2,
    });
  }

  // Emit a light ambient sparkle field around a bloomed flower center.
  emitAmbient(x, y, bloomAmount, dt){
    if (bloomAmount < 0.55) return;
    const chance = (bloomAmount - 0.55) * 0.12;
    if (Math.random() < chance){
      this.spawn(x, y, { spread: 70, life: 2200, size: 1.6 });
    }
  }

  // A denser one-shot burst, e.g. when a petal is plucked or bloom completes.
  burst(x, y, count = 18){
    for (let i = 0; i < count; i++){
      this.spawn(x, y, {
        spread: 12,
        speed: 1.4,
        size: 2.4,
        life: 1000 + Math.random() * 600,
      });
    }
  }

  update(dt){
    for (let i = this.particles.length - 1; i >= 0; i--){
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life){
        this.particles.splice(i, 1);
        continue;
      }
      p.drift += dt * 0.002;
      p.x += p.vx + Math.sin(p.drift) * 0.15;
      p.y += p.vy;
      p.vy *= 0.996; // gentle deceleration, like floating
    }
  }

  draw(ctx, dpr = 1){
    ctx.save();
    for (const p of this.particles){
      const t = p.age / p.life;
      const opacity = Math.sin(t * Math.PI); // fade in, fade out
      const r = p.size * dpr;
      const color = p.gold ? `rgba(212,165,116,${opacity * 0.85})` : `rgba(246,198,208,${opacity * 0.75})`;

      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6 * dpr;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  clear(){
    this.particles.length = 0;
  }
}
