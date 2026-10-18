import { PerformanceHUD } from './ui/performance-hud.js';
import { GamepadManager } from './ui/gamepad.js';
import { TouchControls } from './ui/touch-controls.js';
import { GameLibrary } from './ui/library.js';
import { EmulatorManager } from './core/emulator-manager.js';
import { SupabaseService } from './services/supabase.ts';
import { GamingLoader } from './ui/gaming-loader.js';

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

  // Gaming Theme Boot Loader
  const gamingLoader = new GamingLoader('gaming-loader');

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
    onStreamingMetrics: (metrics, totalBytes) => hud.updateStreamingMetrics(metrics, totalBytes),
    onGamingLoaderStart: (name) => gamingLoader.show(name),
    onGamingLoaderProgress: (step, sub, pct, bytes) => gamingLoader.setStep(step, sub, pct, bytes),
    onGamingLoaderFinish: () => gamingLoader.finish(),
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

  // Screen Mode Manager
  const SCREEN_MODES = ['fit', 'fill', 'stretch'];
  let currentScreenModeIndex = 0;

  const savedScreenMode = localStorage.getItem('zyqora_screen_mode') || 'fit';
  currentScreenModeIndex = Math.max(0, SCREEN_MODES.indexOf(savedScreenMode));

  function applyScreenMode(mode, notify = true) {
    if (!pspFrame) return;
    pspFrame.classList.remove('screen-fit', 'screen-fill', 'screen-stretch');
    pspFrame.classList.add(`screen-${mode}`);
    localStorage.setItem('zyqora_screen_mode', mode);

    const labels = {
      fit: 'Fit (16:9 Aspect)',
      fill: 'Fill (Cover)',
      stretch: 'Stretch (Full View)',
    };

    const modeLabel = labels[mode] || mode;
    const btnScreen = document.getElementById('btn-screen-size');
    const btnDockScreen = document.getElementById('btn-dock-screen');
    const btnMobileScreen = document.getElementById('btn-mobile-screen');

    [btnScreen, btnDockScreen, btnMobileScreen].forEach((b) => {
      if (b) b.title = `Screen Mode: ${modeLabel}`;
    });

    if (notify) {
      showToast(`Screen Mode: ${modeLabel}`, 'info');
    }
  }

  function cycleScreenMode() {
    currentScreenModeIndex = (currentScreenModeIndex + 1) % SCREEN_MODES.length;
    applyScreenMode(SCREEN_MODES[currentScreenModeIndex], true);
  }

  // Initial Screen Mode
  applyScreenMode(SCREEN_MODES[currentScreenModeIndex], false);

  // Stats Overlay Manager
  const savedStatsVisible = localStorage.getItem('zyqora_stats_visible');
  if (savedStatsVisible !== null) {
    hud.toggle(savedStatsVisible === '1');
  }

  function toggleStats() {
    hud.toggle();
    const isVis = hud.isVisible;
    localStorage.setItem('zyqora_stats_visible', isVis ? '1' : '0');

    const btnToggleStats = document.getElementById('btn-toggle-stats');
    const btnDockStats = document.getElementById('btn-dock-stats');
    const btnHudToggle = document.getElementById('btn-hud-toggle');
    const btnMobileStats = document.getElementById('btn-mobile-stats');

    [btnToggleStats, btnDockStats, btnHudToggle, btnMobileStats].forEach((btn) => {
      if (btn) {
        if (isVis) btn.classList.add('active');
        else btn.classList.remove('active');
      }
    });

    showToast(isVis ? 'Performance Stats: Visible' : 'Performance Stats: Hidden', 'info');
  }

  // Setup UI Interactions
  setupHeaderControls(emulator, library, touch, hud, cycleScreenMode, toggleStats);
  setupWelcomeOverlay(emulator, library);
  setupModals(emulator);
  setupDropzone(library);
  setupFullscreen(pspFrame);
  setupCloudAuth(library);

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

function setupHeaderControls(emulator, library, touch, hud, cycleScreenMode, toggleStats) {
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
        library.handleGameFileIngestion(file);
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

  // Screen Size Cycling (Desktop & Mobile)
  document.getElementById('btn-screen-size')?.addEventListener('click', cycleScreenMode);
  document.getElementById('btn-dock-screen')?.addEventListener('click', cycleScreenMode);
  document.getElementById('btn-mobile-screen')?.addEventListener('click', cycleScreenMode);

  // Performance Stats Toggling (Desktop & Mobile)
  document.getElementById('btn-toggle-stats')?.addEventListener('click', toggleStats);
  document.getElementById('btn-dock-stats')?.addEventListener('click', toggleStats);
  document.getElementById('btn-hud-toggle')?.addEventListener('click', toggleStats);
  document.getElementById('btn-mobile-stats')?.addEventListener('click', toggleStats);

  // Pause
  document.getElementById('btn-dock-pause')?.addEventListener('click', () => emulator.togglePause());
  document.getElementById('btn-mobile-pause')?.addEventListener('click', () => emulator.togglePause());

  // Fast Forward
  document.getElementById('btn-dock-fastforward')?.addEventListener('click', () => emulator.fastForward());
  document.getElementById('btn-mobile-fastforward')?.addEventListener('click', () => emulator.fastForward());
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

  // Close on backdrop click (prevent closing cloud-upload-modal during upload)
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        if (backdrop.id === 'cloud-upload-modal') return;
        closeAllModals();
      }
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
  const cloudDropzone = document.getElementById('cloud-dropzone');

  if (dropzone) {
    dropzone.addEventListener('click', () => {
      document.getElementById('file-input')?.click();
    });
  }

  ['dragenter', 'dragover'].forEach((eventName) => {
    window.addEventListener(eventName, (e) => {
      e.preventDefault();
      if (dropzone) dropzone.classList.add('dragover');
      if (cloudDropzone) cloudDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    window.addEventListener(eventName, (e) => {
      e.preventDefault();
      if (dropzone) dropzone.classList.remove('dragover');
      if (cloudDropzone) cloudDropzone.classList.remove('dragover');
    });
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      library.handleGameFileIngestion(file);
    }
  });

  if (cloudDropzone) {
    cloudDropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        library.handleGameFileIngestion(file);
      }
    });
  }
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

