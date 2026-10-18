/**
 * Supabase Client and Service Integration Layer
 * Direct browser-to-Supabase authentication, metadata persistence, and private storage streaming.
 * Strict constraint: No custom backend, no service-role key, browser anon key only.
 */

import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

export interface GameMetadata {
  id: string;
  user_id: string;
  title: string;
  filename: string;
  storage_path: string;
  format: 'ISO' | 'CSO' | 'PBP' | 'PRX' | 'ELF' | 'CHD';
  size_bytes: number;
  checksum?: string;
  status: 'uploading' | 'ready' | 'failed';
  created_at?: string;
  updated_at?: string;
}

export class SupabaseService {
  private static instance: SupabaseService | null = null;
  public client: SupabaseClient | null = null;
  private currentUser: User | null = null;
  private authListeners: Array<(user: User | null) => void> = [];

  private constructor() {
    this.initClient();
  }

  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  public initClient(): boolean {
    let rawUrl = (import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('zyqora_supabase_url') || '').trim();
    const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('zyqora_supabase_anon_key') || '').trim();

    if (!rawUrl || !rawKey) {
      this.client = null;
      return false;
    }

    // Automatically strip any trailing /rest/v1/ or trailing slash
    const cleanUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

    try {
      this.client = createClient(cleanUrl, rawKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });

      // Listen for auth state changes
      this.client.auth.onAuthStateChange((_event, session) => {
        this.currentUser = session?.user || null;
        this.notifyAuthListeners();
      });

      // Check current session
      this.client.auth.getUser().then(({ data }) => {
        this.currentUser = data.user || null;
        this.notifyAuthListeners();
      });

