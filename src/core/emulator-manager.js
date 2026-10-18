/**
 * WebAssembly PPSSPP Core Bridge and Lifecycle Manager
 */
export class EmulatorManager {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onToast = options.onToast || (() => {});
    this.onResolutionChange = options.onResolutionChange || (() => {});

    this.isLoaded = false;
    this.isRunning = false;
    this.audioContext = null;
    this.activeGameName = null;
    this.internalResolution = 2; // 2x (960x544) default for sharp rendering

    this.initAudioContext();
  }

  initAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      this.audioContext = new AudioCtx({ latencyHint: 'interactive' });
    }
  }

  unlockAudio() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        console.log('[ZYQORA] AudioContext unlocked successfully');
      }).catch((e) => console.warn('Could not resume audio:', e));
    }
  }

  setResolution(multiplier) {
    this.internalResolution = multiplier;
    const baseW = 480;
    const baseH = 272;
    this.canvas.width = baseW * multiplier;
    this.canvas.height = baseH * multiplier;
    this.onResolutionChange(multiplier);
    this.onToast(`Resolution set to ${multiplier}x (${baseW * multiplier}x${baseH * multiplier})`, 'success');
  }

  setFrameSkip(mode) {
    this.onToast(`Frame Skip: ${mode === '0' ? 'Off' : mode}`, 'info');
  }

  /**
   * Boot the WebAssembly core with an optional initial game
   */
  async launchGame(gameData) {
    this.unlockAudio();
    this.onStatusChange('loading', `Preparing ${gameData.name}...`);
    this.onToast(`Loading ${gameData.name}...`, 'info');

    try {
      let buffer = null;
      let filename = 'game.pbp';

      if (gameData.blob) {
        buffer = await gameData.blob.arrayBuffer();
        filename = gameData.fileName || 'game.iso';
      } else if (gameData.url) {
        const resp = await fetch(gameData.url);
        if (!resp.ok) throw new Error(`Failed to download ${gameData.url}`);
        buffer = await resp.arrayBuffer();
        filename = gameData.url.split('/').pop() || 'game.pbp';
      }

      this.activeGameName = gameData.name;

      if (!this.isLoaded) {
        await this.bootModule(buffer, filename);
      } else {
        // Runtime already active: write game and call main
        await this.hotloadGame(buffer, filename);
      }

      this.isRunning = true;
      this.onStatusChange('active', gameData.name);
      this.onToast(`${gameData.name} running!`, 'success');

      // Focus canvas for immediate input capture
      this.canvas.focus();
    } catch (err) {
      console.error('[ZYQORA] Launch error:', err);
      this.onStatusChange('error', err.message);
      this.onToast(`Failed to boot game: ${err.message}`, 'error');
    }
  }

  async bootModule(gameBuffer, filename) {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const virtualPath = `/games/${safeName}`;

    return new Promise((resolve, reject) => {
      window.Module = {
        canvas: this.canvas,
        webglContextAttributes: {
          powerPreference: 'high-performance',
          alpha: false,
          antialias: false,
          depth: true,
          stencil: true,
          preserveDrawingBuffer: false,
          desynchronized: true,
          failIfMajorPerformanceCaveat: false,
        },
        SDL2: this.audioContext ? { audioContext: this.audioContext } : {},
        arguments: ['--dpi', '1', virtualPath],
        locateFile(path) {
          return '/ppsspp/' + path;
        },
        print(text) {
          console.log('[PPSSPP stdout]', text);
        },
        printErr(text) {
          console.warn('[PPSSPP stderr]', text);
        },
        setStatus: (text) => {
          if (text) this.onStatusChange('loading', text);
        },
        preRun: [
          () => {
            try {
              window.FS.mkdirTree('/games');
              if (gameBuffer) {
                window.FS.writeFile(virtualPath, new Uint8Array(gameBuffer));
                console.log(`[ZYQORA] Mounted game file at ${virtualPath} (${gameBuffer.byteLength} bytes)`);
              }
            } catch (e) {
              console.error('[ZYQORA] preRun error:', e);
            }
          },
        ],
        onRuntimeInitialized: () => {
          console.log('[ZYQORA] PPSSPP WebAssembly Core successfully initialized');
          this.isLoaded = true;
          this.isRunning = true;
          resolve();
        },
        onAbort: (err) => {
          console.error('[ZYQORA] PPSSPP runtime abort:', err);
          reject(new Error(err));
        },
      };

      // Load PPSSPPSDL.js
      const script = document.createElement('script');
      script.src = '/ppsspp/PPSSPPSDL.js';
      script.async = true;
      script.onerror = () => reject(new Error('Failed to load PPSSPPSDL.js script'));
      document.body.appendChild(script);
    });
  }

  async hotloadGame(gameBuffer, filename) {
    if (!window.FS) throw new Error('Virtual filesystem not ready');
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const virtualPath = `/games/${safeName}`;

    window.FS.mkdirTree('/games');
    window.FS.writeFile(virtualPath, new Uint8Array(gameBuffer));

    if (window.Module && window.Module.callMain) {
      window.Module.callMain([virtualPath]);
    }
  }

  /* Shortcut helpers */
  saveState() {
    this.dispatchSpecialKey('F3', 114);
    this.onToast('State Saved (F3)', 'success');
  }

  loadState() {
    this.dispatchSpecialKey('F4', 115);
    this.onToast('State Loaded (F4)', 'info');
  }

  nextSlot() {
    this.dispatchSpecialKey('F2', 113);
    this.onToast('Next Save Slot (F2)', 'info');
  }

  prevSlot() {
    this.dispatchSpecialKey('F1', 112);
    this.onToast('Previous Save Slot (F1)', 'info');
  }

  togglePause() {
    this.dispatchSpecialKey('Escape', 27);
    this.onToast('Pause / Menu (Esc)', 'info');
  }

  fastForward() {
    this.dispatchSpecialKey('F7', 118);
    this.onToast('Fast-Forward Toggled (F7)', 'info');
  }

  dispatchSpecialKey(key, keyCode) {
    const target = this.canvas || window;
    const downEvt = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      code: key,
      keyCode,
      which: keyCode,
    });
    const upEvt = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key,
      code: key,
      keyCode,
      which: keyCode,
    });
    target.dispatchEvent(downEvt);
    window.dispatchEvent(downEvt);
    setTimeout(() => {
      target.dispatchEvent(upEvt);
      window.dispatchEvent(upEvt);
    }, 50);
  }
}
