-- =============================================================================
-- Scan image storage paths (Supabase Storage bucket: scan-images)
-- Keeps scans rows lightweight; legacy front_image/back_image still readable.
-- =============================================================================

ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS front_image_path text NULL,
  ADD COLUMN IF NOT EXISTS back_image_path text NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'scan-images',
  'scan-images',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Service role manages objects; clients fetch via authenticated API routes.
DROP POLICY IF EXISTS "scan_images_service_all" ON storage.objects;
CREATE POLICY "scan_images_service_all"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'scan-images')
  WITH CHECK (bucket_id = 'scan-images');
