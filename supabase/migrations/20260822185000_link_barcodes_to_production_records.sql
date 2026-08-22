-- A lot barcode identifies the exact production record that created the pots.
alter table public.barcodes
  add column if not exists production_record_id uuid references public.production_records(id) on delete restrict;

create unique index if not exists barcodes_production_record_unique
  on public.barcodes(production_record_id)
  where production_record_id is not null;

create index if not exists barcodes_production_record_id_idx
  on public.barcodes(production_record_id);
