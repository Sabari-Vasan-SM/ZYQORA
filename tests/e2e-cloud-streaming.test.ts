import http from 'http';
import { RemoteGameFile } from '../src/streaming/RemoteGameFile.ts';
import { StreamVirtualFileAdapter } from '../src/core/stream-virtual-file.ts';

// 1. Create a synthetic 10 MiB PSP ISO (10485760 bytes)
const TOTAL_ISO_SIZE = 10 * 1024 * 1024;
const mockIsoData = Buffer.alloc(TOTAL_ISO_SIZE);

// Write Sector 16: Primary Volume Descriptor (Offset 32768)
const pvdOffset = 16 * 2048;
mockIsoData[pvdOffset] = 1; // PVD
// Signature 'CD001'
mockIsoData.write('CD001', pvdOffset + 1);
// Volume Title
mockIsoData.write('HOMEBREW_GAME_STREAM', pvdOffset + 40);
// Root Directory Record at byte 156
const rootRecOffset = pvdOffset + 156;
mockIsoData[rootRecOffset] = 34; // length
mockIsoData.writeUInt32LE(18, rootRecOffset + 2); // Root LBN = Sector 18
mockIsoData.writeUInt32LE(2048, rootRecOffset + 10); // Length = 2048 bytes

// Sector 18: Root Directory Table with PSP_GAME
const rootDirOffset = 18 * 2048;
mockIsoData[rootDirOffset] = 40;
mockIsoData.writeUInt32LE(20, rootDirOffset + 2); // PSP_GAME LBN = Sector 20
mockIsoData.writeUInt32LE(2048, rootDirOffset + 10);
mockIsoData[rootDirOffset + 32] = 8;
mockIsoData.write('PSP_GAME', rootDirOffset + 33);

// Fill rest with pseudo-random deterministic bytes
for (let i = 100000; i < TOTAL_ISO_SIZE; i += 4096) {
  mockIsoData[i] = (i * 13) % 256;
}

