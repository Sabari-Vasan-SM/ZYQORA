-- ==============================================================================
-- 1-CLICK SETUP FOR ZYQORA SUPABASE GAME STORAGE & STREAMING
-- Paste this entire script into Supabase SQL Editor and click RUN.
-- Platform: Supabase PostgreSQL & Storage
-- ==============================================================================

-- 1. Create the 'user-games' storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('user-games', 'user-games', true, 2147483648)
ON CONFLICT (id) DO UPDATE SET 
    public = true,
    file_size_limit = 2147483648;

-- 2. Storage RLS Policies: Allow public / anon uploads and streaming range requests
DROP POLICY IF EXISTS "Public Upload user-games" ON storage.objects;
CREATE POLICY "Public Upload user-games"
    ON storage.objects FOR INSERT
    TO public
    WITH CHECK (bucket_id = 'user-games');

DROP POLICY IF EXISTS "Public Select user-games" ON storage.objects;
CREATE POLICY "Public Select user-games"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'user-games');

DROP POLICY IF EXISTS "Public Update user-games" ON storage.objects;
CREATE POLICY "Public Update user-games"
    ON storage.objects FOR UPDATE
    TO public
    USING (bucket_id = 'user-games');

DROP POLICY IF EXISTS "Public Delete user-games" ON storage.objects;
CREATE POLICY "Public Delete user-games"
    ON storage.objects FOR DELETE
    TO public
    USING (bucket_id = 'user-games');

-- 3. Adjust public.games table so guest users can store game metadata without login
ALTER TABLE public.games ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "Allow public insert into games" ON public.games;
CREATE POLICY "Allow public insert into games"
    ON public.games FOR INSERT
    TO public
    WITH CHECK (true);

DROP POLICY IF EXISTS "Allow public select from games" ON public.games;
CREATE POLICY "Allow public select from games"
    ON public.games FOR SELECT
    TO public
    USING (true);

DROP POLICY IF EXISTS "Allow public update on games" ON public.games;
CREATE POLICY "Allow public update on games"
    ON public.games FOR UPDATE
    TO public
    USING (true);

DROP POLICY IF EXISTS "Allow public delete on games" ON public.games;
CREATE POLICY "Allow public delete on games"
    ON public.games FOR DELETE
    TO public
    USING (true);
