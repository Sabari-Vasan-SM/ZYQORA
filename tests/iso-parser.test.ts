import { RemoteGameFile } from '../src/streaming/RemoteGameFile.ts';
import { ISOParser } from '../src/streaming/iso-parser.ts';

// Helper to construct a synthetic ISO 9660 image
function createSyntheticPspIso(): Uint8Array {
  // 100 Sectors * 2048 bytes = 204,800 bytes
  const iso = new Uint8Array(204800);

  // Sector 16: Primary Volume Descriptor (Offset 32768)
  const pvdOffset = 16 * 2048;
  iso[pvdOffset] = 1; // Type 1: PVD
  // 'CD001'
  iso[pvdOffset + 1] = 0x43;
  iso[pvdOffset + 2] = 0x44;
  iso[pvdOffset + 3] = 0x30;
  iso[pvdOffset + 4] = 0x30;
  iso[pvdOffset + 5] = 0x31;
  iso[pvdOffset + 6] = 1; // Version 1

  // Volume ID: "SPELUNKY_PSP" at byte 40
  const title = "SPELUNKY_PSP";
  for (let i = 0; i < title.length; i++) {
    iso[pvdOffset + 40 + i] = title.charCodeAt(i);
  }

  // Root Directory Record at byte 156 (length 34)
  const rootRecordOffset = pvdOffset + 156;
  iso[rootRecordOffset] = 34; // record length
  // Root LBN: Sector 18 (little endian at +2)
  iso[rootRecordOffset + 2] = 18;
  iso[rootRecordOffset + 3] = 0;
  iso[rootRecordOffset + 4] = 0;
  iso[rootRecordOffset + 5] = 0;
  // Length: 2048 bytes (little endian at +10)
  iso[rootRecordOffset + 10] = 0;
  iso[rootRecordOffset + 11] = 8; // 2048 in LE (0x0800)

  // Sector 18: Root Directory Table containing 'PSP_GAME' entry
  const rootDirOffset = 18 * 2048;
  // Entry 1: 'PSP_GAME'
  const entryName = "PSP_GAME";
  const recLen = 33 + entryName.length;
  iso[rootDirOffset] = recLen;
  // PSP_GAME LBN: Sector 20
  iso[rootDirOffset + 2] = 20;
  iso[rootDirOffset + 10] = 0;
  iso[rootDirOffset + 11] = 8; // 2048 bytes
  iso[rootDirOffset + 32] = entryName.length;
  for (let i = 0; i < entryName.length; i++) {
    iso[rootDirOffset + 33 + i] = entryName.charCodeAt(i);
  }

  return iso;
}

async function runTests() {
  console.log('--- Starting ISO 9660 Parser Unit Tests ---');
  let passed = 0;
  let failed = 0;

  const mockIso = createSyntheticPspIso();

  // Mock RemoteGameFile using in-memory mockIso
  const mockRemoteFile: any = {
    open: async () => mockIso.length,
    read: async (offset: number, length: number) => {
      return mockIso.subarray(offset, Math.min(offset + length, mockIso.length));
    },
    size: () => mockIso.length,
  };

  try {
    const parser = new ISOParser(mockRemoteFile);
    const metadata = await parser.parseBootMetadata();

    console.log('[Test 1] Testing PVD CD001 identifier & Title extraction...');
    if (metadata.title.includes('SPELUNKY_PSP') && metadata.rootDirectorySector === 18) {
      console.log(`✓ PASS: Identified ISO title "${metadata.title}" and Root Sector ${metadata.rootDirectorySector}`);
      passed++;
    } else {
      console.error('✗ FAIL: PVD metadata parsing mismatch:', metadata);
      failed++;
    }

    console.log('[Test 2] Testing boot byte ranges output...');
    if (metadata.bootByteRanges.length >= 1 && metadata.bootByteRanges[0].start === 0) {
      console.log(`✓ PASS: Extracted ${metadata.bootByteRanges.length} essential boot ranges (Initial: 0-65535)`);
      passed++;
    } else {
      console.error('✗ FAIL: Boot ranges missing or malformed:', metadata.bootByteRanges);
      failed++;
    }

  } catch (e) {
    console.error('✗ FAIL: Exception in ISO parser test:', e);
    failed++;
  }

  console.log(`\nISOParser Tests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests();
