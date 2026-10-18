/**
 * Supabase Storage HTTP Byte-Range Capability Verifier
 * Validates that private storage signed URLs or endpoints conform strictly to HTTP 206 range semantics
 */

export interface RangeVerificationResult {
  supported: boolean;
  totalLength: number | null;
  acceptRangesHeader: string | null;
  contentRangeHeader: string | null;
  contentLength: number | null;
  partialStatus: number;
  is206PartialContent: boolean;
  ignoredRangeAndReturnedFullFile: boolean;
  exposedHeaders: string[];
  arbitraryOffsetSuccess: boolean;
  errors: string[];
  diagnostics: Record<string, any>;
}

export class RangeVerifier {
  /**
   * Verify an endpoint or signed URL for compliance with byte-range streaming requirements
   */
  static async verifyUrl(url: string, testLength = 1024): Promise<RangeVerificationResult> {
    const result: RangeVerificationResult = {
      supported: false,
      totalLength: null,
      acceptRangesHeader: null,
      contentRangeHeader: null,
      contentLength: null,
      partialStatus: 0,
      is206PartialContent: false,
      ignoredRangeAndReturnedFullFile: false,
      exposedHeaders: [],
      arbitraryOffsetSuccess: false,
      errors: [],
      diagnostics: {},
    };

    try {
      // 1. Initial 0-testLength Range probe
      const endByte = testLength - 1;
      const initialResp = await fetch(url, {
        method: 'GET',
        headers: {
          Range: `bytes=0-${endByte}`,
        },
      });

      result.partialStatus = initialResp.status;
      result.is206PartialContent = initialResp.status === 206;

      // Extract headers
      const exposedHeaders: string[] = [];
      initialResp.headers.forEach((val, key) => exposedHeaders.push(key));
      result.exposedHeaders = exposedHeaders;

      result.acceptRangesHeader = initialResp.headers.get('Accept-Ranges');
      result.contentRangeHeader = initialResp.headers.get('Content-Range');
      const contentLengthHdr = initialResp.headers.get('Content-Length');
      result.contentLength = contentLengthHdr ? parseInt(contentLengthHdr, 10) : null;

      // Check if server ignored the Range header and returned 200 OK with full file
      if (initialResp.status === 200) {
        result.ignoredRangeAndReturnedFullFile = true;
        result.errors.push('CRITICAL: Server ignored Range header and returned HTTP 200 OK with full body.');
        return result;
      }

      if (initialResp.status !== 206) {
        result.errors.push(`Expected HTTP 206 Partial Content, received HTTP ${initialResp.status}`);
        return result;
      }

      // Validate Content-Range header: bytes 0-1023/12345678
      if (!result.contentRangeHeader) {
        result.errors.push('Missing Content-Range response header. Ensure CORS exposes Content-Range.');
      } else {
        const match = result.contentRangeHeader.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = parseInt(match[2], 10);
          const total = match[3] !== '*' ? parseInt(match[3], 10) : null;
          result.totalLength = total;

          if (start !== 0 || end !== endByte) {
            result.errors.push(`Content-Range mismatch: expected 0-${endByte}, received ${start}-${end}`);
          }
        } else {
          result.errors.push(`Malformed Content-Range header: "${result.contentRangeHeader}"`);
        }
      }

      // Validate Content-Length equals requested range slice
      const bodyBytes = new Uint8Array(await initialResp.arrayBuffer());
      if (bodyBytes.length !== testLength) {
        result.errors.push(`Body byte count mismatch: requested ${testLength} bytes, received ${bodyBytes.length}`);
      }

      // 2. Arbitrary Non-Zero Offset Probe (e.g. ISO 9660 Sector 16: offset 32768)
      if (result.totalLength && result.totalLength > 40000) {
        const arbStart = 32768;
        const arbEnd = arbStart + 2047; // 2048 bytes (1 sector)
        const arbResp = await fetch(url, {
          headers: { Range: `bytes=${arbStart}-${arbEnd}` },
        });

        if (arbResp.status === 206) {
          const arbBytes = new Uint8Array(await arbResp.arrayBuffer());
          const arbContentRange = arbResp.headers.get('Content-Range');
          if (arbBytes.length === 2048 && arbContentRange && arbContentRange.includes(`${arbStart}-${arbEnd}`)) {
            result.arbitraryOffsetSuccess = true;
          } else {
            result.errors.push('Arbitrary offset read returned incorrect slice length or Content-Range.');
          }
        } else {
          result.errors.push(`Arbitrary offset request failed with HTTP ${arbResp.status}`);
        }
      } else {
        result.arbitraryOffsetSuccess = true; // file too small for sector 16 test, basic test succeeded
      }

      // Final determination
      result.supported = result.is206PartialContent &&
                         !result.ignoredRangeAndReturnedFullFile &&
                         result.errors.length === 0;

      result.diagnostics = {
        bytesReceivedFirstProbe: bodyBytes.length,
        totalFileLength: result.totalLength,
        urlVerified: url.split('?')[0] + '?[TOKEN_REDACTED]',
      };

    } catch (err: any) {
      result.errors.push(`Network or CORS exception during range verification: ${err.message}`);
    }

    return result;
  }
}
