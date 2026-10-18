/**
 * Fast ISO 9660 Sector Parser for PlayStation Portable (PSP) Images
 * Discovers Volume Descriptor, Directory Records, PARAM.SFO, and EBOOT.BIN sector locations
 * enabling instant boot with < 1% data transfer.
 */

import { RemoteGameFile } from './RemoteGameFile.ts';

export interface PSPBootMetadata {
  title: string;
  gameId: string;
  totalSizeBytes: number;
  rootDirectorySector: number;
  paramSfoSector?: number;
  paramSfoSize?: number;
  ebootSector?: number;
  ebootSizeBytes?: number;
  bootByteRanges: Array<{ start: number; end: number }>;
}

export class ISOParser {
  private file: RemoteGameFile;

  constructor(file: RemoteGameFile) {
    this.file = file;
  }

  /**
   * Parse the ISO 9660 PVD and discover exact sectors needed to boot
   */
  async parseBootMetadata(): Promise<PSPBootMetadata> {
    const totalSize = await this.file.open();

    // 1. Read Sector 16: Primary Volume Descriptor (Offset 32768 = 0x8000)
    const pvdBytes = await this.file.read(32768, 2048);

    // Verify 'CD001' signature at byte offset 1-5
    const id = String.fromCharCode(...pvdBytes.subarray(1, 6));
    if (id !== 'CD001') {
      throw new Error(`Invalid ISO 9660 image: expected "CD001" at sector 16, got "${id}"`);
    }

    // Volume Title (Bytes 40-71)
    const rawTitle = new TextDecoder().decode(pvdBytes.subarray(40, 72)).trim();

    // Root Directory Record starts at byte 156 of PVD
    const rootDirRecord = pvdBytes.subarray(156, 190);
    const rootLbn = this.readUint32LE(rootDirRecord, 2);
    const rootLength = this.readUint32LE(rootDirRecord, 10);

    const metadata: PSPBootMetadata = {
      title: rawTitle || 'PSP Game',
      gameId: 'PSP_GAME',
      totalSizeBytes: totalSize,
      rootDirectorySector: rootLbn,
      bootByteRanges: [
        // Sectors 0-31: System area + PVD + Volume Descriptor Set Terminators (64 KB)
        { start: 0, end: Math.min(totalSize - 1, 65535) },
        // Root directory record
        { start: rootLbn * 2048, end: Math.min(totalSize - 1, rootLbn * 2048 + Math.max(rootLength, 4096) - 1) },
      ],
    };

    // 2. Read Root Directory to find 'PSP_GAME' directory record
    const rootBytes = await this.file.read(rootLbn * 2048, Math.min(rootLength, 32768));
    const rootEntries = this.parseDirectoryEntries(rootBytes);
    const pspGameEntry = rootEntries.find((e) => e.name.toUpperCase() === 'PSP_GAME');

    if (pspGameEntry) {
      metadata.bootByteRanges.push({
        start: pspGameEntry.lbn * 2048,
        end: Math.min(totalSize - 1, pspGameEntry.lbn * 2048 + Math.max(pspGameEntry.length, 4096) - 1),
      });

      // 3. Read PSP_GAME directory to find PARAM.SFO and SYSDIR
      const pspGameBytes = await this.file.read(pspGameEntry.lbn * 2048, Math.min(pspGameEntry.length, 65536));
      const pspGameEntries = this.parseDirectoryEntries(pspGameBytes);

      // Find PARAM.SFO
      const paramSfo = pspGameEntries.find((e) => e.name.toUpperCase() === 'PARAM.SFO');
      if (paramSfo) {
        metadata.paramSfoSector = paramSfo.lbn;
        metadata.paramSfoSize = paramSfo.length;
        metadata.bootByteRanges.push({
          start: paramSfo.lbn * 2048,
          end: Math.min(totalSize - 1, paramSfo.lbn * 2048 + paramSfo.length - 1),
        });

        // Try reading PARAM.SFO to extract real Title and Game ID
        try {
          const sfoBytes = await this.file.read(paramSfo.lbn * 2048, paramSfo.length);
          const sfoInfo = this.parseParamSfo(sfoBytes);
          if (sfoInfo.title) metadata.title = sfoInfo.title;
          if (sfoInfo.discId) metadata.gameId = sfoInfo.discId;
        } catch (_) {}
      }

      // Find SYSDIR directory
      const sysDir = pspGameEntries.find((e) => e.name.toUpperCase() === 'SYSDIR');
      if (sysDir) {
        metadata.bootByteRanges.push({
          start: sysDir.lbn * 2048,
          end: Math.min(totalSize - 1, sysDir.lbn * 2048 + Math.max(sysDir.length, 4096) - 1),
        });

        const sysDirBytes = await this.file.read(sysDir.lbn * 2048, Math.min(sysDir.length, 32768));
        const sysEntries = this.parseDirectoryEntries(sysDirBytes);

        // Crucial: prioritize EBOOT.BIN (the primary executable)
        const ebootEntry = sysEntries.find((e) => e.name.toUpperCase() === 'EBOOT.BIN');
        if (ebootEntry) {
          metadata.ebootSector = ebootEntry.lbn;
          metadata.ebootSizeBytes = ebootEntry.length;
          metadata.bootByteRanges.push({
            start: ebootEntry.lbn * 2048,
            end: Math.min(totalSize - 1, ebootEntry.lbn * 2048 + ebootEntry.length - 1),
          });
        }

        // Also prefetch BOOT.BIN if present
        const bootEntry = sysEntries.find((e) => e.name.toUpperCase() === 'BOOT.BIN');
        if (bootEntry) {
          metadata.bootByteRanges.push({
            start: bootEntry.lbn * 2048,
            end: Math.min(totalSize - 1, bootEntry.lbn * 2048 + bootEntry.length - 1),
          });
        }

        // Prefetch any other PRX modules in SYSDIR
        for (const entry of sysEntries) {
          const name = entry.name.toUpperCase();
          if (name.endsWith('.PRX') || name === 'OPNSSMP.BIN') {
            metadata.bootByteRanges.push({
              start: entry.lbn * 2048,
              end: Math.min(totalSize - 1, entry.lbn * 2048 + entry.length - 1),
            });
          }
        }
      }

      // 4. Read USRDIR to prefetch game index tables, disc info, and movie decoder PRXs
      const usrDir = pspGameEntries.find((e) => e.name.toUpperCase() === 'USRDIR');
      if (usrDir) {
        metadata.bootByteRanges.push({
          start: usrDir.lbn * 2048,
          end: Math.min(totalSize - 1, usrDir.lbn * 2048 + Math.max(usrDir.length, 4096) - 1),
        });

        try {
          const usrBytes = await this.file.read(usrDir.lbn * 2048, Math.min(usrDir.length, 32768));
          const usrEntries = this.parseDirectoryEntries(usrBytes);

          for (const entry of usrEntries) {
            const ext = entry.name.toUpperCase().split('.').pop() || '';

            if (entry.isDir) {
              // Recurse into subdirectories (e.g. USRDIR/modules, USRDIR/movie)
              metadata.bootByteRanges.push({
                start: entry.lbn * 2048,
                end: Math.min(totalSize - 1, entry.lbn * 2048 + Math.max(entry.length, 4096) - 1),
              });

              try {
                const subBytes = await this.file.read(entry.lbn * 2048, Math.min(entry.length, 32768));
                const subEntries = this.parseDirectoryEntries(subBytes);
                for (const sub of subEntries) {
                  const subExt = sub.name.toUpperCase().split('.').pop() || '';
                  if (['PRX', 'BIN', 'IDX', 'SFO'].includes(subExt) && sub.length < 5 * 1024 * 1024) {
                    metadata.bootByteRanges.push({
                      start: sub.lbn * 2048,
                      end: Math.min(totalSize - 1, sub.lbn * 2048 + sub.length - 1),
                    });
                  } else if (subExt === 'PMF') {
                    // Prefetch small looping title PMF or initial 2 MB of opening movie
                    const prefetchLen = sub.length < 2 * 1024 * 1024 ? sub.length : 2 * 1024 * 1024;
                    if (sub.name.toUpperCase().includes('TITLE') || sub.name.toUpperCase().includes('OPEN')) {
                      metadata.bootByteRanges.push({
                        start: sub.lbn * 2048,
                        end: Math.min(totalSize - 1, sub.lbn * 2048 + prefetchLen - 1),
                      });
                    }
                  }
                }
              } catch (_) {}
            } else if (['PRX', 'BIN', 'IDX', 'SFO'].includes(ext) && entry.length < 5 * 1024 * 1024) {
              metadata.bootByteRanges.push({
                start: entry.lbn * 2048,
                end: Math.min(totalSize - 1, entry.lbn * 2048 + entry.length - 1),
              });
            } else if (ext === 'PMF' && (entry.name.toUpperCase().includes('TITLE') || entry.name.toUpperCase().includes('OPEN'))) {
              const prefetchLen = entry.length < 2 * 1024 * 1024 ? entry.length : 2 * 1024 * 1024;
              metadata.bootByteRanges.push({
                start: entry.lbn * 2048,
                end: Math.min(totalSize - 1, entry.lbn * 2048 + prefetchLen - 1),
              });
            }
          }
        } catch (_) {}
      }
    }

    return metadata;
  }

