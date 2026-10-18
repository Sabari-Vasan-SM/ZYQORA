/**
 * RemoteGameFile: TypeScript Random-Access Streaming Adapter
 * Provides on-demand byte-range streaming with bounded LRU chunk caching,
 * request deduplication, read coalescing, network retry backoff, auth token refresh,
 * and transparent multi-part (40 MB) chunking to stay 100% within Supabase Free Tier limits.
 */

export interface RemoteGameFileOptions {
  chunkSize?: number;              // Default 1 MiB (1048576 bytes)
  maxCacheSize?: number;           // Default 32 MiB (33554432 bytes)
  maxConcurrentRequests?: number;  // Default 3
  retryAttempts?: number;          // Default 3
  retryDelayMs?: number;           // Default 500 ms
  gameVersionId?: string;          // Version/checksum tag to isolate cache
  isChunked?: boolean;             // True if file is split into 40 MB parts
  partSize?: number;               // Default 40 MiB (41943040 bytes)
  totalFileSize?: number;          // Known total file size for chunked games
  getPartUrl?: (partIndex: number) => Promise<string>; // Signed URL resolver per part
  onUrlRefresh?: () => Promise<string>; // Auth token refresh callback
  onMetrics?: (metrics: StreamingMetrics) => void;
}

export interface StreamingMetrics {
  bytesFetched: number;
  rangeRequestsCount: number;
  cacheHits: number;
  cacheMisses: number;
  hitRatePercent: number;
  averageLatencyMs: number;
  bufferingEvents: number;
  activeRequests: number;
}

export class RemoteGameFile {
  private url: string;
  private options: Required<RemoteGameFileOptions>;
  private totalSize: number | null = null;
  private isOpen = false;
  private abortController: AbortController | null = null;

  // Cached signed URLs for parts: partIndex -> { url: string, expiresAt: number }
  private partUrlCache = new Map<number, { url: string; expiresAt: number }>();

  // LRU Chunk Cache: chunkIndex -> Uint8Array
  private chunkCache = new Map<number, Uint8Array>();
  private currentCacheBytes = 0;

  // In-flight request deduplication: chunkIndex -> Promise<Uint8Array>
  private inFlightRequests = new Map<number, Promise<Uint8Array>>();

  // Diagnostics and metrics
  private metrics: StreamingMetrics = {
    bytesFetched: 0,
    rangeRequestsCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    hitRatePercent: 0,
    averageLatencyMs: 0,
    bufferingEvents: 0,
    activeRequests: 0,
  };

  private latencySamples: number[] = [];

  constructor(initialUrl: string, options: RemoteGameFileOptions = {}) {
    this.url = initialUrl;
    this.options = {
      chunkSize: options.chunkSize || 1024 * 1024, // 1 MiB
      maxCacheSize: options.maxCacheSize || 32 * 1024 * 1024, // 32 MiB
      maxConcurrentRequests: options.maxConcurrentRequests || 3,
      retryAttempts: options.retryAttempts ?? 3,
      retryDelayMs: options.retryDelayMs || 500,
      gameVersionId: options.gameVersionId || 'default',
      isChunked: options.isChunked || false,
      partSize: options.partSize || 40 * 1024 * 1024, // 40 MiB
      totalFileSize: options.totalFileSize || 0,
      getPartUrl: options.getPartUrl || (async (part) => this.url),
      onUrlRefresh: options.onUrlRefresh || (async () => this.url),
      onMetrics: options.onMetrics || (() => {}),
    };

    if (this.options.isChunked && this.options.totalFileSize > 0) {
      this.totalSize = this.options.totalFileSize;
    }
  }

  /**
   * Open the remote file, discover total size and verify Range capability
   */
  async open(): Promise<number> {
    if (this.isOpen && this.totalSize !== null) {
      return this.totalSize;
    }

    this.abortController = new AbortController();

    // Fetch the initial 1 MiB chunk (Chunk 0) to prime header cache and verify range support
    const initialEnd = this.options.chunkSize - 1;
    const probe = await this.fetchWithRetry(0, initialEnd, this.abortController.signal);
    this.isOpen = true;

    if (this.totalSize === null || this.totalSize === 0) {
      this.totalSize = probe.totalSize;
    }

    // Cache the full initial chunk
    if (probe.chunkData && probe.chunkData.length > 0) {
      this.putChunk(0, probe.chunkData);
    }

    return this.totalSize;
  }

  /**
   * Return the total file size in bytes
   */
  size(): number {
    if (this.totalSize === null) {
      throw new Error('RemoteGameFile is not open. Call open() first.');
    }
    return this.totalSize;
  }