function setupCloudAuth(library) {
  const supabase = SupabaseService.getInstance();
  const btnCloudSync = document.getElementById('btn-cloud-sync');
  const cloudAuthModal = document.getElementById('cloud-auth-modal');
  const labelEl = document.getElementById('cloud-sync-label');

  const sessionActiveBox = document.getElementById('auth-session-active');
  const userEmailEl = document.getElementById('auth-user-email');
  const formBox = document.getElementById('auth-form-container');

  const btnSignIn = document.getElementById('btn-auth-signin');
  const btnSignUp = document.getElementById('btn-auth-signup');
  const btnGuest = document.getElementById('btn-auth-guest');
  const btnSignOut = document.getElementById('btn-auth-signout');

  const emailInput = document.getElementById('auth-input-email');
  const passInput = document.getElementById('auth-input-password');

  const cfgUrlInput = document.getElementById('cfg-supabase-url');
  const cfgKeyInput = document.getElementById('cfg-supabase-key');
  const btnSaveCfg = document.getElementById('btn-save-supabase-cfg');

  // Fill existing config
  if (cfgUrlInput && cfgKeyInput) {
    cfgUrlInput.value = localStorage.getItem('zyqora_supabase_url') || import.meta.env.VITE_SUPABASE_URL || '';
    cfgKeyInput.value = localStorage.getItem('zyqora_supabase_anon_key') || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  }

  // Open modal
  if (btnCloudSync && cloudAuthModal) {
    btnCloudSync.addEventListener('click', () => {
      closeAllModals();
      cloudAuthModal.classList.add('open');
    });
  }

  // Listen for user changes
  supabase.onAuthChange((user) => {
    if (user) {
      if (sessionActiveBox) sessionActiveBox.style.display = 'block';
      if (formBox) formBox.style.display = 'none';
      if (userEmailEl) userEmailEl.textContent = user.email || 'Anonymous Guest';
      if (labelEl) labelEl.textContent = user.email ? user.email.split('@')[0] : 'Cloud Active';
    } else {
      if (sessionActiveBox) sessionActiveBox.style.display = 'none';
      if (formBox) formBox.style.display = 'block';
      if (labelEl) labelEl.textContent = 'Cloud';
    }
  });

  // Sign In
  if (btnSignIn && emailInput && passInput) {
    btnSignIn.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const pass = passInput.value.trim();
      if (!email || !pass) {
        showToast('Please enter both email and password', 'warn');
        return;
      }
      try {
        btnSignIn.textContent = 'Signing in...';
        await supabase.signInWithPassword(email, pass);
        showToast('Signed in to Supabase!', 'success');
        closeAllModals();
        library.loadCloudGames();
      } catch (e) {
        showToast(`Sign in error: ${e.message}`, 'error');
      } finally {
        btnSignIn.textContent = 'Sign In';
      }
    });
  }

  // Sign Up
  if (btnSignUp && emailInput && passInput) {
    btnSignUp.addEventListener('click', async () => {
      const email = emailInput.value.trim();
      const pass = passInput.value.trim();
      if (!email || !pass) {
        showToast('Please enter both email and password', 'warn');
        return;
      }
      try {
        btnSignUp.textContent = 'Signing up...';
        await supabase.signUp(email, pass);
        showToast('Sign up successful! Check email if confirmation is enabled.', 'success');
      } catch (e) {
        showToast(`Sign up error: ${e.message}`, 'error');
      } finally {
        btnSignUp.textContent = 'Sign Up';
      }
    });
  }

  // Guest / Anonymous
  if (btnGuest) {
    btnGuest.addEventListener('click', async () => {
      try {
        btnGuest.textContent = 'Creating session...';
        await supabase.signInAnonymously();
        showToast('Signed in as Guest!', 'success');
        closeAllModals();
        library.loadCloudGames();
      } catch (e) {
        showToast(`Guest session error: ${e.message}`, 'error');
      } finally {
        btnGuest.textContent = 'Guest Session (Anonymous Auth)';
      }
    });
  }

  // Sign Out
  if (btnSignOut) {
    btnSignOut.addEventListener('click', async () => {
      await supabase.signOut();
      showToast('Signed out of Supabase', 'info');
    });
  }

  // Save Credentials
  if (btnSaveCfg && cfgUrlInput && cfgKeyInput) {
    btnSaveCfg.addEventListener('click', () => {
      const url = cfgUrlInput.value.trim();
      const key = cfgKeyInput.value.trim();
      if (!url || !key) {
        showToast('Please provide both Project URL and Anon Key', 'warn');
        return;
      }
      const ok = supabase.setCustomCredentials(url, key);
      if (ok) {
        showToast('Supabase credentials saved successfully!', 'success');
      } else {
        showToast('Failed to initialize Supabase with provided credentials', 'error');
      }
    });
  }
}
