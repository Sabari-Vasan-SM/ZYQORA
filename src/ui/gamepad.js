/**
 * W3C Gamepad API Controller Bridge
 * Matches PPSSPP Default Qwerty Keyboard Mappings:
 * - Button 0 (Cross): Z (keyCode 90)
 * - Button 1 (Circle): X (keyCode 88)
 * - Button 2 (Square): A (keyCode 65)
 * - Button 3 (Triangle): S (keyCode 83)
 * - Button 4 (L1): Q (keyCode 81)
 * - Button 5 (R1): W (keyCode 87)
 * - Button 8 (Select): V (keyCode 86)
 * - Button 9 (Start): Space / Enter (keyCode 32 / 13)
 */

const GP_BUTTON_MAP = {
  0: { key: 'z', code: 'KeyZ', keyCode: 90, which: 90 },           // Cross (✕) -> NKCODE_Z
  1: { key: 'x', code: 'KeyX', keyCode: 88, which: 88 },           // Circle (○) -> NKCODE_X
  2: { key: 'a', code: 'KeyA', keyCode: 65, which: 65 },           // Square (▢) -> NKCODE_A
  3: { key: 's', code: 'KeyS', keyCode: 83, which: 83 },           // Triangle (△) -> NKCODE_S
  4: { key: 'q', code: 'KeyQ', keyCode: 81, which: 81 },           // L-Trigger -> NKCODE_Q
  5: { key: 'w', code: 'KeyW', keyCode: 87, which: 87 },           // R-Trigger -> NKCODE_W
  8: { key: 'v', code: 'KeyV', keyCode: 86, which: 86 },           // Select -> NKCODE_V
  9: { key: ' ', code: 'Space', keyCode: 32, which: 32, altKey: 'Enter', altCode: 'Enter', altKeyCode: 13 }, // Start -> NKCODE_SPACE
  12: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38 },       // D-Pad Up
  13: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 },   // D-Pad Down
  14: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37 },   // D-Pad Left
  15: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39 }, // D-Pad Right
};

const GP_ANALOG_MAP = {
  up:    { key: 'i', code: 'KeyI', keyCode: 73, which: 73 },
  down:  { key: 'k', code: 'KeyK', keyCode: 75, which: 75 },
  left:  { key: 'j', code: 'KeyJ', keyCode: 74, which: 74 },
  right: { key: 'l', code: 'KeyL', keyCode: 76, which: 76 },
};

export class GamepadManager {
  constructor(canvasElement, onStatusChange) {
    this.canvas = canvasElement;
    this.onStatusChange = onStatusChange || (() => {});
    this.activeGamepadIndex = null;
    this.deadzone = 0.2;
    this.lastButtonStates = {};
    this.polling = false;
    this.pollId = null;

    this.init();
  }

  init() {
    window.addEventListener('gamepadconnected', (e) => {
      this.activeGamepadIndex = e.gamepad.index;
      this.onStatusChange(true, e.gamepad.id);
      this.startPolling();
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.activeGamepadIndex === e.gamepad.index) {
        this.activeGamepadIndex = null;
        this.onStatusChange(false, null);
        this.stopPolling();
      }
    });

    // Check if a gamepad is already plugged in
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let gp of gamepads) {
      if (gp) {
        this.activeGamepadIndex = gp.index;
        this.onStatusChange(true, gp.id);
        this.startPolling();
        break;
      }
    }
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    const poll = () => {
      if (!this.polling) return;
      this.pollGamepad();
      // Only keep polling if a gamepad is actively connected to save CPU cycles
      if (this.activeGamepadIndex !== null) {
        this.pollId = requestAnimationFrame(poll);
      } else {
        this.polling = false;
      }
    };
    this.pollId = requestAnimationFrame(poll);
  }

  stopPolling() {
    this.polling = false;
    if (this.pollId) {
      cancelAnimationFrame(this.pollId);
      this.pollId = null;
    }
  }

  pollGamepad() {
    if (this.activeGamepadIndex === null) return;
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[this.activeGamepadIndex];
    if (!gp) return;

    // Check buttons
    gp.buttons.forEach((btn, index) => {
      const isPressed = btn.pressed || btn.value > 0.5;
      const wasPressed = !!this.lastButtonStates[index];

      if (isPressed !== wasPressed) {
        this.lastButtonStates[index] = isPressed;
        const mapping = GP_BUTTON_MAP[index];
        if (mapping) {
          this.dispatchKey(isPressed ? 'keydown' : 'keyup', mapping);
        }
      }
    });

    // Check Left Analog Stick (Axes 0 & 1)
    const axisX = gp.axes[0] || 0;
    const axisY = gp.axes[1] || 0;

    this.checkAnalogThreshold('left', axisX < -this.deadzone, GP_ANALOG_MAP.left);
    this.checkAnalogThreshold('right', axisX > this.deadzone, GP_ANALOG_MAP.right);
    this.checkAnalogThreshold('up', axisY < -this.deadzone, GP_ANALOG_MAP.up);
    this.checkAnalogThreshold('down', axisY > this.deadzone, GP_ANALOG_MAP.down);
  }

  checkAnalogThreshold(direction, isPressed, mapping) {
    const keyStateKey = `analog_${direction}`;
    const wasPressed = !!this.lastButtonStates[keyStateKey];
    if (isPressed !== wasPressed) {
      this.lastButtonStates[keyStateKey] = isPressed;
      if (mapping) {
        this.dispatchKey(isPressed ? 'keydown' : 'keyup', mapping);
      }
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

  rumble(duration = 200, strongMagnitude = 0.5, weakMagnitude = 0.5) {
    if (this.activeGamepadIndex === null) return;
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = gamepads[this.activeGamepadIndex];
    if (gp && gp.vibrationActuator) {
      gp.vibrationActuator.playEffect('dual-rumble', {
        startDelay: 0,
        duration,
        weakMagnitude,
        strongMagnitude,
      }).catch(() => {});
    }
  }

  destroy() {
    this.stopPolling();
  }
}
