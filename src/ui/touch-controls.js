/**
 * On-Screen Virtual Multi-Touch PSP Controller
 * Perfectly aligned with PPSSPP's native Default Qwerty Keyboard Mapping:
 * - Cross: Z (keyCode 90)
 * - Circle: X (keyCode 88)
 * - Square: A (keyCode 65)
 * - Triangle: S (keyCode 83)
 * - Start: Space / Enter (keyCode 32 / 13)
 * - Select: V (keyCode 86)
 * - L-Trigger: Q (keyCode 81)
 * - R-Trigger: W (keyCode 87)
 * - D-Pad: Arrow keys
 * - Analog Stick: I / K / J / L
 */

const TOUCH_KEY_MAP = {
  'btn-cross':    { key: 'z', code: 'KeyZ', keyCode: 90, which: 90 },       // Cross (✕) -> NKCODE_Z
  'btn-circle':   { key: 'x', code: 'KeyX', keyCode: 88, which: 88 },       // Circle (○) -> NKCODE_X
  'btn-square':   { key: 'a', code: 'KeyA', keyCode: 65, which: 65 },       // Square (▢) -> NKCODE_A
  'btn-triangle': { key: 's', code: 'KeyS', keyCode: 83, which: 83 },       // Triangle (△) -> NKCODE_S
  'btn-up':       { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38 },
  'btn-down':     { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 },
  'btn-left':     { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 },
  'btn-right':    { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 },
  'btn-l':        { key: 'q', code: 'KeyQ', keyCode: 81, which: 81 },       // L-Trigger -> NKCODE_Q
  'btn-r':        { key: 'w', code: 'KeyW', keyCode: 87, which: 87 },       // R-Trigger -> NKCODE_W
  'btn-start':    { key: ' ', code: 'Space', keyCode: 32, which: 32, altKey: 'Enter', altCode: 'Enter', altKeyCode: 13 }, // Start -> NKCODE_SPACE
  'btn-select':   { key: 'v', code: 'KeyV', keyCode: 86, which: 86 },       // Select -> NKCODE_V
};

const ANALOG_KEY_MAP = {
  up:    { key: 'i', code: 'KeyI', keyCode: 73, which: 73 },
  down:  { key: 'k', code: 'KeyK', keyCode: 75, which: 75 },
  left:  { key: 'j', code: 'KeyJ', keyCode: 74, which: 74 },
  right: { key: 'l', code: 'KeyL', keyCode: 76, which: 76 },
};

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

    // Show touch layer by default so users on touchscreens or clicking on desktop can use it
    this.toggle(true);

    // Bind all buttons
    Object.keys(TOUCH_KEY_MAP).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const mapping = TOUCH_KEY_MAP[id];

      const handlePress = (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('pressed');
        this.vibrate(12);
        this.dispatchKey('keydown', mapping);
      };

      const handleRelease = (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('pressed');
        this.dispatchKey('keyup', mapping);
      };

      // Both Touch and Pointer/Mouse events
      el.addEventListener('touchstart', handlePress, { passive: false });
      el.addEventListener('touchend', handleRelease, { passive: false });
      el.addEventListener('touchcancel', handleRelease, { passive: false });
      
      el.addEventListener('pointerdown', handlePress);
      el.addEventListener('pointerup', handleRelease);
      el.addEventListener('pointercancel', handleRelease);
      el.addEventListener('pointerleave', handleRelease);
    });

    // Bind Analog Stick
    if (this.analogBase) {
      this.initAnalogStick();
    }
  }

  initAnalogStick() {
    const base = this.analogBase;
    const thumb = this.analogThumb;

    // Handlers defined with proper bindings
    this._onStickMove = (e) => {
      if (!this.analogActive) return;
      e.preventDefault();
      e.stopPropagation();
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

      this.updateAnalogDirection('left', normX < -threshold, ANALOG_KEY_MAP.left);
      this.updateAnalogDirection('right', normX > threshold, ANALOG_KEY_MAP.right);
      this.updateAnalogDirection('up', normY < -threshold, ANALOG_KEY_MAP.up);
      this.updateAnalogDirection('down', normY > threshold, ANALOG_KEY_MAP.down);
    };

    this._onStickEnd = (e) => {
      if (!this.analogActive) return;
      this.analogActive = false;
      this.analogTouchId = null;
      if (thumb) {
        thumb.classList.remove('active');
        thumb.style.transform = 'translate(-50%, -50%)';
      }

      this.updateAnalogDirection('left', false, ANALOG_KEY_MAP.left);
      this.updateAnalogDirection('right', false, ANALOG_KEY_MAP.right);
      this.updateAnalogDirection('up', false, ANALOG_KEY_MAP.up);
      this.updateAnalogDirection('down', false, ANALOG_KEY_MAP.down);

      // Remove window listeners when not dragging to save CPU
      window.removeEventListener('touchmove', this._onStickMove);
      window.removeEventListener('touchend', this._onStickEnd);
      window.removeEventListener('pointermove', this._onStickMove);
      window.removeEventListener('pointerup', this._onStickEnd);
    };

    const start = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      this.analogActive = true;
      this.analogTouchId = touch.identifier ?? 'pointer';
      const rect = base.getBoundingClientRect();
      this.analogRadius = Math.max(20, (rect.width / 2) - 8);
      this.analogCenter = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
      if (thumb) thumb.classList.add('active');
      this.vibrate(10);

      // Attach move listeners ONLY when stick is engaged
      window.addEventListener('touchmove', this._onStickMove, { passive: false });
      window.addEventListener('touchend', this._onStickEnd, { passive: false });
      window.addEventListener('touchcancel', this._onStickEnd, { passive: false });
      window.addEventListener('pointermove', this._onStickMove);
      window.addEventListener('pointerup', this._onStickEnd);

      this._onStickMove(e);
    };

    base.addEventListener('touchstart', start, { passive: false });
    base.addEventListener('pointerdown', start);
  }

  updateAnalogDirection(dir, active, mapping) {
    if (this.analogDirections[dir] !== active) {
      this.analogDirections[dir] = active;
      this.dispatchKey(active ? 'keydown' : 'keyup', mapping);
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

  dispatchKey(type, mapping) {
    const canvas = this.canvas || document.getElementById('canvas');
    const evt = new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      key: mapping.key,
      code: mapping.code,
      keyCode: mapping.keyCode,
      which: mapping.which,
    });

    Object.defineProperty(evt, 'keyCode', { get: () => mapping.keyCode });
    Object.defineProperty(evt, 'which', { get: () => mapping.which });
    Object.defineProperty(evt, 'charCode', { get: () => (type === 'keypress' ? mapping.keyCode : 0) });

    if (canvas) canvas.dispatchEvent(evt);
    document.dispatchEvent(evt);
    window.dispatchEvent(evt);

    // If there is an alternate mapping (e.g. Enter for Start), dispatch that too
    if (mapping.altKey) {
      const altEvt = new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        key: mapping.altKey,
        code: mapping.altCode,
        keyCode: mapping.altKeyCode,
        which: mapping.altKeyCode,
      });
      Object.defineProperty(altEvt, 'keyCode', { get: () => mapping.altKeyCode });
      Object.defineProperty(altEvt, 'which', { get: () => mapping.altKeyCode });

      if (canvas) canvas.dispatchEvent(altEvt);
      document.dispatchEvent(altEvt);
      window.dispatchEvent(altEvt);
    }
  }
}