      return true;
    } catch (e) {
      console.error('[SupabaseService] Initialization error:', e);
      this.client = null;
      return false;
    }
  }

  public isConfigured(): boolean {
    return this.client !== null;
  }

  public setCustomCredentials(url: string, anonKey: string): boolean {
    localStorage.setItem('zyqora_supabase_url', url);
    localStorage.setItem('zyqora_supabase_anon_key', anonKey);
    return this.initClient();
  }

  public onAuthChange(listener: (user: User | null) => void): () => void {
    this.authListeners.push(listener);
    listener(this.currentUser);
    return () => {
      this.authListeners = this.authListeners.filter((l) => l !== listener);
    };
  }

  private notifyAuthListeners(): void {
    this.authListeners.forEach((l) => l(this.currentUser));
  }

  public getUser(): User | null {
    return this.currentUser;
  }

  // --- Authentication ---

  public async signInWithPassword(email: string, pass: string): Promise<User> {
    if (!this.client) throw new Error('Supabase is not configured.');
    const { data, error } = await this.client.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    if (!data.user) throw new Error('Sign in failed.');
    this.currentUser = data.user;
    return data.user;
  }

  public async signUp(email: string, pass: string): Promise<User> {
    if (!this.client) throw new Error('Supabase is not configured.');
    const { data, error } = await this.client.auth.signUp({ email, password: pass });
    if (error) throw error;
    if (!data.user) throw new Error('Sign up failed.');
    this.currentUser = data.user;
    return data.user;
  }

  public async signInAnonymously(): Promise<User> {
    if (!this.client) throw new Error('Supabase is not configured.');
    const { data, error } = await this.client.auth.signInAnonymously();
    if (error) throw error;
    if (!data.user) throw new Error('Anonymous session failed.');
    this.currentUser = data.user;
    return data.user;
  }

  public async signOut(): Promise<void> {
    if (!this.client) return;
    await this.client.auth.signOut();
    this.currentUser = null;
    this.notifyAuthListeners();
  }

  // --- Database Metadata CRUD ---

  private getGuestId(): string {
    let guestId = localStorage.getItem('zyqora_guest_device_id');
    if (!guestId) {
      guestId = crypto.randomUUID();
      localStorage.setItem('zyqora_guest_device_id', guestId);
    }
    return guestId;
  }

  public async listUserGames(): Promise<GameMetadata[]> {
    if (!this.client) return [];

    let query = this.client
      .from('games')
      .select('*')
      .order('created_at', { ascending: false });

    if (this.currentUser) {
      query = query.eq('user_id', this.currentUser.id);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as GameMetadata[];
  }

  public async createGameRecord(game: Omit<GameMetadata, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<GameMetadata> {
    if (!this.client) throw new Error('Supabase client not initialized.');

    const payload: any = {
      ...game,
      status: game.status || 'uploading',
    };

    if (this.currentUser) {
      payload.user_id = this.currentUser.id;
    }

    const { data, error } = await this.client
      .from('games')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data as GameMetadata;
  }

  public async updateGameStatus(id: string, status: 'uploading' | 'ready' | 'failed'): Promise<void> {
    if (!this.client) return;
    const { error } = await this.client
      .from('games')
      .update({ status })
      .eq('id', id);

    if (error) console.warn('[SupabaseService] Error updating status:', error);
  }

  // --- Storage & Streaming Signed URLs ---

  public async uploadGame(
    file: File,
    title: string,
    onProgress?: (percent: number, loaded: number, total: number, currentPart?: number, totalParts?: number) => void,
    abortSignal?: AbortSignal
  ): Promise<GameMetadata> {
    if (!this.client) throw new Error('Supabase client not initialized.');

    const ext = file.name.split('.').pop()?.toUpperCase() as any || 'ISO';
    const gameId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Owner or guest folder path
    const ownerId = this.currentUser ? this.currentUser.id : `guest_${this.getGuestId()}`;
    const storagePath = `${ownerId}/${gameId}`;

    const CHUNK_SIZE = 40 * 1024 * 1024; // 40 MiB per part (strictly < 50 MB Free Plan limit)
    const isChunked = file.size > 45 * 1024 * 1024;
    const totalParts = isChunked ? Math.ceil(file.size / CHUNK_SIZE) : 1;

    // 1. Create DB metadata record in 'uploading' state
    const record = await this.createGameRecord({
      title: title || file.name.replace(/\.[^/.]+$/, ''),
      filename: file.name,
      storage_path: storagePath,
      format: ext,
      size_bytes: file.size,
      checksum: isChunked ? `chunked:${CHUNK_SIZE}:${totalParts}` : undefined,
      status: 'uploading',
    });

    try {
      if (isChunked) {
        // Upload file in 40 MiB parts to bypass Supabase Free Plan 50 MB limit
        for (let i = 0; i < totalParts; i++) {
          if (abortSignal?.aborted) {
            throw new DOMException('Upload aborted by user', 'AbortError');
          }

          const start = i * CHUNK_SIZE;
          const end = Math.min((i + 1) * CHUNK_SIZE, file.size);
          const partBlob = file.slice(start, end);
          const partPath = `${storagePath}/part_${String(i).padStart(4, '0')}.bin`;

          const { error: partErr } = await this.client.storage
            .from('user-games')
            .upload(partPath, partBlob, {
              cacheControl: '3600',
              upsert: true,
            });

          if (partErr) throw partErr;

          const pct = Math.round(((i + 1) / totalParts) * 100);
          onProgress?.(pct, end, file.size, i + 1, totalParts);
        }
      } else {
        // Single file upload for files < 45 MB
        const singlePath = `${storagePath}/${safeName}`;
        onProgress?.(10, 0, file.size, 1, 1);
        const { error: uploadError } = await this.client.storage
          .from('user-games')
          .upload(singlePath, file, {
            cacheControl: '3600',
            upsert: true,
          });

        if (uploadError) throw uploadError;
        onProgress?.(100, file.size, file.size, 1, 1);
      }

      // Mark record as 'ready'
      await this.updateGameStatus(record.id, 'ready');
      record.status = 'ready';
      return record;

    } catch (err) {
      await this.updateGameStatus(record.id, 'failed');
      throw err;
    }
  }

  public async getSignedStreamUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.client) throw new Error('Supabase client not initialized.');

    // If storagePath is a directory or single file
    const target = storagePath.includes('.') ? storagePath : `${storagePath}/part_0000.bin`;

    const { data, error } = await this.client.storage
      .from('user-games')
      .createSignedUrl(target, expiresInSeconds);

    if (error || !data?.signedUrl) {
      const { data: pubData } = this.client.storage.from('user-games').getPublicUrl(target);
      if (pubData?.publicUrl) return pubData.publicUrl;
      throw error || new Error('Failed to create signed URL for streaming.');
    }

    return data.signedUrl;
  }

  public async getSignedStreamUrlForPart(storagePath: string, partIndex: number, expiresInSeconds = 3600): Promise<string> {
    if (!this.client) throw new Error('Supabase client not initialized.');

    const partPath = `${storagePath}/part_${String(partIndex).padStart(4, '0')}.bin`;
    const { data, error } = await this.client.storage
      .from('user-games')
      .createSignedUrl(partPath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      const { data: pubData } = this.client.storage.from('user-games').getPublicUrl(partPath);
      if (pubData?.publicUrl) return pubData.publicUrl;
      throw error || new Error(`Failed to create signed URL for part ${partIndex}`);
    }

    return data.signedUrl;
  }

  public async deleteGame(gameId: string, storagePath: string, checksum?: string): Promise<void> {
    if (!this.client) return;

    // 1. Delete storage object(s)
    try {
      if (checksum?.startsWith('chunked:')) {
        const partsCount = parseInt(checksum.split(':')[2], 10) || 50;
        const pathsToDelete = [];
        for (let i = 0; i < partsCount; i++) {
          pathsToDelete.push(`${storagePath}/part_${String(i).padStart(4, '0')}.bin`);
        }
        await this.client.storage.from('user-games').remove(pathsToDelete);
      } else {
        await this.client.storage.from('user-games').remove([storagePath]);
      }
    } catch (e) {
      console.warn('[SupabaseService] Error removing storage object:', e);
    }

    // 2. Delete database record
    const { error } = await this.client.from('games').delete().eq('id', gameId);
    if (error) throw error;
  }
}
