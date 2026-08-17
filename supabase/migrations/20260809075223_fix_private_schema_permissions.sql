-- Grant USAGE on private schema so SECURITY INVOKER wrappers can call private functions
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO anon;

-- Grant EXECUTE on all private functions that have public wrappers
GRANT EXECUTE ON FUNCTION private.adjust_pot_stock(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.adjust_pot_stock(uuid, text, integer) TO anon;

GRANT EXECUTE ON FUNCTION private.increment_consignment_return(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.increment_consignment_return(uuid, integer) TO anon;

GRANT EXECUTE ON FUNCTION private.adjust_ingredient_stock(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.adjust_ingredient_stock(uuid, integer) TO anon;

GRANT EXECUTE ON FUNCTION private.collect_receivable_payment(uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.decrement_stock(uuid, integer) TO authenticated;

GRANT EXECUTE ON FUNCTION private.increment_pots_delivered(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.increment_pots_delivered(uuid, integer) TO anon;

GRANT EXECUTE ON FUNCTION private.get_my_role() TO authenticated;
