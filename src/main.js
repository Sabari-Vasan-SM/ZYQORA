import { PerformanceHUD } from './ui/performance-hud.js';
import { GamepadManager } from './ui/gamepad.js';
import { TouchControls } from './ui/touch-controls.js';
import { GameLibrary } from './ui/library.js';
import { EmulatorManager } from './core/emulator-manager.js';

// Toast Notification helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Status dot & text helper
function setStatus(state, text) {
  const dot = document.getElementById('status-dot');
  const txt = document.getElementById('status-text');
  if (dot) {
    dot.className = 'status-dot ' + (state === 'active' ? 'active' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : '');
  }
  if (txt) {
    txt.textContent = text;
  }
}

// Initialize Application once DOM is ready
window.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('canvas');
  const welcomeOverlay = document.getElementById('welcome-overlay');
  const pspFrame = document.getElementById('psp-frame');

  // Performance HUD
  const hud = new PerformanceHUD('performance-hud', 'frame-time-canvas');

  // Emulator Manager
  const emulator = new EmulatorManager(canvas, {
    onStatusChange: (state, text) => {
      setStatus(state, text);
      if (state === 'active' && welcomeOverlay) {
        welcomeOverlay.classList.add('hidden');
      }
    },
    onToast: (msg, type) => showToast(msg, type),
    onResolutionChange: (mult) => hud.setResolution(mult),
  });

  // Gamepad Manager
  const gamepad = new GamepadManager(canvas, (connected, id) => {
    const statusBox = document.getElementById('gamepad-status');
    const nameEl = document.getElementById('gamepad-name');
    if (statusBox && nameEl) {
      if (connected) {
        statusBox.classList.add('connected');
        nameEl.textContent = id ? id.split('(')[0].trim() : 'Gamepad Active';
        showToast(`Controller Connected: ${nameEl.textContent}`, 'success');
      } else {
        statusBox.classList.remove('connected');
        nameEl.textContent = 'No Gamepad';
        showToast('Controller Disconnected', 'warn');
      }
    }
  });

  // Touch Controls
  const touch = new TouchControls(canvas, 'touch-layer');

  // Game Library
  const library = new GameLibrary(
    (game) => {
      // Hide library modal
      closeAllModals();
      // Launch selected game
      emulator.launchGame(game);
    },
    (msg, type) => showToast(msg, type)
  );

  // Setup UI Interactions
  setupHeaderControls(emulator, library, touch, hud);
  setupWelcomeOverlay(emulator, library);
  setupModals(emulator);
  setupDropzone(library);
  setupFullscreen(pspFrame);

  // Set default resolution in HUD
  hud.setResolution(1);

  // Wait for library DB to load and check for autorun game
  setTimeout(() => {
    library.render('games-grid');
    const autoRunId = sessionStorage.getItem('zyqora_autorun_game_id');
    if (autoRunId) {
      sessionStorage.removeItem('zyqora_autorun_game_id');
      const allGames = [...library.preloadedGames, ...library.userGames];
      const match = allGames.find((g) => g.id === autoRunId);
      if (match) {
        console.log('[ZYQORA] Auto-running game from reload:', match.name);
        emulator.launchGame(match);
      }
    }
  }, 300);
});

function setupHeaderControls(emulator, library, touch, hud) {
  // Library Button
  const btnLibrary = document.getElementById('btn-open-library');
  const libraryModal = document.getElementById('library-modal');
  if (btnLibrary && libraryModal) {
    btnLibrary.addEventListener('click', () => {
      libraryModal.classList.add('open');
      library.render('games-grid');
    });
  }

  // File Input Selector
  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        library.importFile(file);
      }
      fileInput.value = '';
    });
  }

  // Save State (F3)
  document.getElementById('btn-save-state')?.addEventListener('click', () => emulator.saveState());

  // Load State (F4)
  document.getElementById('btn-load-state')?.addEventListener('click', () => emulator.loadState());

  // Toggle Touch Controls
  document.getElementById('btn-toggle-touch')?.addEventListener('click', () => {
    touch.toggle();
    showToast(touch.isVisible ? 'Touch Controls Enabled' : 'Touch Controls Hidden', 'info');
  });

  // Toggle HUD
  document.getElementById('btn-hud-toggle')?.addEventListener('click', () => {
    hud.toggle();
    showToast(hud.isVisible ? 'Performance HUD Shown' : 'Performance HUD Hidden', 'info');
  });

  // Pause
  document.getElementById('btn-dock-pause')?.addEventListener('click', () => emulator.togglePause());

  // Fast Forward
  document.getElementById('btn-dock-fastforward')?.addEventListener('click', () => emulator.fastForward());
}

function setupWelcomeOverlay(emulator, library) {
  document.getElementById('btn-quick-spelunky')?.addEventListener('click', () => {
    const spelunky = library.preloadedGames.find((g) => g.id === 'spelunky');
    if (spelunky) emulator.launchGame(spelunky);
  });

  document.getElementById('btn-quick-triangle')?.addEventListener('click', () => {
    const triangle = library.preloadedGames.find((g) => g.id === 'triangle');
    if (triangle) emulator.launchGame(triangle);
  });

  document.getElementById('btn-quick-browse')?.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });
}

function setupModals(emulator) {
  // Open Settings Modal
  const btnSettings = document.getElementById('btn-open-settings');
  const settingsModal = document.getElementById('settings-modal');
  if (btnSettings && settingsModal) {
    btnSettings.addEventListener('click', () => settingsModal.classList.add('open'));
  }

  // Close buttons
  document.querySelectorAll('.close-modal-btn').forEach((btn) => {
    btn.addEventListener('click', closeAllModals);
  });

  // Close on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeAllModals();
    });
  });

  // Settings Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(btn.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Settings Controls
  const selRes = document.getElementById('setting-resolution');
  if (selRes) {
    selRes.addEventListener('change', (e) => {
      emulator.setResolution(parseInt(e.target.value, 10));
    });
  }

  const selFrameSkip = document.getElementById('setting-frameskip');
  if (selFrameSkip) {
    selFrameSkip.addEventListener('change', (e) => {
      emulator.setFrameSkip(e.target.value);
    });
  }

  const chkPixelated = document.getElementById('setting-pixelated');
  if (chkPixelated) {
    chkPixelated.addEventListener('change', (e) => {
      const canvas = document.getElementById('canvas');
      if (canvas) {
        if (e.target.checked) canvas.classList.add('pixelated');
        else canvas.classList.remove('pixelated');
      }
      showToast(e.target.checked ? 'Pixelated Filtering Enabled' : 'Smooth Bilinear Filtering Enabled', 'info');
    });
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.classList.remove('open'));
}

function setupDropzone(library) {
  const dropzone = document.getElementById('rom-dropzone');
  if (!dropzone) return;

  dropzone.addEventListener('click', () => {
    document.getElementById('file-input')?.click();
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    window.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    window.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  window.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      library.importFile(file);
    }
  });
}

function setupFullscreen(frameEl) {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn || !frameEl) return;

  btn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      if (frameEl.requestFullscreen) {
        frameEl.requestFullscreen();
      } else if (frameEl.webkitRequestFullscreen) {
        frameEl.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      frameEl.classList.add('fullscreen');
      showToast('Entered Fullscreen (Press Esc to exit)', 'info');
    } else {
      frameEl.classList.remove('fullscreen');
    }
  });
}
