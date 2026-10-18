/**
 * ROM Library and File Import Manager with Supabase Cloud Streaming Integration
 */

import { SupabaseService } from '../services/supabase.ts';

export class GameLibrary {
  constructor(onSelectGame, onShowToast) {
    this.onSelectGame = onSelectGame;
    this.showToast = onShowToast || (() => {});
    this.dbName = 'zyqora_psp_roms';
    this.dbVersion = 1;
    this.db = null;

    this.preloadedGames = [
      {
        id: 'spelunky',
        name: 'Spelunky PSP',
        desc: 'Classic procedural roguelike platformer port for Sony PSP',
        format: 'PBP',
        size: '1.7 MB',
        url: '/roms/SpelunkyPSP.pbp',
        icon: 'SP',
        badge: 'Homebrew Game',
      },
      {
        id: 'triangle',
        name: 'GPU Triangle 3D Demo',
        desc: 'Direct PSP Graphics Engine (GE) hardware transform & lighting raster test',
        format: 'PRX',
        size: '154 KB',
        url: '/roms/triangle.prx',
        icon: '3D',
        badge: 'GPU Test',
      },
      {
        id: 'simple',
        name: 'GPU Simple Test',
        desc: 'PSP display list and register pipeline verification test',
        format: 'PRX',
        size: '130 KB',
        url: '/roms/simple.prx',
        icon: 'GE',
        badge: 'Kernel / GE',
      },
    ];

    this.userGames = [];
    this.cloudGames = [];
    this.activeTab = 'local'; // 'local' | 'cloud'
    this.currentUploadAbort = null;

    this.initDB();
    this.initCloud();
    this.setupTabs();
  }

