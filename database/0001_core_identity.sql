-- ============================================================
-- KO-BRAS · MIGRATION 0001 · CORE IDENTITY · v3.3
-- Prinsip: akun ≠ keanggotaan ≠ kewenangan platform.
-- Prasyarat: Postgres 15+ (Supabase default), extension pgcrypto.
-- ============================================================

-- ---------- 0. EXTENSIONS ----------
create extension if not exists pgcrypto;

-- ---------- 1. ENUMS ----------
create type org_type            as enum ('garment', 'konveksi', 'both');
create type org_status          as enum ('draft', 'pending', 'active', 'suspended', 'rejected');
create type member_role         as enum ('owner', 'admin', 'staff', 'viewer');
create type verification_status as enum ('pending', 'in_review', 'approved', 'rejected', 'expired');

-- ---------- 2. PROFILES ----------
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  full_name         text not null,
  phone             text unique,
  phone_verified_at timestamptz,
  avatar_url        text,
  locale            text default 'id-ID',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_full_name_len check (char_length(full_name) between 2 and 120)
);

-- ---------- 3. ORGANIZATIONS ----------
create table organizations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  type         org_type not null,
  status       org_status not null default 'draft',
  city         text,
  province     text,
  country      text not null default 'ID',
  created_by   uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint org_name_len    check (char_length(name) between 3 and 160),
  constraint org_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$')
);

create index idx_organizations_type_status on organizations(type, status);
create index idx_organizations_created_by  on organizations(created_by);

-- ---------- 4. ORGANIZATION MEMBERS ----------
create table organization_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  role        member_role not null default 'staff',
  joined_at   timestamptz not null default now(),
  unique (org_id, profile_id)
);

create index idx_org_members_profile on organization_members(profile_id);

-- ---------- 5. ORGANIZATION DOCUMENTS ----------
create table organization_documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  doc_type     text not null,
  file_path    text not null,
  file_hash    text,
  uploaded_by  uuid not null references profiles(id),
  created_at   timestamptz not null default now(),
  constraint doc_type_len    check (char_length(doc_type) between 2 and 32),
  constraint file_path_len   check (char_length(file_path) between 10 and 400),
  constraint file_path_owner check (file_path like org_id::text || '/%')
);

create index idx_org_docs_org on organization_documents(org_id);

-- ---------- 6. PROFILE VERIFICATIONS ----------
create table profile_verifications (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  status       verification_status not null default 'pending',
  reviewer_id  uuid references profiles(id),
  notes        text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index uq_profile_verif_active
  on profile_verifications (profile_id)
  where status in ('pending','in_review','approved');

create index idx_profile_verif_profile on profile_verifications(profile_id);

-- ---------- 7. ORGANIZATION VERIFICATIONS ----------
create table organization_verifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  status       verification_status not null default 'pending',
  reviewer_id  uuid references profiles(id),
  notes        text,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index uq_org_verif_active
  on organization_verifications (org_id)
  where status in ('pending','in_review','approved');

create index idx_org_verif_org on organization_verifications(org_id);

-- ---------- 8. PLATFORM ADMINS ----------
create table platform_admins (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references profiles(id),
  notes       text
);

-- ---------- 9. PROVISIONING FAILURES ----------
create table profile_provisioning_failures (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  email_domain text,
  error        text not null,
  created_at   timestamptz not null default now()
);

create index idx_prov_failures_user on profile_provisioning_failures(user_id);

-- ---------- 10. UTILITY FUNCTIONS ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger trg_profiles_updated         before update on public.profiles                    for each row execute function public.set_updated_at();
create trigger trg_orgs_updated             before update on public.organizations               for each row execute function public.set_updated_at();
create trigger trg_profile_verif_updated    before update on public.profile_verifications       for each row execute function public.set_updated_at();
create trigger trg_org_verif_updated        before update on public.organization_verifications  for each row execute function public.set_updated_at();

create or replace function public.safe_uuid(p text)
returns uuid language plpgsql immutable set search_path = pg_catalog, public
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.normalize_display_name(p_raw text, p_fallback_seed uuid default null)
returns text language plpgsql immutable set search_path = pg_catalog, public
as $$
declare
  v text;
begin
  v := pg_catalog.btrim(coalesce(p_raw, ''));

  if v = '' then
    v := 'Pengguna Baru';
  elsif char_length(v) < 2 then
    if p_fallback_seed is not null then
      v := 'Pengguna ' || pg_catalog.substr(p_fallback_seed::text, 1, 8);
    else
      v := 'Pengguna Baru';
    end if;
  elsif char_length(v) > 120 then
    v := pg_catalog.substr(v, 1, 120);
  end if;

  return v;
end;
$$;

-- ---------- 11. HELPERS ----------
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = p_org and profile_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.organization_members
    where org_id = p_org
      and profile_id = auth.uid()
      and role = any(p_roles)
  );
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.platform_admins where profile_id = auth.uid()
  );
