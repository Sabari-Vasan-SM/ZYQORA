/**
 * W3C Gamepad API Controller Bridge
 */
export class GamepadManager {
  constructor(canvasElement, onStatusChange) {
    this.canvas = canvasElement;
    this.onStatusChange = onStatusChange || (() => {});
    this.activeGamepadIndex = null;
    this.deadzone = 0.2;
    this.lastButtonStates = {};
    this.polling = false;
    this.pollId = null;

    // Default keyboard key mapping for SDL2
    this.buttonKeyMap = {
      0: { key: 'x', code: 'KeyX' },           // Cross (✕)
      1: { key: 'z', code: 'KeyZ' },           // Circle (○)
      2: { key: 'a', code: 'KeyA' },           // Square (▢)
      3: { key: 's', code: 'KeyS' },           // Triangle (△)
      4: { key: 'q', code: 'KeyQ' },           // L-Trigger
      5: { key: 'w', code: 'KeyW' },           // R-Trigger
      8: { key: ' ', code: 'Space' },          // Select
      9: { key: 'Enter', code: 'Enter' },      // Start
      12: { key: 'ArrowUp', code: 'ArrowUp' },       // D-Pad Up
      13: { key: 'ArrowDown', code: 'ArrowDown' },   // D-Pad Down
      14: { key: 'ArrowLeft', code: 'ArrowLeft' },   // D-Pad Left
      15: { key: 'ArrowRight', code: 'ArrowRight' }, // D-Pad Right
    };

    this.analogKeyMap = {
      up: { key: 'i', code: 'KeyI' },
      down: { key: 'k', code: 'KeyK' },
      left: { key: 'j', code: 'KeyJ' },
      right: { key: 'l', code: 'KeyL' },
    };

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

    // Initial check
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
      this.pollGamepad();
      if (this.polling) {
        this.pollId = requestAnimationFrame(poll);
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
        const mapping = this.buttonKeyMap[index];
        if (mapping) {
          this.dispatchKey(isPressed ? 'keydown' : 'keyup', mapping.key, mapping.code);
        }
      }
    });

    // Check Left Analog Stick (Axes 0 & 1)
    const axisX = gp.axes[0] || 0;
    const axisY = gp.axes[1] || 0;

    this.checkAnalogThreshold('left', axisX < -this.deadzone);
    this.checkAnalogThreshold('right', axisX > this.deadzone);
    this.checkAnalogThreshold('up', axisY < -this.deadzone);
    this.checkAnalogThreshold('down', axisY > this.deadzone);
  }

  checkAnalogThreshold(direction, isPressed) {
    const keyStateKey = `analog_${direction}`;
    const wasPressed = !!this.lastButtonStates[keyStateKey];
    if (isPressed !== wasPressed) {
      this.lastButtonStates[keyStateKey] = isPressed;
      const mapping = this.analogKeyMap[direction];
      if (mapping) {
        this.dispatchKey(isPressed ? 'keydown' : 'keyup', mapping.key, mapping.code);
      }
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