  async initDB() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, this.dbVersion);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('games')) {
            db.createObjectStore('games', { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await this.loadUserGames();
    } catch (e) {
      console.warn('IndexedDB unavailable, falling back to memory store:', e);
    }
  }

  initCloud() {
    const supabase = SupabaseService.getInstance();
    supabase.onAuthChange((user) => {
      if (user) {
        this.loadCloudGames();
      } else {
        this.cloudGames = [];
        this.renderCloudGames();
      }
    });

    // Cloud upload file input
    const cloudFileInput = document.getElementById('cloud-file-input');
    const browseCloudBtn = document.getElementById('btn-browse-cloud-upload');
    if (browseCloudBtn && cloudFileInput) {
      browseCloudBtn.addEventListener('click', () => cloudFileInput.click());
      cloudFileInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
          this.uploadCloudFile(file);
          cloudFileInput.value = '';
        }
      });
    }

    // Refresh cloud button
    const refreshBtn = document.getElementById('btn-refresh-cloud');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadCloudGames());
    }
  }

  setupTabs() {
    const btnLocal = document.getElementById('tab-btn-local');
    const btnCloud = document.getElementById('tab-btn-cloud');
    const paneLocal = document.getElementById('pane-local-games');
    const paneCloud = document.getElementById('pane-cloud-games');

    if (btnLocal && btnCloud && paneLocal && paneCloud) {
      btnLocal.addEventListener('click', () => {
        btnLocal.classList.add('active');
        btnCloud.classList.remove('active');
        paneLocal.style.display = 'block';
        paneCloud.style.display = 'none';
        this.activeTab = 'local';
      });

      btnCloud.addEventListener('click', () => {
        btnCloud.classList.add('active');
        btnLocal.classList.remove('active');
        paneCloud.style.display = 'block';
        paneLocal.style.display = 'none';
        this.activeTab = 'cloud';
        this.loadCloudGames();
      });
    }
  }

  async loadUserGames() {
    if (!this.db) return;
    try {
      const tx = this.db.transaction('games', 'readonly');
      const store = tx.objectStore('games');
      const req = store.getAll();
      this.userGames = await new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      this.render();
    } catch (e) {
      console.error('Error loading stored games:', e);
    }
  }

  async loadCloudGames() {
    const supabase = SupabaseService.getInstance();
    if (!supabase.isConfigured() || !supabase.getUser()) {
      this.renderCloudGamesPromptLogin();
      return;
    }

    try {
      const games = await supabase.listUserGames();
      this.cloudGames = games;
      this.renderCloudGames();
    } catch (err) {
      console.error('[GameLibrary] Error loading cloud games:', err);
      this.showToast(`Failed to load cloud games: ${err.message}`, 'error');
    }
  }

  async uploadCloudFile(file) {
    if (!file) return;

    const supabase = SupabaseService.getInstance();
    if (!supabase.isConfigured() || !supabase.getUser()) {
      this.showToast('Please sign in to Supabase to upload cloud games.', 'warn');
      const authModal = document.getElementById('cloud-auth-modal');
      if (authModal) authModal.classList.add('active');
      return;
    }

    // Validate extension
    const ext = file.name.split('.').pop().toLowerCase();
    const validExts = ['iso', 'cso', 'chd', 'pbp', 'elf', 'prx'];
    if (!validExts.includes(ext)) {
      this.showToast(`Unsupported file extension (.${ext}). Expected .iso, .cso, or .pbp`, 'error');
      return;
    }

    // UI Progress Bar
    const progressBox = document.getElementById('cloud-upload-progress');
    const statusText = document.getElementById('upload-status-text');
    const percentText = document.getElementById('upload-percent-text');
    const progressBar = document.getElementById('upload-progress-bar');
    const cancelBtn = document.getElementById('btn-cancel-upload');

    if (progressBox) progressBox.style.display = 'block';
    if (statusText) statusText.textContent = `Uploading "${file.name}" to private bucket...`;

    try {
      const title = file.name.replace(/\.[^/.]+$/, '');
      const gameRecord = await supabase.uploadGame(file, title, (pct, loaded, total, currentPart, totalParts) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (percentText) {
          if (totalParts && totalParts > 1) {
            percentText.textContent = `Part ${currentPart}/${totalParts} (${pct}%)`;
          } else {
            percentText.textContent = `${pct}%`;
          }
        }
        if (statusText && totalParts && totalParts > 1) {
          statusText.textContent = `Uploading part ${currentPart} of ${totalParts} (40 MB chunks for Supabase Free Tier)...`;
        }
      });

      this.showToast(`Uploaded "${title}" to Supabase!`, 'success');
      await this.loadCloudGames();

      // Auto-launch uploaded game via on-demand cloud stream
      this.selectCloudGame(gameRecord);

    } catch (err) {
      console.error('[GameLibrary] Cloud upload error:', err);
      this.showToast(`Upload failed: ${err.message}`, 'error');
    } finally {
      if (progressBox) progressBox.style.display = 'none';
      if (progressBar) progressBar.style.width = '0%';
    }
  }

  async selectCloudGame(game) {
    const supabase = SupabaseService.getInstance();
    try {
      this.showToast(`Generating secure signed URL for ${game.title}...`, 'info');
      const isChunked = game.checksum?.startsWith('chunked:');

      // Create initial signed stream URL valid for 1 hour
      const signedUrl = isChunked
        ? await supabase.getSignedStreamUrlForPart(game.storage_path, 0, 3600)
        : await supabase.getSignedStreamUrl(game.storage_path, 3600);

      const streamGame = {
        id: game.id,
        name: game.title,
        fileName: game.filename,
        format: game.format,
        size: this.formatBytes(game.size_bytes),
        sizeBytes: game.size_bytes,
        storagePath: game.storage_path,
        isCloudStream: true,
        streamUrl: signedUrl,
        isChunked: isChunked,
        partSize: 40 * 1024 * 1024,
        getPartUrl: isChunked
          ? (partIndex) => supabase.getSignedStreamUrlForPart(game.storage_path, partIndex, 3600)
          : undefined,
      };

      this.selectGame(streamGame);

    } catch (err) {
      console.error('[GameLibrary] Failed to authorize stream:', err);
      this.showToast(`Streaming authorization failed: ${err.message}`, 'error');
    }
  }

  async deleteCloudGame(gameId, storagePath, checksum, e) {
    if (e) e.stopPropagation();
    if (!confirm('Are you sure you want to delete this game from your private cloud storage?')) return;

    const supabase = SupabaseService.getInstance();
    try {
      await supabase.deleteGame(gameId, storagePath, checksum);
      this.cloudGames = this.cloudGames.filter((g) => g.id !== gameId);
      this.renderCloudGames();
      this.showToast('Game deleted from cloud storage', 'warn');
    } catch (err) {
      this.showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  renderCloudGamesPromptLogin() {
    const container = document.getElementById('cloud-games-grid');
    if (!container) return;

    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 32px 16px; background: rgba(15, 23, 42, 0.4); border: 1px dashed rgba(14, 165, 233, 0.3); border-radius: 8px;">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" style="margin-bottom: 8px;">
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
        </svg>
        <div style="font-weight: 700; color: #fff; margin-bottom: 4px;">Sign in to Stream Cloud Games</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 14px;">Connect your Supabase account to access private game streaming without downloading ISOs.</div>
        <button class="btn-primary" id="btn-open-auth-from-library" style="margin: 0 auto; background: #0284c7;">
          Connect Supabase Account
        </button>
      </div>
    `;

    const btn = document.getElementById('btn-open-auth-from-library');
    if (btn) {
      btn.addEventListener('click', () => {
        const authModal = document.getElementById('cloud-auth-modal');
        if (authModal) authModal.classList.add('active');
      });
    }
  }

  renderCloudGames() {
    const container = document.getElementById('cloud-games-grid');
    if (!container) return;

    container.innerHTML = '';

    if (this.cloudGames.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 24px 16px; color: var(--text-dim); font-size: 13px;">
          No cloud games uploaded yet. Upload an ISO above to start streaming!
        </div>
      `;
      return;
    }

    this.cloudGames.forEach((game) => {
      const card = document.createElement('div');
      card.className = 'game-card';
      const sizeStr = this.formatBytes(game.size_bytes);

      card.innerHTML = `
        <div class="game-icon" style="color: #38bdf8;">☁</div>
        <div class="game-info">
          <div class="game-name" title="${game.title}">${game.title}</div>
          <div class="game-meta">
            <span class="game-badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8;">${game.format}</span>
            <span>${sizeStr}</span>
            <span style="color: #38bdf8; font-weight: 600;">Stream On-Demand</span>
          </div>
        </div>
        <button class="btn-icon delete-game-btn" title="Delete from cloud" style="position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; font-size: 11px;">✕</button>
      `;

      card.querySelector('.delete-game-btn').addEventListener('click', (e) => {
        this.deleteCloudGame(game.id, game.storage_path, e);
      });

      card.addEventListener('click', () => {
        document.querySelectorAll('.game-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        this.selectCloudGame(game);
      });

      container.appendChild(card);
    });
  }

  async importFile(file) {
    if (!file) return;

    // Validate extension
    const ext = file.name.split('.').pop().toLowerCase();
    const validExts = ['iso', 'cso', 'chd', 'pbp', 'elf', 'prx'];
    if (!validExts.includes(ext)) {
      this.showToast(`Unsupported file extension (.${ext}). Expected .iso, .cso, .pbp, .elf, or .prx`, 'error');
      return;
    }

    const sizeStr = this.formatBytes(file.size);
    const gameRecord = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name: file.name.replace(/\.[^/.]+$/, ''),
      fileName: file.name,
      format: ext.toUpperCase(),
      size: sizeStr,
      timestamp: Date.now(),
      blob: file,
      icon: ext.toUpperCase(),
      badge: 'Imported ROM',
    };

    if (this.db) {
      try {
        const tx = this.db.transaction('games', 'readwrite');
        tx.objectStore('games').put(gameRecord);
        await new Promise((res, rej) => {
          tx.oncomplete = res;
          tx.onerror = rej;
        });
      } catch (e) {
        console.warn('Could not store full binary into IndexedDB:', e);
      }
    }

    this.userGames.unshift(gameRecord);
    this.render();
    this.showToast(`Added "${file.name}" to Library!`, 'success');

    // Automatically trigger selection
    this.selectGame(gameRecord);
  }

  async deleteGame(id, e) {
    if (e) e.stopPropagation();
    if (this.db) {
      try {
        const tx = this.db.transaction('games', 'readwrite');
        tx.objectStore('games').delete(id);
      } catch (_) {}
    }
    this.userGames = this.userGames.filter((g) => g.id !== id);
    this.render();
    this.showToast('Game removed from library', 'warn');
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  selectGame(game) {
    this.onSelectGame(game);
  }

  render(gridContainerId = 'games-grid') {
    const container = document.getElementById(gridContainerId);
    if (!container) return;

    container.innerHTML = '';

    const allGames = [...this.preloadedGames, ...this.userGames];

    allGames.forEach((game) => {
      const card = document.createElement('div');
      card.className = 'game-card';
      card.innerHTML = `
        <div class="game-icon">${game.icon || 'PSP'}</div>
        <div class="game-info">
          <div class="game-name" title="${game.name}">${game.name}</div>
          <div class="game-meta">
            <span class="game-badge">${game.format}</span>
            <span>${game.size}</span>
            <span style="color: var(--accent-mint); font-weight: 500;">${game.badge}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        document.querySelectorAll('.game-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        this.selectGame(game);
      });

      container.appendChild(card);
    });
  }
}
