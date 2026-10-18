import http from 'http';
import { RemoteGameFile } from '../src/streaming/RemoteGameFile.ts';

async function runTests() {
  console.log('--- Starting RemoteGameFile Unit & Integration Tests ---');
  let passed = 0;
  let failed = 0;

  // 1. Create a 5 MiB test binary with deterministic byte values
  const totalSizeBytes = 5 * 1024 * 1024;
  const mockFile = Buffer.alloc(totalSizeBytes);
  for (let i = 0; i < mockFile.length; i++) {
    mockFile[i] = (i * 7 + 13) % 256;
  }

  let rangeRequestCount = 0;
  let returnAuthErrorOnce = false;

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (returnAuthErrorOnce && req.url?.includes('original-url')) {
      returnAuthErrorOnce = false;
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized - Token Expired');
      return;
    }

    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d+)/);
      if (match) {
        rangeRequestCount++;
        const start = parseInt(match[1], 10);
        const end = Math.min(parseInt(match[2], 10), totalSizeBytes - 1);
        const chunk = mockFile.subarray(start, end + 1);

        res.writeHead(206, {
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${totalSizeBytes}`,
          'Content-Length': chunk.length,
        });
        res.end(chunk);
        return;
      }
    }

    res.writeHead(400);
    res.end('Missing Range header');
  });

  await new Promise<void>((resolve) => server.listen(8998, resolve));
  const baseUrl = 'http://localhost:8998';

  try {
    const file = new RemoteGameFile(`${baseUrl}/game.iso`, {
      chunkSize: 1024 * 1024, // 1 MiB chunks
      maxCacheSize: 3 * 1024 * 1024, // 3 MiB cache
    });

    // Test 1: Open and size discovery
    console.log('[Test 1] Testing file open and size discovery...');
    const size = await file.open();
    if (size === totalSizeBytes && file.size() === totalSizeBytes) {
      console.log(`✓ PASS: File size correctly discovered (${size} bytes)`);
      passed++;
    } else {
      console.error(`✗ FAIL: Size mismatch. Expected ${totalSizeBytes}, got ${size}`);
      failed++;
    }

    // Test 2: Arbitrary offset read within a single chunk
    console.log('[Test 2] Testing read at arbitrary offset within single chunk (offset 500, length 256)...');
    const slice1 = await file.read(500, 256);
    let slice1Ok = slice1.length === 256;
    for (let i = 0; i < 256; i++) {
      if (slice1[i] !== mockFile[500 + i]) {
        slice1Ok = false;
        break;
      }
    }
    if (slice1Ok) {
      console.log('✓ PASS: Arbitrary single-chunk read bytes matched exactly');
      passed++;
    } else {
      console.error('✗ FAIL: Byte content did not match expected mock binary');
      failed++;
    }

    // Test 3: Read spanning across chunk boundary (offset 1048500, length 200 spanning chunks 0 and 1)
    console.log('[Test 3] Testing cross-chunk read spanning 1 MiB boundary...');
    const boundaryOffset = 1048500;
    const boundaryLength = 200;
    const slice2 = await file.read(boundaryOffset, boundaryLength);
    let slice2Ok = slice2.length === boundaryLength;
    for (let i = 0; i < boundaryLength; i++) {
      if (slice2[i] !== mockFile[boundaryOffset + i]) {
        slice2Ok = false;
        break;
      }
    }
    if (slice2Ok) {
      console.log('✓ PASS: Cross-chunk read seamlessly assembled across 1 MiB boundary');
      passed++;
    } else {
      console.error('✗ FAIL: Cross-chunk read failed to assemble correctly');
      failed++;
    }

    // Test 4: Cache hit verification (subsequent read in chunk 0 should not make network request)
    console.log('[Test 4] Testing chunk cache hits (reading offset 100 without network fetch)...');
    const reqsBefore = rangeRequestCount;
    await file.read(100, 50);
    const reqsAfter = rangeRequestCount;
    const metrics = file.getMetrics();
    if (reqsAfter === reqsBefore && metrics.cacheHits > 0) {
      console.log(`✓ PASS: Cache hit succeeded with 0 additional network requests (Hit rate: ${metrics.hitRatePercent}%)`);
      passed++;
    } else {
      console.error(`✗ FAIL: Cache miss occurred when data was expected in memory`);
      failed++;
    }

    // Test 5: Concurrent request deduplication
    console.log('[Test 5] Testing concurrent request deduplication for same chunk...');
    const reqsBeforeDedup = rangeRequestCount;
    const [p1, p2, p3] = await Promise.all([
      file.read(2 * 1024 * 1024 + 10, 100),
      file.read(2 * 1024 * 1024 + 50, 100),
      file.read(2 * 1024 * 1024 + 100, 100),
    ]);
    const reqsAfterDedup = rangeRequestCount;
    // Chunk 2 was requested by 3 promises simultaneously, but only 1 network request should be dispatched
    if (reqsAfterDedup - reqsBeforeDedup === 1 && p1.length === 100 && p2.length === 100 && p3.length === 100) {
      console.log('✓ PASS: Concurrent reads successfully deduplicated into single network range fetch');
      passed++;
    } else {
      console.error(`✗ FAIL: Expected 1 network request for chunk 2, got ${reqsAfterDedup - reqsBeforeDedup}`);
      failed++;
    }

    // Test 6: Auth token expiration refresh
    console.log('[Test 6] Testing signed URL refresh on HTTP 401 auth expiration...');
    returnAuthErrorOnce = true;
    let refreshCalled = false;
    const fileWithRefresh = new RemoteGameFile(`${baseUrl}/original-url`, {
      onUrlRefresh: async () => {
        refreshCalled = true;
        return `${baseUrl}/refreshed-url`;
      },
    });
    await fileWithRefresh.open();
    const readAfterRefresh = await fileWithRefresh.read(0, 50);
    if (refreshCalled && readAfterRefresh.length === 50) {
      console.log('✓ PASS: Expired token automatically triggered URL refresh and recovered playback');
      passed++;
    } else {
      console.error('✗ FAIL: Auth refresh did not trigger or recover read');
      failed++;
    }

    // Test 7: Multi-part chunked streaming (Supabase Free Plan 40 MB split emulation)
    console.log('[Test 7] Testing multi-part chunked streaming across part boundaries...');
    // Create a 2-part synthetic file: Part 0 (2 MB), Part 1 (3 MB) = 5 MB total
    const partSize = 2 * 1024 * 1024; // 2 MB parts for test
    const chunkedFile = new RemoteGameFile(`${baseUrl}/game.iso`, {
      isChunked: true,
      partSize: partSize,
      totalFileSize: totalSizeBytes,
      getPartUrl: async (partIdx) => `${baseUrl}/game.iso?part=${partIdx}`,
    });

    await chunkedFile.open();
    // Read spanning across the 2 MB part boundary: offset 2097100, length 100
    const spanOffset = partSize - 50;
    const spanLen = 100;
    const spanBytes = await chunkedFile.read(spanOffset, spanLen);
    let spanOk = spanBytes.length === spanLen;
    for (let i = 0; i < spanLen; i++) {
      if (spanBytes[i] !== mockFile[spanOffset + i]) {
        spanOk = false;
        break;
      }
    }
    if (spanOk) {
      console.log('✓ PASS: Seamlessly read across multi-part chunk boundary without data corruption');
      passed++;
    } else {
      console.error('✗ FAIL: Multi-part chunked boundary read mismatch');
      failed++;
    }

    file.close();
    fileWithRefresh.close();
    chunkedFile.close();

  } finally {
    server.close();
  }

  console.log(`\nRemoteGameFile Tests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
