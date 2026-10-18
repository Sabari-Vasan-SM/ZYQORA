/**
 * Gaming-themed Boot Sequence Loader Overlay Controller
 * Provides catchy animated telemetry and step transitions for cloud streaming
 */
export class GamingLoader {
  constructor(containerId = 'gaming-loader') {
    this.container = document.getElementById(containerId);
    this.titleEl = document.getElementById('gaming-loader-title');
    this.stepEl = document.getElementById('gaming-loader-step');
    this.subEl = document.getElementById('gaming-loader-sub');
    this.barEl = document.getElementById('gaming-loader-bar');
    this.bytesEl = document.getElementById('gaming-loader-bytes');
    this.speedEl = document.getElementById('gaming-loader-speed');
    this.tickerEl = document.getElementById('gaming-loader-ticker');

    this.currentPct = 0;
    this.isVisible = false;
    this.stepInterval = null;

    // Default catchy gaming phrases for boot stages
    this.catchyPhrases = [
      { step: 'INITIALIZING', sub: 'Connecting to Supabase Storage byte stream...' },
      { step: 'DOWNLOADING PACKETS', sub: 'Streaming ISO Primary Volume Descriptors & path tables...' },
      { step: 'PARSING ISO DESCRIPTORS', sub: 'Mapping UDF sector index and executable PRX binaries...' },
      { step: 'COMPILING SHADERS & PRX', sub: 'Compiling Allegrex MIPS instructions and WebGL shaders...' },
      { step: 'STARTING PSP ENGINE', sub: 'Initializing virtual GE hardware and ATRAC3+ audio synths...' },
      { step: 'BOOTING THE GAME', sub: 'Executing PSP system boot vector. Get ready!' },
    ];
  }

  show(gameTitle = 'PSP GAME') {
    if (!this.container) return;
    this.isVisible = true;
    this.currentPct = 5;

    if (this.titleEl) this.titleEl.textContent = gameTitle.toUpperCase();
    if (this.stepEl) this.stepEl.textContent = 'CONNECTING TO CLOUD';
    if (this.subEl) this.subEl.textContent = 'Negotiating HTTP byte ranges with Supabase storage...';
    if (this.barEl) this.barEl.style.width = '5%';
    if (this.bytesEl) this.bytesEl.textContent = '0.0 MB / 0 MB SYNCED';

    this.container.classList.remove('hidden');
    this.startCatchyTicker();
  }

  setStep(stepText, subText, targetPct, bytesStr) {
    if (!this.isVisible) return;

    if (this.stepEl && stepText) {
      this.stepEl.textContent = stepText.toUpperCase();
    }
    if (this.subEl && subText) {
      this.subEl.textContent = subText;
    }
    if (targetPct !== undefined && this.barEl) {
      this.currentPct = Math.max(this.currentPct, Math.min(targetPct, 98));
      this.barEl.style.width = `${this.currentPct}%`;
    }
    if (bytesStr && this.bytesEl) {
      this.bytesEl.textContent = bytesStr;
    }
  }

  startCatchyTicker() {
    clearInterval(this.stepInterval);
    let index = 0;
    this.stepInterval = setInterval(() => {
      if (!this.isVisible) {
        clearInterval(this.stepInterval);
        return;
      }
      if (this.currentPct < 90) {
        index = (index + 1) % this.catchyPhrases.length;
        const phrase = this.catchyPhrases[index];
        // Only advance step text automatically if we are still loading
        if (this.currentPct < 70) {
          this.setStep(phrase.step, phrase.sub, this.currentPct + 8);
        }
      }
    }, 1400);
  }

  finish() {
    if (!this.container || !this.isVisible) return;
    clearInterval(this.stepInterval);

    this.setStep('BOOTING THE GAME', 'Executing game entrypoint. Welcome to ZYQORA.', 100);

    setTimeout(() => {
      this.hide();
    }, 450);
  }

  hide() {
    if (!this.container) return;
    this.isVisible = false;
    clearInterval(this.stepInterval);
    this.container.classList.add('hidden');
  }
}
