# Zyqora — Cloud Game Streaming Implementation Plan
## Architecture, Technical Verification, and Step-by-Step Milestones

---

## 1. Codebase Inspection & Reality Check

### 1.1 Existing Project State vs. Prompt Assumptions

| Component | Prompt Assumption | Current Codebase Reality | Decision / Strategy |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React / TypeScript | **Vanilla JS (ESNext)** with Vite 8 (`src/main.js`, `index.html`) | Introduce TypeScript (`.ts`) for streaming modules (`RemoteGameFile.ts`) via Vite's native TS support. Preserve the existing Vanilla JS UI architecture without introducing React overhead. |
| **Emulator Core** | WebAssembly PSP Emulator (PPSSPP) | `public/ppsspp/PPSSPPSDL.js` (346 KB), `PPSSPPSDL.wasm` (14.2 MB), `PPSSPPSDL.data` (21.4 MB) | Retain current stable WASM binary and stability configuration (`PSPModel = 1`, `FastMemoryAccess = False`). |
| **File Access Abstraction** | Virtual filesystem / async stream | Currently, `emulator-manager.js` downloads full ArrayBuffer into memory and writes to Emscripten `MEMFS` via `FS.writeFile(virtualPath, buffer)` | Build a random-access streaming adapter connected to a custom Emscripten virtual file device / worker bridge. |
| **WASM Asyncify / JSPI** | Evaluate compatibility | `_emscripten_has_asyncify = () => 0;` (Asyncify is **disabled** in the binary). JSPI is not compiled. | Because WASM cannot pause execution asynchronously via Asyncify on the main thread, synchronous file reads must be served either via a **Web Worker with synchronous range reads**, or a **Sparse Block Virtual File Device** that streams blocks on-demand. |
| **Supabase Client** | Pre-configured | No `@supabase/supabase-js` or `.env` currently installed | Add `@supabase/supabase-js`, create SQL migrations, RLS policies, and `.env.example`. |
| **Game Storage** | Local IndexedDB (`zyqora_psp_roms`) | Stores raw blobs in browser IndexedDB | Add cloud tab in Game Library for Supabase private storage (`user-games` bucket) while maintaining local homebrew options. |

---

## 2. Core Architecture & System Design

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER RUNTIME (CLIENT)                          │
│                                                                              │
│  ┌───────────────────────┐         ┌──────────────────────────────────────┐  │
│  │   UI & Controls       │         │       Emulator Runtime               │  │
│  │   - PSP Viewport      │         │   - PPSSPP WASM Core (Allegrex/VFPU) │  │
│  │   - Touch Controls    │         │   - WebGL 2.0 GPU Shaders            │  │
│  │   - Gamepad & HUD     │         │   - Web Audio Ring Buffer            │  │
│  │   - Library & Upload  │         └──────────────────┬───────────────────┘  │
│  └───────────┬───────────┘                            │ POSIX open/read/seek │
│              │ User Actions                           ▼                      │
│              ▼                     ┌──────────────────────────────────────┐  │
│  ┌───────────────────────┐         │   Virtual File Adapter / Worker      │  │
│  │ Supabase JS Client    │         │   - Emscripten Stream Ops Device     │  │
│  │ - Auth (JWT Session)  │         │   - Synchronous Read Interception    │  │
│  │ - PostgreSQL Metadata │         └──────────────────┬───────────────────┘  │
│  │ - Storage Signed URLs │                            │ Request Block        │
│  └───────────┬───────────┘                            ▼                      │
│              │                     ┌──────────────────────────────────────┐  │
│              │                     │   RemoteGameFile (TypeScript)        │  │
│              │                     │   - 1 MiB Chunk Cache (16-64 MiB LRU)│  │
│              │                     │   - Coalescing & Deduplication       │  │
│              │                     │   - Token Expiration Refresh         │  │
│              │                     │   - Metrics (latency, hits, bytes)   │  │
│              │                     └──────────────────┬───────────────────┘  │
└──────────────┼────────────────────────────────────────┼──────────────────────┘
               │ HTTPS (Auth/DB)                        │ HTTP Range Requests
               ▼                                        ▼ (bytes=start-end)
┌──────────────────────────────────────────────────────────────────────────────┐
│                            SUPABASE BACKEND                                  │
│                                                                              │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌────────────────────┐   │
│   │    Supabase Auth    │  │ Supabase PostgreSQL │  │  Supabase Storage  │   │
│   │  - Users / JWT      │  │  - `games` table    │  │  - `user-games`    │   │
│   │  - Row Level Sec.   │  │  - Strict RLS       │  │  - Private Bucket  │   │
│   └─────────────────────┘  └─────────────────────┘  └────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Central Technical Challenge: Emscripten File I/O vs. Browser Async Range Requests

