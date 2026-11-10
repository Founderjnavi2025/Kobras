-- ============================================================
-- KO-BRAS · MIGRATION 0003 · BUSINESS VERIFICATION · v1.0
-- ============================================================

-- 1. SUBMISSION COLUMNS
alter table public.organization_verifications
  add column submitted_by uuid references public.profiles(id),
  add column submitted_at timestamptz,
  add column expires_at timestamptz;

alter table public.organization_verifications
  add constraint org_verif_submission_consistency
  check (
    (submitted_by is null and submitted_at is null)
    or (submitted_by is not null and submitted_at is not null)
  );

alter table public.organization_verifications
  add constraint org_verif_expires_after_submit
  check (
    expires_at is null
    or (submitted_at is not null and expires_at > submitted_at)
  );

-- 2. SUBMITTER INVARIANT
create or replace function public.guard_org_verif_submitter()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.submitted_by is not null then
    if tg_op = 'INSERT'
       or new.submitted_by is distinct from old.submitted_by
       or new.org_id is distinct from old.org_id then

      if not exists (
        select 1
        from public.organization_members
        where org_id = new.org_id
          and profile_id = new.submitted_by
      ) then
        raise exception 'submitted_by harus anggota organisasi';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_guard_org_verif_submitter
before insert or update on public.organization_verifications
for each row
execute function public.guard_org_verif_submitter();

revoke all on function public.guard_org_verif_submitter()
from public, anon, authenticated;

-- 3. VERIFICATION EVENTS
create table public.organization_verification_events (
  id uuid primary key default gen_random_uuid(),

  verification_id uuid not null
    references public.organization_verifications(id)
    on delete cascade,

  actor_profile_id uuid references public.profiles(id),

  event_type text not null
    check (event_type in (
      'submitted',
      'review_started',
      'approved',
      'rejected',
      'expired',
      'resubmitted'
    )),

  from_status public.verification_status,
  to_status public.verification_status,

  note text,

  created_at timestamptz not null default now(),

  constraint verification_event_note_length
    check (note is null or char_length(note) <= 1000),

  constraint verification_event_actor_required
    check (event_type = 'expired' or actor_profile_id is not null),

  constraint verification_event_to_status_match
    check (
         (event_type = 'submitted' and to_status = 'pending')
      or (event_type = 'resubmitted' and to_status = 'pending')
      or (event_type = 'review_started' and to_status = 'in_review')
      or (event_type = 'approved' and to_status = 'approved')
      or (event_type = 'rejected' and to_status = 'rejected')
      or (event_type = 'expired' and to_status = 'expired')
    )
);

create index idx_verification_events_recent
on public.organization_verification_events
(verification_id, created_at desc);

-- 4. EVENT RLS
alter table public.organization_verification_events
enable row level security;

create policy verification_events_read
on public.organization_verification_events
for select
using (
  exists (
    select 1
    from public.organization_verifications v
    where v.id = verification_id
      and (
        public.has_org_role(
          v.org_id,
          array['owner','admin']::public.member_role[]
        )
        or public.is_platform_admin()
      )
  )
);

revoke all on public.organization_verification_events
from public, anon, authenticated;

grant select on public.organization_verification_events
to authenticated;

-- 5. ATOMIC VERIFICATION DECISION RPC
create or replace function public.record_verification_decision(
  p_verification_id uuid,
  p_actor_profile_id uuid,
  p_event_type text,
  p_to_status public.verification_status,
  p_note text default null
)
returns public.organization_verification_events
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_verif public.organization_verifications;
  v_from public.verification_status;
  v_event public.organization_verification_events;
