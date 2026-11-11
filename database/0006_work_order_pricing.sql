-- ============================================================
-- KO-BRAS · MIGRATION 0006 · WORK ORDER PRICING
-- ============================================================
alter table public.work_orders
  add column price_per_dozen numeric(12, 2) not null default 0
    check (price_per_dozen >= 0),
  add column negotiable_note text;

comment on column public.work_orders.price_per_dozen is
  'Harga per lusin yang ditawarkan pemilik modal (Rp).';
comment on column public.work_orders.negotiable_note is
  'Catatan nego opsional dari pemilik modal.';

notify pgrst, 'reload schema';