$$;

-- ---------- 12. SIGNUP PROVISIONING ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name   text;
  v_domain text;
begin
  v_name := public.normalize_display_name(
    new.raw_user_meta_data->>'full_name',
    new.id
  );

  begin
    insert into public.profiles (id, full_name, phone, phone_verified_at)
    values (new.id, v_name, null, null)
    on conflict (id) do nothing;
  exception when others then
    begin
      v_domain := pg_catalog.split_part(new.email, '@', 2);
    exception when others then
      v_domain := null;
    end;

    begin
      insert into public.profile_provisioning_failures (user_id, email_domain, error)
      values (new.id, v_domain, sqlerrm);
    exception when others then
      null;
    end;

    raise warning 'handle_new_user: gagal provisioning % : %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text;
  v_row   public.profiles;
begin
  if v_uid is null then
    raise exception 'Tidak terautentikasi';
  end if;

  select * into v_row from public.profiles where id = v_uid;
  if found then
    return v_row;
  end if;

  select public.normalize_display_name(
           raw_user_meta_data->>'full_name',
           v_uid
         )
    into v_name
  from auth.users where id = v_uid;

  insert into public.profiles (id, full_name)
  values (v_uid, coalesce(v_name, 'Pengguna Baru'))
  on conflict (id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row from public.profiles where id = v_uid;
  end if;

  return v_row;
end;
$$;

revoke all on function public.ensure_profile() from public;
grant execute on function public.ensure_profile() to authenticated;

-- ---------- 13. BOOTSTRAP ORG → OWNER ----------
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from public.profiles where id = new.created_by) then
    raise exception 'created_by % bukan profile valid', new.created_by;
  end if;
  if new.created_by is distinct from auth.uid() then
    raise exception 'created_by harus sama dengan pengguna yang login';
  end if;

  insert into public.organization_members (org_id, profile_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- ---------- 14. GUARD: immutable cols ----------
create or replace function public.guard_member_immutable()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.org_id <> old.org_id or new.profile_id <> old.profile_id then
      raise exception 'org_id dan profile_id membership tidak boleh diubah';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_guard_member_immutable
  before update on public.organization_members
  for each row execute function public.guard_member_immutable();

-- ---------- 15. GUARD: minimal satu owner ----------
create or replace function public.guard_last_owner()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  remaining int;
begin
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then

    select count(*) into remaining
    from public.organization_members
    where org_id = old.org_id and role = 'owner' and id <> old.id;

    if remaining = 0 then
      raise exception 'Organisasi harus punya minimal satu owner';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_guard_last_owner
  before update or delete on public.organization_members
  for each row execute function public.guard_last_owner();

-- ---------- 16. RPC: set_member_role ----------
create or replace function public.set_member_role(p_org uuid, p_profile uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller      uuid := auth.uid();
  v_caller_role public.member_role;
  v_target_role public.member_role;
begin
  if v_caller is null then raise exception 'Tidak terautentikasi'; end if;
  if p_role = 'owner' then
    raise exception 'Role owner hanya via add_co_owner/transfer_ownership';
  end if;

  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'Organisasi tidak ditemukan'; end if;

  select role into v_caller_role
  from public.organization_members
  where org_id = p_org and profile_id = v_caller;

  if v_caller_role is null then
    raise exception 'Bukan anggota organisasi';
  end if;

  if v_caller_role = 'admin' then
    if p_role = 'admin' then
      raise exception 'Admin tidak boleh mengangkat admin baru';
    end if;
    if p_role not in ('staff','viewer') then
      raise exception 'Admin hanya boleh menetapkan staff atau viewer';
    end if;
  elsif v_caller_role <> 'owner' then
    raise exception 'Hanya owner atau admin yang boleh mengelola anggota';
  end if;

  select role into v_target_role
  from public.organization_members
  where org_id = p_org and profile_id = p_profile;

  if v_target_role is null then
    raise exception 'Target bukan anggota organisasi';
  end if;

  if v_target_role = 'owner' then
    raise exception 'Role owner tidak bisa diubah via set_member_role';
  end if;

  update public.organization_members
    set role = p_role
    where org_id = p_org and profile_id = p_profile;
end;
$$;

revoke all on function public.set_member_role(uuid, uuid, public.member_role) from public;
grant execute on function public.set_member_role(uuid, uuid, public.member_role) to authenticated;

-- ---------- 17. RPC OWNER ----------
create or replace function public.add_co_owner(p_org uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Tidak terautentikasi'; end if;

  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'Organisasi tidak ditemukan'; end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = p_org and profile_id = v_caller and role = 'owner'
  ) then
    raise exception 'Hanya owner yang boleh mengangkat co-owner';
  end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = p_org and profile_id = p_profile
  ) then
    raise exception 'Target harus anggota organisasi';
  end if;

  update public.organization_members
    set role = 'owner'
    where org_id = p_org and profile_id = p_profile;
end;
$$;

revoke all on function public.add_co_owner(uuid, uuid) from public;
grant execute on function public.add_co_owner(uuid, uuid) to authenticated;

create or replace function public.remove_owner(p_org uuid, p_profile uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller      uuid := auth.uid();
  v_target_role public.member_role;
  v_owners      int;
begin
  if v_caller is null then raise exception 'Tidak terautentikasi'; end if;

  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'Organisasi tidak ditemukan'; end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = p_org and profile_id = v_caller and role = 'owner'
  ) then
    raise exception 'Hanya owner yang boleh menurunkan owner';
  end if;

  select role into v_target_role
  from public.organization_members
  where org_id = p_org and profile_id = p_profile;

  if v_target_role is null then
    raise exception 'Target bukan anggota organisasi';
  end if;
  if v_target_role <> 'owner' then
    raise exception 'Target bukan owner (role saat ini: %)', v_target_role;
  end if;

  select count(*) into v_owners
  from public.organization_members
  where org_id = p_org and role = 'owner';

  if v_owners <= 1 then
    raise exception 'Organisasi harus punya minimal satu owner';
  end if;

  update public.organization_members
    set role = 'admin'
    where org_id = p_org and profile_id = p_profile and role = 'owner';
end;
$$;

revoke all on function public.remove_owner(uuid, uuid) from public;
grant execute on function public.remove_owner(uuid, uuid) to authenticated;

create or replace function public.transfer_ownership(p_org uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'Tidak terautentikasi'; end if;

  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'Organisasi tidak ditemukan'; end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = p_org and profile_id = v_caller and role = 'owner'
  ) then
    raise exception 'Hanya owner yang boleh mentransfer kepemilikan';
  end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = p_org and profile_id = p_new_owner
  ) then
    raise exception 'Penerima transfer harus anggota organisasi';
  end if;

  if p_new_owner = v_caller then
    raise exception 'Penerima transfer tidak boleh diri sendiri';
  end if;

  update public.organization_members
    set role = 'owner'
    where org_id = p_org and profile_id = p_new_owner and role <> 'owner';

  update public.organization_members
    set role = 'admin'
    where org_id = p_org and role = 'owner' and profile_id <> p_new_owner;
