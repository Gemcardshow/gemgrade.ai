-- Allow service role to update scan rows for image path persistence after insert.
GRANT SELECT, INSERT, UPDATE ON public.scans TO service_role;
