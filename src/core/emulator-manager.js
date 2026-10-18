/**
 * WebAssembly PPSSPP Core Bridge and Lifecycle Manager
 * Includes comprehensive ppsspp.ini stability patches for commercial games (God of War, Tekken 6, etc.)
 * Optimized for CPU thermals, memory footprint, and frame pacing.
 */

const PPSSPP_INI_CONTENT = `[General]
FirstRun = False
CurrentDirectory = /games
IgnoreBadMemAccess = True
ForceLagSync2 = True
UIScale = 1
AutoLoadSaveState = 0

[CPU]
FastMemoryAccess = False
SeparateSASThread = False
SeparateIOThread = False
IOTimingMethod = 0

[SystemParam]
PSPModel = 1
NickName = PPSSPP
Language = 1

[Graphics]
RenderingMode = 1
SoftwareRendering = False
DisplayRefreshRate = 60
FrameRate = 60
FrameRate2 = -1
FrameSkip = 1
AutoFrameSkip = True
VerticalSync = True
LowLatencyPresent = True
InternalResolution = 1
SkipBufferEffects = False
DisableSlowFramebufReads = True
VertexCache = True
TextureBackingToFile = False

[Sound]
Enable = True
ExtraAudioBuffering = True
AudioBufferSize = 2048
FillAudioGaps = True
AudioSyncMode = 0

[Control]
ShowTouchControls = False
`;

const CONTROLS_INI_CONTENT = `[ControlMapping]
Up = 1-19
Down = 1-20
Left = 1-21
Right = 1-22
Circle = 1-52,1-54
Cross = 1-54,1-52
Square = 1-29
Triangle = 1-47
Start = 1-62,1-66
Select = 1-50,1-59
L = 1-45
R = 1-51
An.Up = 1-37
An.Down = 1-39
An.Left = 1-38
An.Right = 1-40
`;

import { RemoteGameFile } from '../streaming/RemoteGameFile.ts';
import { StreamVirtualFileAdapter } from './stream-virtual-file.ts';

export class EmulatorManager {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onToast = options.onToast || (() => {});
    this.onResolutionChange = options.onResolutionChange || (() => {});
    this.onStreamingMetrics = options.onStreamingMetrics || (() => {});

    this.isLoaded = false;
    this.isRunning = false;
    this.audioContext = null;
    this.activeGameName = null;
    this.internalResolution = 1;

    this.remoteGameFile = null;
    this.streamAdapter = null;

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
   * Boot the WebAssembly core with an initial game
   */
  async launchGame(gameData) {
    this.unlockAudio();
    this.onStatusChange('loading', `Preparing ${gameData.name}...`);
    this.onToast(`Loading ${gameData.name}...`, 'info');

    // If emulator is already running in this tab, clean reload is necessary
    if (this.isLoaded) {
      sessionStorage.setItem('zyqora_autorun_game_id', gameData.id);
      this.onToast(`Switching to ${gameData.name}...`, 'info');
      setTimeout(() => window.location.reload(), 400);
      return;
    }

    try {
      let buffer = null;
      let filename = 'game.pbp';
      let streamAdapter = null;

      if (gameData.isCloudStream && gameData.streamUrl) {
        this.onStatusChange('loading', `Connecting to cloud stream for ${gameData.name}...`);
        this.remoteGameFile = new RemoteGameFile(gameData.streamUrl, {
          gameVersionId: gameData.id,
          isChunked: gameData.isChunked || false,
          partSize: gameData.partSize || 40 * 1024 * 1024,
          totalFileSize: gameData.sizeBytes || 0,
          getPartUrl: gameData.getPartUrl,
          onMetrics: (metrics) => {
            this.onStreamingMetrics(metrics, gameData.sizeBytes);
          },
        });

        streamAdapter = new StreamVirtualFileAdapter(this.remoteGameFile);
        this.streamAdapter = streamAdapter;
        const bootInfo = await streamAdapter.prepareBootSectors((msg) => this.onStatusChange('loading', msg));
        filename = gameData.fileName || 'cloud_stream.iso';
        this.onToast(`Stream ready: Cached ${(bootInfo.bootTransferredBytes / (1024 * 1024)).toFixed(1)} MB of ${(bootInfo.totalSize / (1024 * 1024)).toFixed(0)} MB`, 'info');

      } else if (gameData.file) {
        buffer = await gameData.file.arrayBuffer();
        filename = gameData.file.name || 'game.iso';
      } else if (gameData.blob) {
        buffer = await gameData.blob.arrayBuffer();
        filename = gameData.fileName || 'game.iso';
      } else if (gameData.url) {
        const resp = await fetch(gameData.url);
        if (!resp.ok) throw new Error(`Failed to download ${gameData.url}`);
        buffer = await resp.arrayBuffer();
        filename = gameData.url.split('/').pop() || 'game.pbp';
      }

      this.activeGameName = gameData.name;
      await this.bootModule(buffer, filename, streamAdapter);

      // Free buffer from JS memory immediately
      buffer = null;

      this.isRunning = true;
      this.onStatusChange('active', gameData.name);
      this.onToast(`${gameData.name} running! Tap ✕ or press Enter to advance`, 'success');

      // Focus canvas for immediate input capture
      this.canvas.focus();
    } catch (err) {
      console.error('[ZYQORA] Launch error:', err);
      this.onStatusChange('error', err.message);
      this.onToast(`Failed to boot game: ${err.message}`, 'error');
    }
  }