end;
$$;

revoke all on function public.transfer_ownership(uuid, uuid) from public;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;

-- ---------- 18. RPC: update profil sendiri ----------
create or replace function public.update_my_profile(p_full_name text default null, p_avatar_url text default null)
returns public.profiles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profiles;
begin
  if v_uid is null then raise exception 'Tidak terautentikasi'; end if;

  if p_full_name is not null then
    p_full_name := pg_catalog.btrim(p_full_name);
    if char_length(p_full_name) < 2 or char_length(p_full_name) > 120 then
      raise exception 'Nama harus 2-120 karakter';
    end if;
  end if;

  update public.profiles
    set full_name  = coalesce(p_full_name, full_name),
        avatar_url = coalesce(p_avatar_url, avatar_url)
    where id = v_uid
    returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.update_my_profile(text, text) from public;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- ---------- 19. RLS ENABLE ----------
alter table public.profiles                       enable row level security;
alter table public.organizations                  enable row level security;
alter table public.organization_members           enable row level security;
alter table public.organization_documents         enable row level security;
alter table public.profile_verifications          enable row level security;
alter table public.organization_verifications     enable row level security;
alter table public.platform_admins                enable row level security;
alter table public.profile_provisioning_failures  enable row level security;

-- ---------- 20. VIEW publik ----------
create or replace view public.profiles_public
with (security_invoker = true) as
select id, full_name, avatar_url, locale, created_at
from public.profiles;

