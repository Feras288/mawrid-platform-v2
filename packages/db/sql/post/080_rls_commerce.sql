-- Repeatable: store / commerce isolation.
-- Customer = the user for personal orders (org_id null) or the buyer org for org orders.
-- Supplier = sees only its own order groups once payment has been confirmed (never other suppliers'
-- groups of the same order, nor the parent order row). All order/payment mutations run in system mode
-- inside audited services; carts and wishlists are written directly by their owner.

CREATE OR REPLACE FUNCTION app_is_customer(p_user uuid, p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
  SELECT (p_org IS NULL AND p_user = app_user_id()) OR (p_org IS NOT NULL AND p_org = app_org())
$$;

CREATE OR REPLACE FUNCTION app_group_visible_to_supplier(p_group uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM order_groups g WHERE g.id = p_group AND g.supplier_org_id = app_org() AND g.status <> 'awaiting_payment')
$$;

-- carts / wishlists: owner only
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS carts_all ON carts;
CREATE POLICY carts_all ON carts FOR ALL USING (app_is_system() OR user_id = app_user_id()) WITH CHECK (app_is_system() OR user_id = app_user_id());

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cart_items_all ON cart_items;
CREATE POLICY cart_items_all ON cart_items FOR ALL USING (app_is_system() OR user_id = app_user_id()) WITH CHECK (app_is_system() OR user_id = app_user_id());

ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wishlist_items_all ON wishlist_items;
CREATE POLICY wishlist_items_all ON wishlist_items FOR ALL USING (app_is_system() OR user_id = app_user_id()) WITH CHECK (app_is_system() OR user_id = app_user_id());

-- shipping: active zones/rates are public; suppliers manage their own; platform defaults are system-only
ALTER TABLE shipping_zones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_zones_select ON shipping_zones;
DROP POLICY IF EXISTS shipping_zones_write ON shipping_zones;
CREATE POLICY shipping_zones_select ON shipping_zones FOR SELECT USING (app_is_system() OR is_active OR supplier_org_id = app_org());
CREATE POLICY shipping_zones_write ON shipping_zones FOR ALL USING (app_is_system() OR (supplier_org_id IS NOT NULL AND supplier_org_id = app_org()))
  WITH CHECK (app_is_system() OR (supplier_org_id IS NOT NULL AND supplier_org_id = app_org()));

ALTER TABLE shipping_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_rates_select ON shipping_rates;
DROP POLICY IF EXISTS shipping_rates_write ON shipping_rates;
CREATE POLICY shipping_rates_select ON shipping_rates FOR SELECT USING (app_is_system() OR is_active OR supplier_org_id = app_org());
CREATE POLICY shipping_rates_write ON shipping_rates FOR ALL USING (app_is_system() OR (supplier_org_id IS NOT NULL AND supplier_org_id = app_org()))
  WITH CHECK (app_is_system() OR (supplier_org_id IS NOT NULL AND supplier_org_id = app_org()));

-- orders and payments: customer read; writes system-only
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_select ON orders;
DROP POLICY IF EXISTS orders_write ON orders;
CREATE POLICY orders_select ON orders FOR SELECT USING (app_is_system() OR app_is_customer(user_id, org_id));
CREATE POLICY orders_write ON orders FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

ALTER TABLE order_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_groups_select ON order_groups;
DROP POLICY IF EXISTS order_groups_write ON order_groups;
CREATE POLICY order_groups_select ON order_groups FOR SELECT USING (
  app_is_system() OR app_is_customer(user_id, org_id) OR (supplier_org_id = app_org() AND status <> 'awaiting_payment')
);
CREATE POLICY order_groups_write ON order_groups FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_lines','refunds','invoices']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app_is_system() OR app_is_customer(user_id, org_id) OR (group_id IS NOT NULL AND app_group_visible_to_supplier(group_id)))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_system()) WITH CHECK (app_is_system())', t || '_write', t);
  END LOOP;
END $$;

ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS return_requests_select ON return_requests;
DROP POLICY IF EXISTS return_requests_write ON return_requests;
CREATE POLICY return_requests_select ON return_requests FOR SELECT USING (app_is_system() OR app_is_customer(user_id, org_id) OR supplier_org_id = app_org());
CREATE POLICY return_requests_write ON return_requests FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

-- charges: customers see what they pay; suppliers see their group's breakdown incl. commission/payable
ALTER TABLE order_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_charges_select ON order_charges;
DROP POLICY IF EXISTS order_charges_write ON order_charges;
CREATE POLICY order_charges_select ON order_charges FOR SELECT USING (
  app_is_system()
  OR (app_is_customer(user_id, org_id) AND kind IN ('goods','discount','shipping','goods_vat','shipping_vat'))
  OR (group_id IS NOT NULL AND app_group_visible_to_supplier(group_id))
);
CREATE POLICY order_charges_write ON order_charges FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_events_select ON order_events;
DROP POLICY IF EXISTS order_events_write ON order_events;
CREATE POLICY order_events_select ON order_events FOR SELECT USING (
  app_is_system() OR app_is_customer(user_id, org_id) OR (group_id IS NOT NULL AND app_group_visible_to_supplier(group_id))
);
CREATE POLICY order_events_write ON order_events FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

ALTER TABLE payment_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_intents_select ON payment_intents;
DROP POLICY IF EXISTS payment_intents_write ON payment_intents;
CREATE POLICY payment_intents_select ON payment_intents FOR SELECT USING (app_is_system() OR app_is_customer(user_id, org_id));
CREATE POLICY payment_intents_write ON payment_intents FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

-- system-only tables (raw provider payloads, attempts, ledger)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_attempts','payment_webhook_events','ledger_entries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_all', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_system()) WITH CHECK (app_is_system())', t || '_all', t);
  END LOOP;
END $$;

-- the ledger is append-only for the application
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM app_user;
