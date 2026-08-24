alter table public.sales_points
  add column if not exists client_type_other text;

alter table public.sales_points
  drop constraint if exists sales_points_client_type_check;

alter table public.sales_points
  add constraint sales_points_client_type_check
  check (client_type in (
    'detail',
    'grossiste',
    'boutique',
    'kiosque',
    'mobile_money',
    'supermarche',
    'restaurant_hotel',
    'entreprise',
    'autre'
  ));

alter table public.sales_points
  drop constraint if exists sales_points_client_type_other_check;

alter table public.sales_points
  add constraint sales_points_client_type_other_check
  check (
    client_type <> 'autre'
    or (client_type_other is not null and btrim(client_type_other) <> '')
  );
