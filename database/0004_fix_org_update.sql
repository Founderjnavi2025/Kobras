-- KO-BRAS · 0004 · izinkan owner update kolom profil usaha
revoke update on public.organizations from authenticated;
grant update (name, city, province, country) on public.organizations to authenticated;
