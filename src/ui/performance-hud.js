/**
 * Performance HUD and Frame-Time Graph Monitor
 */
export class PerformanceHUD {
  constructor(containerId = 'performance-hud', canvasId = 'frame-time-canvas') {
    this.container = document.getElementById(containerId);
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    this.fpsEl = document.getElementById('hud-fps');
    this.frameTimeEl = document.getElementById('hud-frametime');
    this.memEl = document.getElementById('hud-mem');
    this.audioEl = document.getElementById('hud-audio');
    this.resEl = document.getElementById('hud-res');

    this.history = new Array(60).fill(16.6);
    this.lastTime = performance.now();
    this.frameCount = 0;
    this.fps = 60;
    this.isVisible = true;

    this.rafId = null;
    this.init();
  }

  init() {
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  toggle(visible) {
    this.isVisible = visible !== undefined ? visible : !this.isVisible;
    if (this.container) {
      this.container.style.display = this.isVisible ? 'flex' : 'none';
    }
  }

  setResolution(multiplier) {
    if (this.resEl) {
      this.resEl.textContent = `${multiplier}x (${480 * multiplier}x${272 * multiplier})`;
    }
  }

  setAudioStatus(status) {
    if (this.audioEl) {
      this.audioEl.textContent = status;
    }
  }

  loop(currentTime) {
    const delta = currentTime - this.lastTime;
    this.lastTime = currentTime;

    // Record frame time
    if (delta > 0 && delta < 200) {
      this.history.shift();
      this.history.push(delta);
    }

    this.frameCount++;
    if (currentTime - (this._lastFpsUpdate || 0) >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (currentTime - (this._lastFpsUpdate || 0)));
      this.frameCount = 0;
      this._lastFpsUpdate = currentTime;

      const avgFrameTime = this.history.reduce((a, b) => a + b, 0) / this.history.length;

      if (this.fpsEl) {
        this.fpsEl.textContent = `${this.fps} FPS`;
        this.fpsEl.className = 'hud-val ' + (this.fps >= 55 ? 'fps-good' : this.fps >= 30 ? 'fps-warn' : 'fps-bad');
      }

      if (this.frameTimeEl) {
        this.frameTimeEl.textContent = `${avgFrameTime.toFixed(1)} ms`;
      }

      if (this.memEl && performance.memory) {
        const memMB = Math.round(performance.memory.usedJSHeapSize / (1024 * 1024));
        this.memEl.textContent = `${memMB} MB`;
      }
    }

    this.drawSparkline();
    this.rafId = requestAnimationFrame(this.loop);
  }

  drawSparkline() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);

    // Target 60fps line (16.6ms) and 30fps line (33.3ms)
    const target33Y = h - (33.3 / 50) * h;
    const target16Y = h - (16.6 / 50) * h;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, target16Y);
    ctx.lineTo(w, target16Y);
    ctx.stroke();

    // Draw graph
    ctx.beginPath();
    const step = w / (this.history.length - 1);
    this.history.forEach((val, i) => {
      const clamped = Math.min(Math.max(val, 0), 50);
      const y = h - (clamped / 50) * h;
      const x = i * step;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.strokeStyle = this.fps >= 55 ? '#00d4aa' : this.fps >= 30 ? '#ffaa00' : '#ff2a6d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }
}
