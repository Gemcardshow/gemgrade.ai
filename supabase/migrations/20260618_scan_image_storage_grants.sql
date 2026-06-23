-- Optional follow-up if scan-images uploads fail with permission errors.
-- Safe to run after 20260617_scan_image_storage.sql

GRANT ALL ON storage.objects TO service_role;
GRANT ALL ON storage.buckets TO service_role;

DROP POLICY IF EXISTS "scan_images_service_all" ON storage.objects;
CREATE POLICY "scan_images_service_all"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'scan-images')
  WITH CHECK (bucket_id = 'scan-images');