  private readUint32LE(buf: Uint8Array, offset: number): number {
    return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
  }

  private parseDirectoryEntries(dirBytes: Uint8Array): Array<{ name: string; lbn: number; length: number; isDir: boolean }> {
    const entries: Array<{ name: string; lbn: number; length: number; isDir: boolean }> = [];
    let offset = 0;

    while (offset < dirBytes.length) {
      const recordLen = dirBytes[offset];
      if (recordLen === 0) {
        // Skip padding to next sector
        offset = Math.ceil((offset + 1) / 2048) * 2048;
        continue;
      }

      const lbn = this.readUint32LE(dirBytes, offset + 2);
      const dataLen = this.readUint32LE(dirBytes, offset + 10);
      const flags = dirBytes[offset + 25];
      const isDir = (flags & 2) !== 0;
      const nameLen = dirBytes[offset + 32];
      const rawName = String.fromCharCode(...dirBytes.subarray(offset + 33, offset + 33 + nameLen));
      const cleanName = rawName.split(';')[0]; // Strip ISO 9660 version suffix ';1'

      if (cleanName && cleanName !== '\x00' && cleanName !== '\x01') {
        entries.push({ name: cleanName, lbn, length: dataLen, isDir });
      }

      offset += recordLen;
    }

    return entries;
  }

