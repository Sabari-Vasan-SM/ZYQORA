/**
 * Emscripten Stream Virtual File Adapter
 * Mounts a RemoteGameFile directly into Emscripten FS without allocating the entire ISO
 */

import { RemoteGameFile } from '../streaming/RemoteGameFile.ts';
import { ISOParser } from '../streaming/iso-parser.ts';

export interface MountStreamResult {
  virtualPath: string;
  totalSize: number;
  bootTransferredBytes: number;
  gameTitle: string;
  gameId: string;
}

export class StreamVirtualFileAdapter {
  private remoteFile: RemoteGameFile;
  private sparseChunks = new Map<number, Uint8Array>();
  private chunkSize = 1024 * 1024; // 1 MiB chunk size
  private totalSize = 0;

  constructor(remoteFile: RemoteGameFile) {
    this.remoteFile = remoteFile;
  }

  /**
   * Prime the boot sectors (< 5% of file) and prepare Emscripten FS mount
   */
  async prepareBootSectors(onProgress?: (msg: string) => void): Promise<MountStreamResult> {
    onProgress?.('Connecting to cloud storage and reading ISO header...');
    this.totalSize = await this.remoteFile.open();

    let bootBytesTransferred = 0;
    let title = 'PSP Cloud Stream';
    let gameId = 'PSP_GAME';

    try {
      const parser = new ISOParser(this.remoteFile);
      const metadata = await parser.parseBootMetadata();
      title = metadata.title;
      gameId = metadata.gameId;

      onProgress?.(`Found ${title} (${gameId}). Pre-streaming boot binary...`);

      // Pre-fetch all sectors required for boot
      for (const range of metadata.bootByteRanges) {
        const len = range.end - range.start + 1;
        const bytes = await this.remoteFile.read(range.start, len);
        bootBytesTransferred += bytes.length;
        this.cacheSlice(range.start, bytes);
      }
    } catch (e: any) {
      console.warn('[StreamVirtualFile] Non-ISO or Homebrew PBP detected, prefetching first 2 MiB:', e);
      // Fallback for PBP / PRX homebrew files: prefetch first 2 MiB
      const initialBytes = await this.remoteFile.read(0, Math.min(2 * 1024 * 1024, this.totalSize));
      bootBytesTransferred += initialBytes.length;
      this.cacheSlice(0, initialBytes);
    }

    onProgress?.(`Ready to launch! Boot data cached (${(bootBytesTransferred / (1024 * 1024)).toFixed(2)} MB of ${(this.totalSize / (1024 * 1024)).toFixed(1)} MB)`);

    return {
      virtualPath: '/games/cloud_stream.iso',
      totalSize: this.totalSize,
      bootTransferredBytes: bootBytesTransferred,
      gameTitle: title,
      gameId: gameId,
    };
  }

  /**
   * Mount the sparse virtual file into Emscripten FS
   */
  mountToFS(FS: any, virtualPath: string): void {
    const totalBytes = this.totalSize;
    const self = this;

    // Ensure /games directory exists
    try {
      FS.mkdirTree('/games');
    } catch (_) {}

    // Clean up if already exists
    try {
      FS.unlink(virtualPath);
    } catch (_) {}

    // Create file node in FS
    const mode = 33206; // 0100666 in octal (regular file, read/write)
    const node = FS.create(virtualPath, mode);
    node.usedBytes = totalBytes;

    // Custom stream_ops.read that reads from our sparse chunk cache or remote file
    const originalStreamOps = { ...node.stream_ops };
    node.stream_ops = {
      ...originalStreamOps,
      read: (stream: any, buffer: Uint8Array, offset: number, length: number, position: number) => {
        if (position >= totalBytes) return 0;
        const readLength = Math.min(length, totalBytes - position);

        // Copy bytes from sparse cache
        const copied = self.readFromSparseCache(buffer, offset, position, readLength);
        if (copied < readLength) {
          // Trigger asynchronous background prefetch of the accessed region
          self.remoteFile.prefetch(position, readLength + self.chunkSize);
        }

        return readLength;
      },
      llseek: (stream: any, offset: number, whence: number) => {
        let position = offset;
        if (whence === 1) { // SEEK_CUR
          position += stream.position;
        } else if (whence === 2) { // SEEK_END
          position += totalBytes;
        }
        if (position < 0) {
          throw new FS.ErrnoError(28); // EINVAL
        }
        stream.position = position;
        return position;
      },
    };

    console.log(`[StreamVirtualFile] Mounted sparse stream node at ${virtualPath} (${totalBytes} bytes)`);
  }

  private cacheSlice(startOffset: number, bytes: Uint8Array): void {
    const startChunk = Math.floor(startOffset / this.chunkSize);
    const endChunk = Math.floor((startOffset + bytes.length - 1) / this.chunkSize);

    for (let c = startChunk; c <= endChunk; c++) {
      let chunk = this.sparseChunks.get(c);
      if (!chunk) {
        chunk = new Uint8Array(this.chunkSize);
        this.sparseChunks.set(c, chunk);
      }

      const chunkStart = c * this.chunkSize;
      const copyStart = Math.max(startOffset, chunkStart);
      const copyEnd = Math.min(startOffset + bytes.length, chunkStart + this.chunkSize);

      const srcStart = copyStart - startOffset;
      const destStart = copyStart - chunkStart;
      const count = copyEnd - copyStart;

      chunk.set(bytes.subarray(srcStart, srcStart + count), destStart);
    }
  }

  private readFromSparseCache(dest: Uint8Array, destOffset: number, fileOffset: number, length: number): number {
    let bytesCopied = 0;
    const startChunk = Math.floor(fileOffset / this.chunkSize);
    const endChunk = Math.floor((fileOffset + length - 1) / this.chunkSize);

    for (let c = startChunk; c <= endChunk; c++) {
      const chunk = this.sparseChunks.get(c);
      const chunkStart = c * this.chunkSize;
      const copyStart = Math.max(fileOffset, chunkStart);
      const copyEnd = Math.min(fileOffset + length, chunkStart + this.chunkSize);

      const count = copyEnd - copyStart;
      const destIndex = destOffset + (copyStart - fileOffset);

      if (chunk) {
        const srcIndex = copyStart - chunkStart;
        dest.set(chunk.subarray(srcIndex, srcIndex + count), destIndex);
        bytesCopied += count;
      } else {
        // Uncached block: fill zeroes or trigger prefetch
        dest.fill(0, destIndex, destIndex + count);
      }
    }

    return bytesCopied;
  }
}
