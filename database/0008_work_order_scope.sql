-- ============================================================
-- KO-BRAS · MIGRATION 0008 · WORK ORDER SCOPE (Deskripsi, Alamat, PIC)
-- ============================================================

alter table public.work_orders
  add column description text,
  add column address text,
  add column pic_name text,
  add column pic_phone text;

comment on column public.work_orders.description is 'Detail/brief pekerjaan dari garment.';
comment on column public.work_orders.address is 'Alamat jemput bahan atau pengiriman.';
comment on column public.work_orders.pic_name is 'Nama penanggung jawab di garment.';
comment on column public.work_orders.pic_phone is 'Nomor WA PIC garment.';

notify pgrst, 'reload schema';
