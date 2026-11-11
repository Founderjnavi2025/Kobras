-- KO-BRAS · 0005 · MARKETPLACE (EXCLUSIVE TAKE-ALL)
create type work_order_status as enum ('open', 'closed');
create type application_status as enum ('pending', 'accepted', 'rejected');

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  target_quantity int not null check (target_quantity > 0),
  deadline date,
  status work_order_status not null default 'open',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_wo_updated before update on public.work_orders for each row execute function public.set_updated_at();

create table public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  name text not null
);

create table public.work_order_applications (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  status application_status not null default 'pending',
  message text,
  applied_at timestamptz not null default now(),
  unique (work_order_id, org_id)
);

create table public.partner_surveys (
  id uuid primary key default gen_random_uuid(),
  garment_org_id uuid not null references public.organizations(id) on delete cascade,
  konveksi_org_id uuid not null references public.organizations(id) on delete cascade,
  surveyed_by uuid not null references public.profiles(id),
  unique(garment_org_id, konveksi_org_id)
);

-- RLS
alter table public.work_orders enable row level security;
alter table public.work_order_items enable row level security;
alter table public.work_order_applications enable row level security;
alter table public.partner_surveys enable row level security;

create policy wo_garment on public.work_orders for all using (public.has_org_role(org_id, array['owner','admin']::public.member_role[]));
create policy wo_konveksi on public.work_orders for select using (status = 'open' and exists (select 1 from public.organization_members m join public.organizations o on o.id = m.org_id where m.profile_id = auth.uid() and o.type = 'konveksi'));
create policy woi_select on public.work_order_items for select using (exists (select 1 from public.work_orders wo where wo.id = work_order_id));
create policy woi_garment on public.work_order_items for all using (exists (select 1 from public.work_orders wo where wo.id = work_order_id and public.has_org_role(wo.org_id, array['owner','admin']::public.member_role[])));
create policy app_konveksi_select on public.work_order_applications for select using (public.has_org_role(org_id, array['owner','admin']::public.member_role[]));
create policy app_garment_select on public.work_order_applications for select using (exists (select 1 from public.work_orders wo where wo.id = work_order_id and public.has_org_role(wo.org_id, array['owner','admin']::public.member_role[])));
create policy app_konveksi_insert on public.work_order_applications for insert with check (public.has_org_role(org_id, array['owner','admin']::public.member_role[]) and exists (select 1 from public.work_orders wo where wo.id = work_order_id and wo.status = 'open'));
create policy ps_select on public.partner_surveys for select using (public.has_org_role(garment_org_id, array['owner','admin']::public.member_role[]) or public.has_org_role(konveksi_org_id, array['owner','admin']::public.member_role[]));
create policy ps_insert on public.partner_surveys for insert with check (public.has_org_role(garment_org_id, array['owner','admin']::public.member_role[]));

-- RPC Terima (Eksklusif)
create or replace function public.accept_application(p_app_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_app public.work_order_applications;
  v_wo public.work_orders;
begin
  select * into v_app from public.work_order_applications where id = p_app_id for update;
  if v_app.status <> 'pending' then raise exception 'Lamaran sudah diproses'; end if;
  select * into v_wo from public.work_orders where id = v_app.work_order_id for update;
  if v_wo.status <> 'open' then raise exception 'Pekerjaan sudah diambil konveksi lain'; end if;
  if not public.has_org_role(v_wo.org_id, array['owner','admin']::public.member_role[]) then raise exception 'Bukan pemilik'; end if;
  
  insert into public.partner_surveys (garment_org_id, konveksi_org_id, surveyed_by)
  values (v_wo.org_id, v_app.org_id, auth.uid()) on conflict (garment_org_id, konveksi_org_id) do nothing;

  update public.work_order_applications set status = 'accepted' where id = p_app_id;
  update public.work_order_applications set status = 'rejected' where work_order_id = v_wo.id and id <> p_app_id;
  update public.work_orders set status = 'closed' where id = v_wo.id;
end; $$;

grant select, insert, update on public.work_orders to authenticated;
grant select, insert on public.work_order_items to authenticated;
grant select, insert, update on public.work_order_applications to authenticated;
grant select, insert on public.partner_surveys to authenticated;
notify pgrst, 'reload schema';