  private parseParamSfo(sfo: Uint8Array): { title?: string; discId?: string } {
    if (sfo.length < 20) return {};
    // SFO Magic: \x00PSF
    if (sfo[0] !== 0 || sfo[1] !== 0x50 || sfo[2] !== 0x53 || sfo[3] !== 0x46) {
      return {};
    }

    const keyTableOffset = this.readUint32LE(sfo, 8);
    const dataTableOffset = this.readUint32LE(sfo, 12);
    const totalEntries = this.readUint32LE(sfo, 16);

    const result: { title?: string; discId?: string } = {};

    for (let i = 0; i < totalEntries; i++) {
      const entryOffset = 20 + i * 16;
      const keyOffset = sfo[entryOffset] | (sfo[entryOffset + 1] << 8);
      const dataOffset = this.readUint32LE(sfo, entryOffset + 12);

      // Read key string from key table
      let key = '';
      let k = keyTableOffset + keyOffset;
      while (k < sfo.length && sfo[k] !== 0) {
        key += String.fromCharCode(sfo[k++]);
      }

      // Read value
      let val = '';
      let d = dataTableOffset + dataOffset;
      while (d < sfo.length && sfo[d] !== 0) {
        val += String.fromCharCode(sfo[d++]);
      }

      if (key === 'TITLE') result.title = val;
      if (key === 'DISC_ID') result.discId = val;
    }

    return result;
  }
}
