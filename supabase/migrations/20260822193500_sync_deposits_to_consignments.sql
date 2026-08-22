-- Every delivery deposit is the source of truth for the matching consignment.
-- Keeping this at database level also covers deposits queued offline and synced later.

create or replace function private.sync_deposit_to_consignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver_id uuid;
  v_consignment_id uuid;
begin
  -- A consignment is meaningful only for a fully identified delivery.
  if new.batch_id is null
    or new.sales_point_id is null
    or new.pot_type_id is null
    or coalesce(new.quantity, 0) <= 0 then
    return new;
  end if;

  -- Serialise deposits for the same batch / point / pot type, preventing a
  -- concurrent delivery from creating a duplicate consignment.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      new.batch_id::text || ':' || new.sales_point_id::text || ':' || new.pot_type_id::text,
      0
    )
  );

  select b.driver_id
    into v_driver_id
    from public.delivery_batches b
   where b.id = new.batch_id;

  select c.id
    into v_consignment_id
    from public.consignments c
   where c.batch_id = new.batch_id
     and c.sales_point_id = new.sales_point_id
     and c.pot_type_id = new.pot_type_id
   order by c.deposited_at desc, c.created_at desc
   limit 1
   for update;

  if v_consignment_id is not null then
    update public.consignments
       set quantity_deposited = quantity_deposited + new.quantity,
           driver_id = coalesce(v_driver_id, driver_id),
           deposited_at = now()
     where id = v_consignment_id;
  else
    insert into public.consignments (
      sales_point_id,
      batch_id,
      pot_type_id,
      driver_id,
      quantity_deposited,
      created_by,
      notes
    ) values (
      new.sales_point_id,
      new.batch_id,
      new.pot_type_id,
      v_driver_id,
      new.quantity,
      auth.uid(),
      'Créée automatiquement à partir d’un dépôt de tournée'
    );
  end if;

  return new;
end;
$$;

revoke all on function private.sync_deposit_to_consignment() from public;
revoke all on function private.sync_deposit_to_consignment() from anon;
revoke all on function private.sync_deposit_to_consignment() from authenticated;

drop trigger if exists sync_deposit_to_consignment on public.deposits;
create trigger sync_deposit_to_consignment
  after insert on public.deposits
  for each row
  execute function private.sync_deposit_to_consignment();