  /**
   * Read arbitrary byte range [offset, offset + length - 1]
   */
  async read(offset: number, length: number): Promise<Uint8Array> {
    if (!this.isOpen || this.totalSize === null) {
      await this.open();
    }

    if (length <= 0) {
      return new Uint8Array(0);
    }

    const fileSize = this.totalSize!;
    if (offset < 0 || offset >= fileSize) {
      throw new RangeError(`Offset ${offset} is out of bounds for file of size ${fileSize}`);
    }

    const actualLength = Math.min(length, fileSize - offset);
    const endOffset = offset + actualLength - 1;

    // Calculate chunks required
    const startChunk = Math.floor(offset / this.options.chunkSize);
    const endChunk = Math.floor(endOffset / this.options.chunkSize);

    const result = new Uint8Array(actualLength);

    // Fetch required chunks
    for (let c = startChunk; c <= endChunk; c++) {
      const chunk = await this.getOrFetchChunk(c);
      const chunkStartOffset = c * this.options.chunkSize;
      const chunkEndOffset = chunkStartOffset + chunk.length - 1;

      // Calculate intersection between requested slice and this chunk
      const readStart = Math.max(offset, chunkStartOffset);
      const readEnd = Math.min(endOffset, chunkEndOffset);

      const sourceStart = readStart - chunkStartOffset;
      const sourceEnd = readEnd - chunkStartOffset + 1;
      const destStart = readStart - offset;

      result.set(chunk.subarray(sourceStart, sourceEnd), destStart);
    }

    return result;
  }

  /**
   * Prefetch chunks asynchronously in the background
   */
  prefetch(offset: number, length: number): void {
    if (!this.isOpen || this.totalSize === null) return;

    const startChunk = Math.floor(offset / this.options.chunkSize);
    const endOffset = Math.min(offset + length - 1, this.totalSize - 1);
    const endChunk = Math.floor(endOffset / this.options.chunkSize);

    for (let c = startChunk; c <= endChunk; c++) {
      if (!this.chunkCache.has(c) && !this.inFlightRequests.has(c)) {
        this.getOrFetchChunk(c).catch(() => {});
      }
    }
  }

  /**
   * Get chunk from cache or queue a network request with deduplication
   */
  private async getOrFetchChunk(chunkIndex: number): Promise<Uint8Array> {
    // 1. Cache hit
    const cached = this.chunkCache.get(chunkIndex);
    if (cached) {
      this.chunkCache.delete(chunkIndex);
      this.chunkCache.set(chunkIndex, cached);

      this.metrics.cacheHits++;
      this.updateMetrics();
      return cached;
    }

    this.metrics.cacheMisses++;
    this.updateMetrics();

    // 2. Request Deduplication: In-flight check
    const existingPromise = this.inFlightRequests.get(chunkIndex);
    if (existingPromise) {
      return existingPromise;
    }

    // 3. New fetch promise
    const fetchPromise = (async () => {
      const start = chunkIndex * this.options.chunkSize;
      const end = Math.min(start + this.options.chunkSize - 1, (this.totalSize || start + this.options.chunkSize) - 1);

      this.metrics.bufferingEvents++;
      this.metrics.activeRequests++;
      this.updateMetrics();

      const startTime = performance.now();
      try {
        const signal = this.abortController?.signal;
        const resp = await this.fetchWithRetry(start, end, signal);
        const chunkData = resp.chunkData;

        // Store into LRU cache
        this.putChunk(chunkIndex, chunkData);

        const latency = performance.now() - startTime;
        this.latencySamples.push(latency);
        if (this.latencySamples.length > 20) this.latencySamples.shift();
        this.metrics.averageLatencyMs = Math.round(
          this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length
        );

        return chunkData;
      } finally {
        this.inFlightRequests.delete(chunkIndex);
        this.metrics.activeRequests--;
        this.updateMetrics();
      }
    })();

    this.inFlightRequests.set(chunkIndex, fetchPromise);
    return fetchPromise;
  }

  /**
   * Resolve signed URL for a 40 MB part (with 50-minute local caching)
   */
  private async resolvePartUrl(partIndex: number): Promise<string> {
    const cached = this.partUrlCache.get(partIndex);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.url;
    }

