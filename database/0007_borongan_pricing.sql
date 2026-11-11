-- ============================================================
-- KO-BRAS · MIGRATION 0007 · BORONGAN PRICING
-- ============================================================

-- 1. Tambah kolom total_price (harga borongan full)
alter table public.work_orders
  add column total_price numeric(14, 2) not null default 0
    check (total_price >= 0);

-- 2. Hapus kolom lama yang gak dipakai (opsional)
-- Kita biarin price_per_dozen ada buat jaga-jaga, tapi di frontend gak dipakai
-- alter table public.work_orders drop column price_per_dozen;

comment on column public.work_orders.total_price is
  'Total harga borongan untuk seluruh quantity (Rp).';

notify pgrst, 'reload schema';
