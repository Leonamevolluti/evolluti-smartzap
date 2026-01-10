ALTER TABLE public.templates
ADD COLUMN IF NOT EXISTS header_media_preview_url text,
ADD COLUMN IF NOT EXISTS header_media_preview_expires_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS header_media_preview_updated_at timestamp with time zone;
