-- ============================================================
-- KO-BRAS · MIGRATION 0002 · STORAGE BUCKETS · v3.3
-- ============================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'org-documents',
  'org-documents',
  false,
  10 * 1024 * 1024,
  array['application/pdf','image/jpeg','image/png']
)
on conflict (id) do nothing;

-- Tidak ada akses Storage langsung untuk authenticated.
-- Tidak ada policy SELECT / INSERT / UPDATE / DELETE.
-- Akses dokumen melalui Edge Function dengan signed URL.
