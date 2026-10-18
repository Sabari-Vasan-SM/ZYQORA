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

  /**
   * Initialize Supabase client from env or localStorage config
   */
  public initClient(): boolean {
    const url = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem('zyqora_supabase_url');
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem('zyqora_supabase_anon_key');

    if (!url || !anonKey) {
      this.client = null;
      return false;
    }

    try {
      this.client = createClient(url, anonKey, {
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

  public async listUserGames(): Promise<GameMetadata[]> {
    if (!this.client || !this.currentUser) return [];

    const { data, error } = await this.client
      .from('games')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []) as GameMetadata[];
  }

  public async createGameRecord(game: Omit<GameMetadata, 'id' | 'user_id' | 'created_at' | 'updated_at'>): Promise<GameMetadata> {
    if (!this.client || !this.currentUser) throw new Error('Must be signed in to add games.');

    const payload = {
      ...game,
      user_id: this.currentUser.id,
      status: game.status || 'uploading',
    };

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
    onProgress?: (percent: number, loaded: number, total: number) => void
  ): Promise<GameMetadata> {
    if (!this.client || !this.currentUser) throw new Error('Must be signed in to upload games.');

    const ext = file.name.split('.').pop()?.toUpperCase() as any || 'ISO';
    const gameId = crypto.randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Owner-scoped opaque path: {user_id}/{game_id}/{safeName}
    const storagePath = `${this.currentUser.id}/${gameId}/${safeName}`;

    // 1. Create DB metadata record in 'uploading' state
    const record = await this.createGameRecord({
      title: title || file.name.replace(/\.[^/.]+$/, ''),
      filename: file.name,
      storage_path: storagePath,
      format: ext,
      size_bytes: file.size,
      status: 'uploading',
    });

    try {
      onProgress?.(5, 0, file.size);

      // 2. Direct upload to private 'user-games' bucket
      // Note: for large files, supabase-js handles binary streaming directly
      const { error: uploadError } = await this.client.storage
        .from('user-games')
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      onProgress?.(100, file.size, file.size);

      // 3. Mark record as 'ready'
      await this.updateGameStatus(record.id, 'ready');
      record.status = 'ready';
      return record;

    } catch (err) {
      // Mark as failed in DB
      await this.updateGameStatus(record.id, 'failed');
      throw err;
    }
  }

  public async getSignedStreamUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    if (!this.client) throw new Error('Supabase client not initialized.');

    const { data, error } = await this.client.storage
      .from('user-games')
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw error || new Error('Failed to create signed URL for streaming.');
    }

    return data.signedUrl;
  }

  public async deleteGame(gameId: string, storagePath: string): Promise<void> {
    if (!this.client) return;

    // 1. Delete storage object
    try {
      await this.client.storage.from('user-games').remove([storagePath]);
    } catch (e) {
      console.warn('[SupabaseService] Error removing storage object:', e);
    }

    // 2. Delete database record
    const { error } = await this.client.from('games').delete().eq('id', gameId);
    if (error) throw error;
  }
}
