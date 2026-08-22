-- A barcode must retain its exact delivery history.  The legacy
-- deposits.barcode_id field can only store one code for a multi-pot deposit,
-- so this table is the source of truth for every scanned pot.
create table if not exists public.deposit_barcodes (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null references public.deposits(id) on delete cascade,
  barcode_id uuid not null unique references public.barcodes(id) on delete restrict,
  scanned_at timestamptz not null default now(),
  scanned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (deposit_id, barcode_id)
);

alter table public.deposit_barcodes enable row level security;

-- Preserve the traceability that was previously stored on deposits.barcode_id.
-- The old rows are added before the trigger below, because their codes have
-- already been marked as used.
insert into public.deposit_barcodes (deposit_id, barcode_id, scanned_at, scanned_by)
select id, barcode_id, coalesce(deposited_at, created_at), null
from public.deposits
where barcode_id is not null
on conflict (barcode_id) do nothing;

drop policy if exists deposit_barcodes_select on public.deposit_barcodes;
create policy deposit_barcodes_select on public.deposit_barcodes for select to authenticated
  using (
    private.get_my_role() >= 2
    or exists (
      select 1
      from public.deposits d
      join public.delivery_batches b on b.id = d.batch_id
      join public.drivers dr on dr.id = b.driver_id
      where d.id = deposit_barcodes.deposit_id
        and dr.user_id = auth.uid()
    )
  );

drop policy if exists deposit_barcodes_insert on public.deposit_barcodes;
create policy deposit_barcodes_insert on public.deposit_barcodes for insert to authenticated
  with check (
    private.get_my_role() >= 2
    or exists (
      select 1
      from public.deposits d
      join public.delivery_batches b on b.id = d.batch_id
      join public.drivers dr on dr.id = b.driver_id
      where d.id = deposit_barcodes.deposit_id
        and dr.user_id = auth.uid()
    )
  );

-- Marking a code as used is performed only by this trigger.  The row lock and
-- the unique barcode_id constraint prevent the same code from being assigned
-- to two deposits, including under concurrent scans.
create or replace function private.link_barcode_to_deposit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_used boolean;
begin
  select is_used
    into v_is_used
    from public.barcodes
   where id = new.barcode_id
   for update;

  if not found then
    raise exception 'Code à barres introuvable';
  end if;

  if v_is_used then
    raise exception 'Ce code à barres a déjà été utilisé';
  end if;

  update public.barcodes
     set is_used = true,
         used_at = new.scanned_at
   where id = new.barcode_id;

  -- Retain compatibility with existing screens and historic queries that read
  -- the first scanned code from deposits.barcode_id.
  update public.deposits
     set barcode_id = new.barcode_id
   where id = new.deposit_id
     and barcode_id is null;

  return new;
end;
$$;

revoke all on function private.link_barcode_to_deposit() from public;
revoke all on function private.link_barcode_to_deposit() from anon;
revoke all on function private.link_barcode_to_deposit() from authenticated;

drop trigger if exists link_barcode_to_deposit on public.deposit_barcodes;
create trigger link_barcode_to_deposit
  before insert on public.deposit_barcodes
  for each row
  execute function private.link_barcode_to_deposit();

create index if not exists idx_deposit_barcodes_deposit_id on public.deposit_barcodes(deposit_id);
create index if not exists idx_deposit_barcodes_scanned_at on public.deposit_barcodes(scanned_at desc);
