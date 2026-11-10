-- ============================================================
-- KO-BRAS · MIGRATION 0002 · STORAGE BUCKETS · v3.3
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'org-documents', 'org-documents', false,
  10 * 1024 * 1024,
  array['application/pdf','image/jpeg','image/png']
)
on conflict (id) do nothing;

create policy org_docs_storage_read on storage.objects
  for select using (
    bucket_id = 'org-documents'
    and public.has_org_role(
      public.safe_uuid((storage.foldername(name))[1]),
      array['owner','admin']::public.member_role[]
    )
  );

-- TIDAK ada policy insert/update/delete untuk authenticated.
-- Upload hanya via Edge Function (Modul 02). Reviewer via signed URL (Modul 02).