  async bootModule(gameBuffer, filename, streamAdapter = null) {
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
        arguments: [virtualPath],
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
              const FS = window.FS;
              // 1. Create games directory and mount game
              FS.mkdirTree('/games');

              if (streamAdapter) {
                // On-demand streaming virtual file
                streamAdapter.mountToFS(FS, virtualPath);
                console.log(`[ZYQORA] Successfully mounted on-demand cloud stream at ${virtualPath}`);
              } else if (gameBuffer) {
                // Static buffered file
                FS.writeFile(virtualPath, new Uint8Array(gameBuffer));
                console.log(`[ZYQORA] Mounted game file at ${virtualPath} (${gameBuffer.byteLength} bytes)`);
                gameBuffer = null; // Release ArrayBuffer to allow GC reclamation
              }

              // 2. Write ppsspp.ini and controls.ini with 64MB PSPModel and stability fixes
              const configRoots = [
                '/home/web_user/.config/ppsspp',
                '/root/.config/ppsspp',
                '/.config/ppsspp',
                '',
              ];

              const encoder = new TextEncoder();
              const iniBytes = encoder.encode(PPSSPP_INI_CONTENT);
              const ctrlBytes = encoder.encode(CONTROLS_INI_CONTENT);

              configRoots.forEach((root) => {
                const sysDir = root ? `${root}/PSP/SYSTEM` : '/PSP/SYSTEM';
                try {
                  FS.mkdirTree(sysDir);
                  FS.writeFile(`${sysDir}/ppsspp.ini`, iniBytes);
                  FS.writeFile(`${sysDir}/controls.ini`, ctrlBytes);
                  console.log(`[ZYQORA] Injected ppsspp.ini and controls.ini at ${sysDir}`);
                } catch (_) {}
              });
            } catch (e) {
              console.error('[ZYQORA] preRun initialization error:', e);
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

  /* Shortcut helpers */
  saveState() {
    this.dispatchSpecialKey('F3', 114, 'F3');
    this.onToast('State Saved (F3)', 'success');
  }

  loadState() {
    this.dispatchSpecialKey('F4', 115, 'F4');
    this.onToast('State Loaded (F4)', 'info');
  }

  nextSlot() {
    this.dispatchSpecialKey('F2', 113, 'F2');
    this.onToast('Next Save Slot (F2)', 'info');
  }

  prevSlot() {
    this.dispatchSpecialKey('F1', 112, 'F1');
    this.onToast('Previous Save Slot (F1)', 'info');
  }

  togglePause() {
    this.dispatchSpecialKey('Escape', 27, 'Escape');
    this.onToast('Pause / Menu (Esc)', 'info');
  }

  fastForward() {
    this.dispatchSpecialKey('F7', 118, 'F7');
    this.onToast('Fast-Forward Toggled (F7)', 'info');
  }

  dispatchSpecialKey(key, keyCode, code = 'KeyX') {
    const canvas = this.canvas || document.getElementById('canvas');
    const downEvt = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      view: window,
      key,
      code,
      keyCode,
      which: keyCode,
    });
    Object.defineProperty(downEvt, 'keyCode', { get: () => keyCode });
    Object.defineProperty(downEvt, 'which', { get: () => keyCode });

    const upEvt = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      view: window,
      key,
      code,
      keyCode,
      which: keyCode,
    });
    Object.defineProperty(upEvt, 'keyCode', { get: () => keyCode });
    Object.defineProperty(upEvt, 'which', { get: () => keyCode });

    if (canvas) canvas.dispatchEvent(downEvt);
    document.dispatchEvent(downEvt);
    window.dispatchEvent(downEvt);

    setTimeout(() => {
      if (canvas) canvas.dispatchEvent(upEvt);
      document.dispatchEvent(upEvt);
      window.dispatchEvent(upEvt);
    }, 80);
  }
}
