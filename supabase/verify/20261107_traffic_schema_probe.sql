-- Read-only. Run in the Supabase SQL editor and send me the result (copy the table, or export CSV).
-- I need it for Phase 3 and 4, to count wallet funding, first orders and sales value per source
-- using your real column names instead of guessing them.
select table_name, column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('profiles', 'orders', 'wallets', 'wallet_transactions', 'products')
 order by table_name, ordinal_position;