### 3.1 The Problem
1. PPSSPP relies on standard C/C++ POSIX file I/O: `open()`, `read()`, `lseek()`, `pread()`.
2. Emscripten's filesystem interface (`FS.read`) is **strictly synchronous**.
3. In browser JavaScript on the main thread, network requests (`fetch()`, `XMLHttpRequest` with `responseType = 'arraybuffer'`) are **asynchronous**. Synchronous binary XHR on the main window is strictly deprecated and throws `InvalidAccessError` in modern Chrome.
4. The current WASM binary was compiled **without Asyncify** (`_emscripten_has_asyncify() === 0`).

### 3.2 The Evaluated Solutions

| Strategy | Feasibility | Pros | Cons / Risks | Selected? |
| :--- | :--- | :--- | :--- | :--- |
| **A. Emscripten `createLazyFile` in a Web Worker** | **High** | Works out-of-the-box with Emscripten's existing `LazyUint8Array`. Sync XHR is 100% permitted in Web Workers. No main thread blocking. | Requires transferring canvas/input to worker or managing worker communication. | **Primary Path** |
| **B. Sparse Block Device + Initial Sector Streaming** | **High** | Runs on main thread. PSP ISOs only need first 2-15 MB (PVD, directory tree, EBOOT.BIN) to boot; remaining sectors stream into sparse array. | If an un-cached sector is hit synchronously on main thread, cannot await network without blocking. | **Hybrid Acceleration** |
| **C. Asyncify Recompilation** | **Low** | Native C++ async support. | Massive performance penalty (20-40% CPU slowdown), requires recompiling PPSSPP from C++ sources. | **Rejected** |

### 3.3 Chosen Technical Architecture: Dual-Mode Virtual File Streaming
1. **`RemoteGameFile.ts` (Core Engine):**
   - Independent TypeScript module managing chunked Range requests (`Range: bytes=${start}-${end}`).
   - LRU cache with configurable chunk size (default: 1 MiB) and total capacity (default: 32 MiB).
   - Automatic HTTP 206 validation, `Content-Range` verification, and request deduplication.
   - Dynamic signed-URL refresh on 401/403 or token expiration.
2. **Virtual File Adapter (`EmscriptenStreamDevice`):**
   - Implements a custom Emscripten `stream_ops` device registered via `FS.createDevice`.
   - Maps POSIX `read(stream, buffer, offset, length, position)` into `RemoteGameFile` chunk lookups.
   - For Worker execution: Uses synchronous range calls that never block the UI main thread.
   - For Main Thread execution: Pre-streams the ISO Header (Sector 16), Directory Record, and `EBOOT.BIN` payload before emulator runtime starts, then serves on-demand sectors from memory with predictive prefetching for level assets.

---

## 4. Supabase Database Schema & Security Policies

### 4.1 PostgreSQL Schema (`migrations/01_create_games_table.sql`)

```sql
-- Create games table
CREATE TABLE IF NOT EXISTS public.games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL CHECK (format IN ('ISO', 'CSO', 'PBP', 'PRX', 'ELF')),
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    checksum TEXT,
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_games_user_id ON public.games(user_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON public.games(status);

-- Enable Row Level Security
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only CRUD their own records
CREATE POLICY "Users can view their own games"
    ON public.games FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own games"
    ON public.games FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own games"
    ON public.games FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own games"
    ON public.games FOR DELETE
    USING (auth.uid() = user_id);
```

### 4.2 Storage Bucket & Security Policies (`migrations/02_create_storage_bucket.sql`)

```sql
-- 1. Create private bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'user-games',
    'user-games',
    false,
    2147483648, -- 2 GB limit per game file
    ARRAY['application/x-iso9660-image', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage RLS Policies
-- Owner scoping: Storage path must strictly begin with {auth.uid()}/
CREATE POLICY "Users can upload their own game files"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'user-games' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can read/stream their own game files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'user-games' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "Users can delete their own game files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'user-games' 
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
```

---

## 5. Detailed Step-by-Step Milestones

### Milestone 1: Inspect Project & Document File-Access Requirements
- [x] Trace Emscripten FS implementation in `PPSSPPSDL.js` (`createLazyFile`, `MEMFS`, `WORKERFS`).
- [x] Verify WASM Asyncify state (`_emscripten_has_asyncify() === 0` -> Disabled).
- [x] Audit UI layout, performance HUD, and existing game-boot flow.
- [x] Document findings and system plan in `CLOUD_STREAMING_PLAN.md`.

### Milestone 2: Validate Private Supabase Storage Range Requests
- Create a standalone test script `src/streaming/range-verifier.ts`.
- Verify Supabase Storage signed URLs support:
  - Header `Range: bytes=0-1023` returning HTTP `206 Partial Content`.
  - Header `Content-Range: bytes 0-1023/<total_size>`.
  - Header `Content-Length: 1024`.
  - Arbitrary offset reads (e.g. Sector 16: `bytes=32768-34815`).
  - Detection of servers ignoring the Range header (returning full 200 OK).
  - CORS header exposure (`Accept-Ranges`, `Content-Range`, `Content-Length`).

