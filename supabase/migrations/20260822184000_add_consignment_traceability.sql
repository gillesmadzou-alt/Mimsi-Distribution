-- Trace every consignment to its pot type, production record and commercial.
-- Columns remain nullable to preserve compatibility with any historical rows.

alter table public.consignments
  add column if not exists pot_type_id uuid references public.pot_types(id) on delete restrict,
  add column if not exists production_record_id uuid references public.production_records(id) on delete restrict,
  add column if not exists driver_id uuid references public.drivers(id) on delete set null;

create index if not exists consignments_pot_type_id_idx on public.consignments(pot_type_id);
create index if not exists consignments_production_record_id_idx on public.consignments(production_record_id);
create index if not exists consignments_driver_id_idx on public.consignments(driver_id);
create index if not exists sales_points_zone_arrondissement_idx on public.sales_points(zone, arrondissement);
