-- ==============================================================================
-- Migration 02: Create Private 'user-games' Storage Bucket and Policies
-- Platform: Supabase Storage
-- ==============================================================================

-- 1. Create the private 'user-games' storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'user-games',
    'user-games',
    false, -- Strictly private: requires signed URL or authenticated token
    2147483648, -- 2 GB max file size limit
    ARRAY['application/x-iso9660-image', 'application/octet-stream', 'application/zip']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 2147483648;

-- 2. Storage Object RLS Policies
-- Storage paths are strictly owner-scoped: {auth.uid()}/{game_id}/game.iso

-- Upload policy: Users can only upload objects into their own user_id directory
CREATE POLICY "Users can upload objects to their own folder"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'user-games'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Read policy: Users can only read/stream objects from their own folder
CREATE POLICY "Users can read objects from their own folder"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'user-games'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Update policy: Users can only update objects in their own folder
CREATE POLICY "Users can update objects in their own folder"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'user-games'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Delete policy: Users can only delete objects in their own folder
CREATE POLICY "Users can delete objects from their own folder"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'user-games'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
