-- Enable Supabase Realtime on key tables so the dashboard auto-refreshes
-- when data changes (deposits, receivables, expenses, stock movements, etc.)
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.delivery_batches,
  public.deposits,
  public.returns,
  public.receivables,
  public.receivable_payments,
  public.delivery_expenses,
  public.stock_movements,
  public.pot_types,
  public.sales_points,
  public.production_records,
  public.dough_deliveries,
  public.batch_pot_types,
  public.return_pot_types;
