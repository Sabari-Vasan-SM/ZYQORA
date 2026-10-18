-- ==============================================================================
-- Migration 01: Create Games Table with Strict Row Level Security (RLS)
-- Platform: Supabase PostgreSQL
-- ==============================================================================

-- 1. Create table for game metadata
CREATE TABLE IF NOT EXISTS public.games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL UNIQUE,
    format TEXT NOT NULL CHECK (format IN ('ISO', 'CSO', 'PBP', 'PRX', 'ELF', 'CHD')),
    size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
    checksum TEXT,
    status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes for user isolation and query performance
CREATE INDEX IF NOT EXISTS idx_games_user_id ON public.games(user_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON public.games(status);
CREATE INDEX IF NOT EXISTS idx_games_created_at ON public.games(created_at DESC);

-- 3. Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_games_updated_at ON public.games;
CREATE TRIGGER set_games_updated_at
    BEFORE UPDATE ON public.games
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- 5. Strict User Isolation Policies
-- Authenticated users can ONLY view their own records
CREATE POLICY "Users can view only their own games"
    ON public.games
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Authenticated users can insert records ONLY with their own user_id
CREATE POLICY "Users can insert only their own games"
    ON public.games
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Authenticated users can update ONLY their own games and cannot transfer ownership
CREATE POLICY "Users can update only their own games"
    ON public.games
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Authenticated users can delete ONLY their own games
CREATE POLICY "Users can delete only their own games"
    ON public.games
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);