begin
  if p_event_type not in (
    'submitted',
    'review_started',
    'approved',
    'rejected',
    'expired',
    'resubmitted'
  ) then
    raise exception 'event_type tidak dikenal';
  end if;

  if p_note is not null and char_length(p_note) > 1000 then
    raise exception 'Catatan maksimal 1000 karakter';
  end if;

  select *
  into v_verif
  from public.organization_verifications
  where id = p_verification_id
  for update;

  if not found then
    raise exception 'Verifikasi tidak ditemukan';
  end if;

  v_from := v_verif.status;

  -- Validate target status
  if
       (p_event_type = 'submitted' and p_to_status <> 'pending')
    or (p_event_type = 'resubmitted' and p_to_status <> 'pending')
    or (p_event_type = 'review_started' and p_to_status <> 'in_review')
    or (p_event_type = 'approved' and p_to_status <> 'approved')
    or (p_event_type = 'rejected' and p_to_status <> 'rejected')
    or (p_event_type = 'expired' and p_to_status <> 'expired')
  then
    raise exception 'Target status tidak cocok dengan event';
  end if;

  -- Validate actor
  if p_event_type <> 'expired' and p_actor_profile_id is null then
    raise exception 'Aktor wajib diisi';
  end if;

  if p_actor_profile_id is not null then
    if not exists (
      select 1 from public.profiles
      where id = p_actor_profile_id
    ) then
      raise exception 'Profil aktor tidak ditemukan';
    end if;
  end if;

  -- Submitter must belong to organization
  if p_event_type in ('submitted','resubmitted') then
    if not exists (
      select 1
      from public.organization_members
      where org_id = v_verif.org_id
        and profile_id = p_actor_profile_id
    ) then
      raise exception 'Aktor harus anggota organisasi';
    end if;
  end if;

  -- Reviewer must be platform admin
  if p_event_type in (
    'review_started','approved','rejected'
  ) then
    if not exists (
      select 1
      from public.platform_admins
      where profile_id = p_actor_profile_id
    ) then
      raise exception 'Aktor harus platform admin';
    end if;
  end if;

  if p_event_type = 'expired' and p_actor_profile_id is not null then
    if not exists (
      select 1
      from public.platform_admins
      where profile_id = p_actor_profile_id
    ) then
      raise exception 'Aktor expiry manual harus platform admin';
    end if;
  end if;

  -- Validate state transitions
  case p_event_type
    when 'submitted' then
      if v_from <> 'pending'
         or v_verif.submitted_by is not null then
        raise exception 'Pengajuan awal tidak valid';
      end if;

    when 'review_started' then
      if v_from <> 'pending'
         or v_verif.submitted_by is null then
        raise exception 'Verifikasi tidak siap diperiksa';
      end if;

    when 'approved','rejected' then
      if v_from <> 'in_review' then
        raise exception 'Verifikasi belum dalam pemeriksaan';
      end if;

    when 'expired' then
      if v_from <> 'approved' then
        raise exception 'Hanya verifikasi approved yang dapat expired';
      end if;

    when 'resubmitted' then
      if v_from not in ('rejected','expired') then
        raise exception 'Pengajuan ulang tidak valid';
      end if;
  end case;

  -- Atomic status update
  update public.organization_verifications
  set
    status = p_to_status,

    submitted_by = case
      when p_event_type in ('submitted','resubmitted')
      then p_actor_profile_id
      else submitted_by
    end,

    submitted_at = case
      when p_event_type in ('submitted','resubmitted')
      then now()
      else submitted_at
    end,

    expires_at = case
      when p_event_type in ('submitted','resubmitted')
      then null
      else expires_at
    end,

    reviewer_id = case
      when p_event_type in ('submitted','resubmitted')
      then null
      when p_event_type in ('review_started','approved','rejected')
      then p_actor_profile_id
      else reviewer_id
    end,

    decided_at = case
      when p_event_type in ('approved','rejected','expired')
      then now()
      when p_event_type in ('submitted','resubmitted','review_started')
      then null
      else decided_at
    end,

    notes = case
      when p_event_type = 'resubmitted' then null
      when p_note is not null then p_note
      else notes
    end

  where id = p_verification_id;

  -- Insert event in same transaction
  insert into public.organization_verification_events (
    verification_id,
    actor_profile_id,
    event_type,
    from_status,
    to_status,
    note
  )
  values (
    p_verification_id,
    p_actor_profile_id,
    p_event_type,
    v_from,
    p_to_status,
    p_note
  )
  returning * into v_event;

  return v_event;
end;
$$;

revoke all on function public.record_verification_decision(
  uuid, uuid, text, public.verification_status, text
) from public, anon, authenticated;

grant execute on function public.record_verification_decision(
  uuid, uuid, text, public.verification_status, text
) to service_role;

-- 6. READ VERIFICATION HISTORY RPC
create or replace function public.list_verification_events(
  p_verification_id uuid
)
returns setof public.organization_verification_events
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select e.*
  from public.organization_verification_events e
  join public.organization_verifications v
    on v.id = e.verification_id
  where e.verification_id = p_verification_id
    and (
      public.has_org_role(
        v.org_id,
        array['owner','admin']::public.member_role[]
      )
      or public.is_platform_admin()
    )
  order by e.created_at asc, e.id asc;
$$;

revoke all on function public.list_verification_events(uuid)
from public, anon;

grant execute on function public.list_verification_events(uuid)
to authenticated;

-- END MIGRATION 0003