    const signedUrl = await this.options.getPartUrl(partIndex);
    // Cache for 50 minutes (signed URLs are usually valid for 60 min)
    this.partUrlCache.set(partIndex, {
      url: signedUrl,
      expiresAt: now + 50 * 60 * 1000,
    });
    return signedUrl;
  }

  /**
   * Execute fetch with exponential backoff and auth token expiration handling
   * Handles multi-part files transparently across 40 MB part boundaries
   */
  private async fetchWithRetry(
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<{ chunkData: Uint8Array; totalSize: number }> {
    // If not a chunked file, use standard single-file fetch
    if (!this.options.isChunked) {
      return this.fetchSingleRange(this.url, start, end, signal);
    }

    // Chunked multi-part mode (40 MB parts)
    const partSize = this.options.partSize;
    const startPart = Math.floor(start / partSize);
    const endPart = Math.floor(end / partSize);

    // Common case: 1 MiB chunk falls completely within a single 40 MB part
    if (startPart === endPart) {
      const partUrl = await this.resolvePartUrl(startPart);
      const subStart = start - startPart * partSize;
      const subEnd = end - startPart * partSize;
      const res = await this.fetchSingleRange(partUrl, subStart, subEnd, signal);
      return {
        chunkData: res.chunkData,
        totalSize: this.totalSize || (startPart * partSize + res.totalSize),
      };
    }

    // Edge case: chunk spans across two 40 MB parts
    const boundary = (startPart + 1) * partSize;
    const [part1Res, part2Res] = await Promise.all([
      (async () => {
        const url1 = await this.resolvePartUrl(startPart);
        const s1 = start - startPart * partSize;
        const e1 = partSize - 1;
        return this.fetchSingleRange(url1, s1, e1, signal);
      })(),
      (async () => {
        const url2 = await this.resolvePartUrl(endPart);
        const s2 = 0;
        const e2 = end - endPart * partSize;
        return this.fetchSingleRange(url2, s2, e2, signal);
      })(),
    ]);

    const combined = new Uint8Array(part1Res.chunkData.length + part2Res.chunkData.length);
    combined.set(part1Res.chunkData, 0);
    combined.set(part2Res.chunkData, part1Res.chunkData.length);

    return {
      chunkData: combined,
      totalSize: this.totalSize || (endPart * partSize + part2Res.totalSize),
    };
  }

  private async fetchSingleRange(
    targetUrl: string,
    start: number,
    end: number,
    signal?: AbortSignal
  ): Promise<{ chunkData: Uint8Array; totalSize: number }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.options.retryAttempts; attempt++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted by user', 'AbortError');
      }

      try {
        let currentUrl = targetUrl;
        const resp = await fetch(currentUrl, {
          method: 'GET',
          headers: {
            Range: `bytes=${start}-${end}`,
          },
          signal,
        });

        // Handle expired token or auth failure (401 Unauthorized / 403 Forbidden)
        if (resp.status === 401 || resp.status === 403) {
          console.warn(`[RemoteGameFile] Auth error (${resp.status}), attempting URL refresh...`);
          const refreshedUrl = await this.options.onUrlRefresh();
          if (refreshedUrl && refreshedUrl !== currentUrl) {
            currentUrl = refreshedUrl;
            continue;
          }
        }

        if (resp.status === 200) {
          throw new Error('Server returned full file (HTTP 200) instead of HTTP 206 Partial Content. Byte-range is not supported.');
        }

        if (resp.status !== 206) {
          throw new Error(`HTTP Range Request failed with status ${resp.status} ${resp.statusText}`);
        }

        let totalLength = this.totalSize || this.options.totalFileSize || 0;
        const contentRange = resp.headers.get('Content-Range');
        if (contentRange) {
          const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
          if (match && match[3] !== '*') {
            totalLength = parseInt(match[3], 10);
          }
        }

        const arrayBuf = await resp.arrayBuffer();
        const chunkData = new Uint8Array(arrayBuf);

        this.metrics.bytesFetched += chunkData.byteLength;
        this.metrics.rangeRequestsCount++;
        this.updateMetrics();

        return { chunkData, totalSize: totalLength };

      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        lastError = err;

        if (attempt < this.options.retryAttempts) {
          const delay = this.options.retryDelayMs * Math.pow(2, attempt);
          await new Promise((res) => setTimeout(res, delay));
        }
      }
    }

    throw lastError || new Error(`Failed to fetch range ${start}-${end} after ${this.options.retryAttempts} retries`);
  }

  /**
   * Insert chunk into LRU cache and evict old chunks when maxCacheSize is exceeded
   */
  private putChunk(chunkIndex: number, chunk: Uint8Array): void {
    if (this.chunkCache.has(chunkIndex)) {
      this.currentCacheBytes -= this.chunkCache.get(chunkIndex)!.byteLength;
      this.chunkCache.delete(chunkIndex);
    }

    while (this.currentCacheBytes + chunk.byteLength > this.options.maxCacheSize && this.chunkCache.size > 0) {
      const oldestKey = this.chunkCache.keys().next().value;
      if (oldestKey !== undefined) {
        const evicted = this.chunkCache.get(oldestKey);
        if (evicted) {
          this.currentCacheBytes -= evicted.byteLength;
        }
        this.chunkCache.delete(oldestKey);
      } else {
        break;
      }
    }

    this.chunkCache.set(chunkIndex, chunk);
    this.currentCacheBytes += chunk.byteLength;
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.inFlightRequests.clear();
  }

  close(): void {
    this.cancel();
    this.chunkCache.clear();
    this.partUrlCache.clear();
    this.currentCacheBytes = 0;
    this.isOpen = false;
    this.totalSize = null;
  }

  getMetrics(): StreamingMetrics {
    return { ...this.metrics };
  }

  private updateMetrics(): void {
    const totalLookups = this.metrics.cacheHits + this.metrics.cacheMisses;
    this.metrics.hitRatePercent = totalLookups > 0 ? Math.round((this.metrics.cacheHits / totalLookups) * 100) : 0;
    this.options.onMetrics(this.metrics);
  }
}
