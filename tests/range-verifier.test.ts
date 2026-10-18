import http from 'http';
import { RangeVerifier } from '../src/streaming/range-verifier.ts';

async function runTests() {
  console.log('--- Starting Range Verifier Unit & Integration Tests ---');
  let passed = 0;
  let failed = 0;

  // 1. Setup Mock HTTP Server to simulate various Storage server behaviors
  const dummyData = Buffer.alloc(100000, 0x42); // 100 KB test payload
  for (let i = 0; i < dummyData.length; i++) {
    dummyData[i] = i % 256;
  }

  const server = http.createServer((req, res) => {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Range, Content-Length');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url?.includes('/compliant-storage')) {
      const range = req.headers.range;
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d+)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = Math.min(parseInt(match[2], 10), dummyData.length - 1);
          const chunk = dummyData.subarray(start, end + 1);

          res.writeHead(206, {
            'Content-Type': 'application/octet-stream',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${dummyData.length}`,
            'Content-Length': chunk.length,
          });
          res.end(chunk);
          return;
        }
      }
      res.writeHead(200, { 'Content-Length': dummyData.length });
      res.end(dummyData);
    } else if (req.url?.includes('/ignoring-range-storage')) {
      // Server that ignores range and sends 200 OK with full file
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': dummyData.length,
      });
      res.end(dummyData);
    } else if (req.url?.includes('/malformed-header-storage')) {
      res.writeHead(206, {
        'Content-Type': 'application/octet-stream',
        'Content-Range': 'invalid-content-range',
        'Content-Length': 1024,
      });
      res.end(dummyData.subarray(0, 1024));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(8999, resolve));
  const baseUrl = 'http://localhost:8999';

  try {
    // Test 1: Fully compliant Range endpoint
    console.log('[Test 1] Testing fully compliant byte-range endpoint...');
    const res1 = await RangeVerifier.verifyUrl(`${baseUrl}/compliant-storage`);
    if (res1.supported && res1.is206PartialContent && res1.arbitraryOffsetSuccess && res1.totalLength === 100000) {
      console.log('✓ PASS: Compliant endpoint correctly recognized');
      passed++;
    } else {
      console.error('✗ FAIL: Compliant endpoint failed:', res1.errors);
      failed++;
    }

    // Test 2: Server that ignores Range header and returns 200 OK
    console.log('[Test 2] Testing server that ignores Range and returns 200 OK...');
    const res2 = await RangeVerifier.verifyUrl(`${baseUrl}/ignoring-range-storage`);
    if (!res2.supported && res2.ignoredRangeAndReturnedFullFile) {
      console.log('✓ PASS: Correctly detected and rejected server ignoring Range header');
      passed++;
    } else {
      console.error('✗ FAIL: Server ignoring Range was not flagged:', res2);
      failed++;
    }

    // Test 3: Malformed Content-Range header
    console.log('[Test 3] Testing malformed Content-Range header...');
    const res3 = await RangeVerifier.verifyUrl(`${baseUrl}/malformed-header-storage`);
    if (!res3.supported && res3.errors.some(e => e.includes('Malformed Content-Range'))) {
      console.log('✓ PASS: Malformed Content-Range correctly detected and rejected');
      passed++;
    } else {
      console.error('✗ FAIL: Malformed header not rejected:', res3);
      failed++;
    }
  } finally {
    server.close();
  }

  console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
