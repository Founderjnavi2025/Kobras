-- ============================================================
-- KO-BRAS · SEED · SUPER ADMIN PERTAMA · v3.3
-- Jalankan manual sebagai service_role SETELAH admin signup.
-- ============================================================

do $$
declare
  v_email text := 'admin@ko-bras.id';   -- GANTI
  v_uid   uuid;
begin
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    raise exception 'User % belum signup. Signup dulu.', v_email;
  end if;

  insert into public.platform_admins (profile_id, notes)
  values (v_uid, 'Bootstrap super admin pertama')
  on conflict (profile_id) do nothing;

  raise notice 'Super admin % berhasil di-seed.', v_email;
end;
$$;