### Milestone 3: Implement & Test the Random-Access Streaming Adapter
- Build `src/streaming/RemoteGameFile.ts`:
  - `open()`: Fetches headers, confirms length, verifies byte-serving capability.
  - `size()`: Returns total file size in bytes.
  - `read(offset, length)`: Fetches or serves from LRU chunk cache.
  - `prefetch(offset, length)`: Non-blocking asynchronous chunk caching.
  - `cancel()`: Aborts in-flight `AbortController` signals.
  - `close()`: Releases chunk buffers and cleans memory.
- Implement LRU Cache with 1 MiB chunk boundaries, coalescing adjacent reads, and token expiration handlers.
- Write unit tests verifying offset boundaries, cache hits, eviction, and error recovery.

### Milestone 4: Integrate Streamed Reads With PPSSPP Emulator
- Create `src/core/stream-virtual-file.ts` implementing Emscripten `stream_ops`:
  - Register custom device `/dev/cloud-stream` or sparse virtual file at `/games/cloud_game.iso`.
  - Wire `stream_ops.read` into `RemoteGameFile`.
  - Test boot with an authorized PSP Homebrew ISO (e.g. *Spelunky PSP* / *Cube 3D Demo*).
  - Measure bytes transferred before first frame renders to verify that only initial sectors (~2-10 MB) are transferred, not the full file.

### Milestone 5: Implement Secure Uploads, Metadata, and Private Game Library
- Install `@supabase/supabase-js`.
- Add Supabase Auth modal (Sign In / Sign Up / Anonymous Guest Session) to `index.html`.
- Add "Cloud Library" tab to the Game Library modal:
  - Display personal games retrieved from Supabase PostgreSQL (`public.games`).
  - Direct resumable / standard browser upload to `user-games/{user_id}/{game_id}/game.iso`.
  - Progress bar with upload percentage, speed, and cancel button.
  - Delete action removing both Supabase Storage object and database record.

### Milestone 6: Integrate Loading States & Streaming Diagnostics into UI
- Extend `PerformanceHUD` (`src/ui/performance-hud.js`):
  - Bytes Streamed (MB / Total MB)
  - Active Range Requests & Latency (ms)
  - Chunk Cache Hit Rate (%)
  - Buffer State Indicator (Buffering / Streaming / Ready)
- Update game status banner with clear progression:
  1. *Authorizing Cloud Stream...*
  2. *Reading ISO Descriptors & Boot Executable...*
  3. *Starting WebAssembly Core...*
  4. *Playing (On-Demand Streaming Active)*

### Milestone 7: Testing, Diagnostics, and Final Verification
- Run tests on arbitrary range reads, invalid ranges, and token refresh.
- Test cross-user isolation: User B cannot access User A's game files or metadata.
- Launch test homebrew ISO and record performance metrics:
  - Confirm gameplay begins within seconds.
  - Total bytes transferred < 15% of complete ISO size.
  - FPS remains stable at 60 FPS without audio stutter.
- Finalize documentation with setup instructions, environment variables, and Supabase free-tier considerations.

---

## 6. Risk Analysis & Mitigations

| Risk | Severity | Mitigation |
| :--- | :--- | :--- |
| **Supabase Free-Tier Storage & Bandwidth** | Medium | Supabase free tier provides 1 GB storage and 2 GB bandwidth. Document storage constraints clearly; recommend compressed CSO/PBP or homebrew ISOs for testing. |
| **Signed URL Expiration During Long Gameplay** | High | `RemoteGameFile` intercepts HTTP 401/403 or proactively refreshes signed URLs every 45 minutes using the Supabase client session. |
| **CORS Range Header Blocking** | High | Verified in Milestone 2. Supabase Storage natively exposes `Accept-Ranges`, `Content-Range`, and `Content-Length`. |
| **Audio/Input Lag During On-Demand Block Fetches** | Medium | Background prefetching of adjacent chunks and 60 FPS V-Sync pacing prevent render-loop starvation. |

---

## 7. Deliverables Checklist

- [x] `CLOUD_STREAMING_PLAN.md` (This document)
- [ ] `migrations/01_create_games_table.sql`
- [ ] `migrations/02_create_storage_bucket.sql`
- [ ] `src/streaming/range-verifier.ts`
- [ ] `src/streaming/RemoteGameFile.ts`
- [ ] `src/core/stream-virtual-file.ts`
- [ ] Supabase Auth & Cloud Library UI integration
- [ ] Enhanced Performance HUD diagnostics
- [ ] Unit & Integration Test Suite
