/**
 * On-Screen Virtual Multi-Touch PSP Controller
 */
export class TouchControls {
  constructor(canvasElement, layerId = 'touch-layer') {
    this.canvas = canvasElement;
    this.layer = document.getElementById(layerId);
    this.isVisible = true;
    this.analogThumb = document.getElementById('analog-thumb');
    this.analogBase = document.getElementById('analog-stick');
    
    this.analogActive = false;
    this.analogTouchId = null;
    this.analogCenter = { x: 0, y: 0 };
    this.analogRadius = 45;

    this.keyMap = {
      'btn-up':       { key: 'ArrowUp', code: 'ArrowUp' },
      'btn-down':     { key: 'ArrowDown', code: 'ArrowDown' },
      'btn-left':     { key: 'ArrowLeft', code: 'ArrowLeft' },
      'btn-right':    { key: 'ArrowRight', code: 'ArrowRight' },
      'btn-cross':    { key: 'x', code: 'KeyX' },
      'btn-circle':   { key: 'z', code: 'KeyZ' },
      'btn-square':   { key: 'a', code: 'KeyA' },
      'btn-triangle': { key: 's', code: 'KeyS' },
      'btn-l':        { key: 'q', code: 'KeyQ' },
      'btn-r':        { key: 'w', code: 'KeyW' },
      'btn-start':    { key: 'Enter', code: 'Enter' },
      'btn-select':   { key: ' ', code: 'Space' },
    };

    this.analogDirections = {
      up: false,
      down: false,
      left: false,
      right: false,
    };

    this.init();
  }

  init() {
    if (!this.layer) return;

    // Auto-detect mobile / touch devices
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    this.toggle(isTouchDevice);

    // Bind all buttons
    Object.keys(this.keyMap).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const mapping = this.keyMap[id];

      const handlePress = (e) => {
        e.preventDefault();
        el.classList.add('pressed');
        this.vibrate(12);
        this.dispatchKey('keydown', mapping.key, mapping.code);
      };

      const handleRelease = (e) => {
        e.preventDefault();
        el.classList.remove('pressed');
        this.dispatchKey('keyup', mapping.key, mapping.code);
      };

      el.addEventListener('touchstart', handlePress, { passive: false });
      el.addEventListener('touchend', handleRelease, { passive: false });
      el.addEventListener('touchcancel', handleRelease, { passive: false });
      el.addEventListener('mousedown', handlePress);
      el.addEventListener('mouseup', handleRelease);
      el.addEventListener('mouseleave', handleRelease);
    });

    // Bind Analog Stick
    if (this.analogBase) {
      this.initAnalogStick();
    }
  }

  initAnalogStick() {
    const base = this.analogBase;
    const thumb = this.analogThumb;

    const start = (e) => {
      e.preventDefault();
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      this.analogActive = true;
      this.analogTouchId = touch.identifier ?? 'mouse';
      const rect = base.getBoundingClientRect();
      this.analogCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      if (thumb) thumb.classList.add('active');
      this.vibrate(10);
      this.move(e);
    };

    const move = (e) => {
      if (!this.analogActive) return;
      e.preventDefault();
      let touch = null;
      if (e.changedTouches) {
        for (let t of e.changedTouches) {
          if (t.identifier === this.analogTouchId) {
            touch = t;
            break;
          }
        }
      } else {
        touch = e;
      }
      if (!touch) return;

      const dx = touch.clientX - this.analogCenter.x;
      const dy = touch.clientY - this.analogCenter.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      const clampedDist = Math.min(distance, this.analogRadius);
      const thumbX = Math.cos(angle) * clampedDist;
      const thumbY = Math.sin(angle) * clampedDist;

      if (thumb) {
        thumb.style.transform = `translate(calc(-50% + ${thumbX}px), calc(-50% + ${thumbY}px))`;
      }

      // Convert vector to PSP D-Pad/Analog Nub signals
      const normX = thumbX / this.analogRadius;
      const normY = thumbY / this.analogRadius;
      const threshold = 0.35;

      this.updateAnalogDirection('left', normX < -threshold, 'j', 'KeyJ');
      this.updateAnalogDirection('right', normX > threshold, 'l', 'KeyL');
      this.updateAnalogDirection('up', normY < -threshold, 'i', 'KeyI');
      this.updateAnalogDirection('down', normY > threshold, 'k', 'KeyK');
    };

    const end = (e) => {
      if (!this.analogActive) return;
      this.analogActive = false;
      this.analogTouchId = null;
      if (thumb) {
        thumb.classList.remove('active');
        thumb.style.transform = 'translate(-50%, -50%)';
      }

      this.updateAnalogDirection('left', false, 'j', 'KeyJ');
      this.updateAnalogDirection('right', false, 'l', 'KeyL');
      this.updateAnalogDirection('up', false, 'i', 'KeyI');
      this.updateAnalogDirection('down', false, 'k', 'KeyK');
    };

    base.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end, { passive: false });
    window.addEventListener('touchcancel', end, { passive: false });

    base.addEventListener('mousedown', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
  }

  updateAnalogDirection(dir, active, key, code) {
    if (this.analogDirections[dir] !== active) {
      this.analogDirections[dir] = active;
      this.dispatchKey(active ? 'keydown' : 'keyup', key, code);
    }
  }

  vibrate(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (_) {}
    }
  }

  toggle(visible) {
    this.isVisible = visible !== undefined ? visible : !this.isVisible;
    if (this.layer) {
      if (this.isVisible) {
        this.layer.classList.remove('hidden');
      } else {
        this.layer.classList.add('hidden');
      }
    }
  }

  setOpacity(opacity) {
    if (this.layer) {
      this.layer.style.opacity = opacity;
    }
  }

  dispatchKey(type, key, code) {
    const target = this.canvas || window;
    const evt = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      key,
      code,
      which: key.charCodeAt(0),
      keyCode: key.charCodeAt(0),
    });
    target.dispatchEvent(evt);
    window.dispatchEvent(evt);
  }
}
