/**
 * ROM Library and File Import Manager
 */
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
    this.initDB();
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
    if (bytes === 0) return '0 B';
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
        // Mark active
        document.querySelectorAll('.game-card').forEach((c) => c.classList.remove('active'));
        card.classList.add('active');
        this.selectGame(game);
      });

      container.appendChild(card);
    });
  }
}