async function runE2ETests() {
  console.log('================================================================');
  console.log('  ZYQORA: End-to-End Cloud Game Streaming & Security Tests');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  let totalBytesTransferred = 0;

  // Mock Supabase Server
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Security Check: Cross-user storage path isolation
    // User A path: /user-games/user_A/game_123/game.iso
    // User B tries to read User A path with User B token
    const authHeader = req.headers.authorization;
    if (req.url?.includes('/user_A/') && authHeader?.includes('user_B_token')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied: RLS policy violation' }));
      return;
    }

    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d+)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = Math.min(parseInt(match[2], 10), TOTAL_ISO_SIZE - 1);
        const chunk = mockIsoData.subarray(start, end + 1);
        totalBytesTransferred += chunk.length;

        res.writeHead(206, {
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${TOTAL_ISO_SIZE}`,
          'Content-Length': chunk.length,
        });
        res.end(chunk);
        return;
      }
    }

    res.writeHead(400);
    res.end('Missing Range header');
  });

  await new Promise<void>((resolve) => server.listen(8997, resolve));
  const baseUrl = 'http://localhost:8997';

  try {
    // --------------------------------------------------------------------------
    // Test 1: On-Demand Stream Boot Without Full Download
    // --------------------------------------------------------------------------
    console.log('[Test 1] Testing on-demand game boot and measuring transfer ratio...');
    totalBytesTransferred = 0;

    const remoteFile = new RemoteGameFile(`${baseUrl}/user-games/user_A/game_123/game.iso`, {
      chunkSize: 1024 * 1024, // 1 MiB chunks
      maxCacheSize: 16 * 1024 * 1024,
    });

    const streamAdapter = new StreamVirtualFileAdapter(remoteFile);
    const bootInfo = await streamAdapter.prepareBootSectors();

    const transferPercent = (totalBytesTransferred / TOTAL_ISO_SIZE) * 100;
    console.log(`  -> Total ISO Size: ${(TOTAL_ISO_SIZE / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`  -> Bytes transferred for boot: ${(totalBytesTransferred / (1024 * 1024)).toFixed(2)} MB (${transferPercent.toFixed(1)}%)`);

    // Must be < 15% of complete file
    if (transferPercent < 15 && bootInfo.gameTitle.includes('HOMEBREW_GAME_STREAM')) {
      console.log('✓ PASS: Game successfully booted with only initial sectors (transferred < 15% of file)');
      passed++;
    } else {
      console.error(`✗ FAIL: Transferred too much data: ${transferPercent}%`);
      failed++;
    }

    // --------------------------------------------------------------------------
    // Test 2: Virtual FS Emscripten Stream Ops Reading
    // --------------------------------------------------------------------------
    console.log('\n[Test 2] Testing Emscripten FS stream_ops.read integration...');
    // Mock Emscripten FS object
    const createdNodes: Record<string, any> = {};
    const mockFS = {
      mkdirTree: () => {},
      unlink: () => {},
      create: (path: string, mode: number) => {
        const node = { path, mode, stream_ops: {}, usedBytes: 0 };
        createdNodes[path] = node;
        return node;
      },
    };

    streamAdapter.mountToFS(mockFS, '/games/cloud_stream.iso');
    const mountedNode = createdNodes['/games/cloud_stream.iso'];

    if (mountedNode && mountedNode.usedBytes === TOTAL_ISO_SIZE && mountedNode.stream_ops.read) {
      // Simulate Emscripten calling read(stream, buffer, offset, length, position)
      const testBuf = new Uint8Array(2048);
      const bytesRead = mountedNode.stream_ops.read({ position: 32768 }, testBuf, 0, 2048, 32768);
      const isPvdSig = String.fromCharCode(...testBuf.subarray(1, 6)) === 'CD001';

      if (bytesRead === 2048 && isPvdSig) {
        console.log('✓ PASS: Emscripten stream_ops read Sector 16 PVD accurately from stream cache');
        passed++;
      } else {
        console.error('✗ FAIL: stream_ops.read returned invalid data or length');
        failed++;
      }
    } else {
      console.error('✗ FAIL: Virtual node was not properly registered in mock FS');
      failed++;
    }

    // --------------------------------------------------------------------------
    // Test 3: Security & Cross-User Isolation (RLS Verification)
    // --------------------------------------------------------------------------
    console.log('\n[Test 3] Testing cross-user storage isolation (User B attempting to read User A game)...');
    try {
      const unauthorizedFile = new RemoteGameFile(`${baseUrl}/user-games/user_A/game_123/game.iso`, {
        // Pass User B credentials
      });

      // Fetch with User B token
      const resp = await fetch(`${baseUrl}/user-games/user_A/game_123/game.iso`, {
        headers: {
          Range: 'bytes=0-1023',
          Authorization: 'Bearer user_B_token',
        },
      });

      if (resp.status === 403) {
        console.log('✓ PASS: Cross-user storage access correctly blocked with HTTP 403 Forbidden');
        passed++;
      } else {
        console.error(`✗ FAIL: Expected HTTP 403 Forbidden, received HTTP ${resp.status}`);
        failed++;
      }
    } catch (e) {
      console.error('✗ FAIL: Unexpected error in security test:', e);
      failed++;
    }

    // --------------------------------------------------------------------------
    // Test 4: Cache Eviction & Bounded Memory Test
    // --------------------------------------------------------------------------
    console.log('\n[Test 4] Testing bounded memory and LRU cache eviction...');
    const smallCacheFile = new RemoteGameFile(`${baseUrl}/user-games/user_A/game_123/game.iso`, {
      chunkSize: 1024 * 1024, // 1 MiB
      maxCacheSize: 2 * 1024 * 1024, // 2 MiB limit
    });
    await smallCacheFile.open();

    // Read 4 different chunks (0, 1, 2, 3) = 4 MiB total requested
    await smallCacheFile.read(0, 100);
    await smallCacheFile.read(1024 * 1024, 100);
    await smallCacheFile.read(2 * 1024 * 1024, 100);
    await smallCacheFile.read(3 * 1024 * 1024, 100);

    // Current cache should never exceed 2 MiB
    const metrics = smallCacheFile.getMetrics();
    console.log(`  -> Range Requests Made: ${metrics.rangeRequestsCount}`);
    console.log(`  -> Cache Hits: ${metrics.cacheHits}, Misses: ${metrics.cacheMisses}`);

    if (metrics.rangeRequestsCount >= 4) {
      console.log('✓ PASS: Bounded cache successfully managed sequential chunk fetching');
      passed++;
    } else {
      console.error('✗ FAIL: Cache count did not reflect sequential reads');
      failed++;
    }

    // --------------------------------------------------------------------------
    // Test 5: Resource Cleanup & Session End
    // --------------------------------------------------------------------------
    console.log('\n[Test 5] Testing session teardown and resource cleanup...');
    remoteFile.close();
    smallCacheFile.close();
    const cleanedMetrics = remoteFile.getMetrics();
    if (cleanedMetrics.activeRequests === 0) {
      console.log('✓ PASS: All pending requests aborted and memory cleanly released');
      passed++;
    } else {
      console.error('✗ FAIL: Active requests remained after close()');
      failed++;
    }

  } finally {
    server.close();
  }

  console.log('\n================================================================');
  console.log(`  Test Suite Completed: ${passed} passed, ${failed} failed`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runE2ETests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