-- ---------- 21. POLICIES ----------
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());

create policy profiles_shared_org_select on public.profiles
  for select using (
    exists (
      select 1 from public.organization_members m1
      join public.organization_members m2 on m1.org_id = m2.org_id
      where m1.profile_id = auth.uid() and m2.profile_id = profiles.id
    )
  );

create policy orgs_member_select on public.organizations
  for select using (public.is_org_member(id) or public.is_platform_admin());

create policy orgs_insert_authenticated on public.organizations
  for insert with check (auth.uid() is not null and created_by = auth.uid());

create policy orgs_admin_update on public.organizations
  for update using (public.has_org_role(id, array['owner','admin']::public.member_role[]));

create policy org_members_select on public.organization_members
  for select using (public.is_org_member(org_id) or public.is_platform_admin());

create policy org_docs_sensitive_select on public.organization_documents
  for select using (
    public.has_org_role(org_id, array['owner','admin']::public.member_role[])
    or public.is_platform_admin()
  );

create policy profile_verif_self_select on public.profile_verifications
  for select using (profile_id = auth.uid() or public.is_platform_admin());

create policy org_verif_select on public.organization_verifications
  for select using (public.is_org_member(org_id) or public.is_platform_admin());

create policy org_verif_admin_write on public.organization_verifications
  for all using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy platform_admins_select on public.platform_admins
  for select using (public.is_platform_admin());

create policy prov_failures_admin_select on public.profile_provisioning_failures
  for select using (public.is_platform_admin());

-- ---------- 22. PRIVILEGES ----------

-- PROFILES: column-level grant, phone tidak bisa dibaca via SELECT *
revoke all on public.profiles from authenticated, anon;
grant select (id, full_name, avatar_url, locale, created_at)
  on public.profiles to authenticated;

-- ORGANIZATIONS: eksplisit
revoke insert, update, delete on public.organizations from anon;
revoke update, delete on public.organizations from authenticated;
grant insert, select on public.organizations to authenticated;

-- MEMBERS: read-only, mutasi via RPC
revoke insert, update, delete on public.organization_members from authenticated, anon;
grant select on public.organization_members to authenticated;

-- DOCUMENTS: read-only, insert via Edge Function (Modul 02)
revoke insert, update, delete on public.organization_documents from authenticated, anon;
grant select on public.organization_documents to authenticated;

-- VERIFICATIONS: mutasi hanya via Edge Function/service_role untuk sementara
revoke insert, update, delete on public.profile_verifications    from authenticated, anon;
revoke insert, update, delete on public.organization_verifications from authenticated, anon;
grant select on public.profile_verifications    to authenticated;
grant select on public.organization_verifications to authenticated;

-- PLATFORM ADMINS: tidak ada akses tulis dari authenticated
revoke insert, update, delete on public.platform_admins from authenticated, anon;
grant select on public.platform_admins to authenticated;

-- PROVISIONING FAILURES: hanya platform admin via service_role
revoke all on public.profile_provisioning_failures from authenticated, anon;

-- profiles_public view
grant select on public.profiles_public to authenticated;

-- ---------- 23. FUNCTION GRANTS ----------
revoke all on function public.is_org_member(uuid)                       from public;
revoke all on function public.has_org_role(uuid, public.member_role[])  from public;
revoke all on function public.is_platform_admin()                       from public;
revoke all on function public.set_updated_at()                          from public;
revoke all on function public.safe_uuid(text)                           from public;
revoke all on function public.normalize_display_name(text, uuid)        from public;
revoke all on function public.handle_new_user()                         from public;
revoke all on function public.handle_new_organization()                 from public;
revoke all on function public.guard_member_immutable()                  from public;
revoke all on function public.guard_last_owner()                        from public;

grant execute on function public.is_org_member(uuid)                     to authenticated;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.is_platform_admin()                     to authenticated;
grant execute on function public.safe_uuid(text)                         to authenticated, anon;
grant execute on function public.normalize_display_name(text, uuid)      to authenticated;
