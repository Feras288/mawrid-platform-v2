-- Repeatable: purchase orders. Buyer org: full access. Supplier: read-only access to ISSUED
-- (approved) POs addressed to it; supplier mutations go through audited services in system mode.

CREATE OR REPLACE FUNCTION app_po_issued_to_me(p_po uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id = p_po AND p.supplier_org_id = app_org() AND p.approval_status = 'approved')
$$;

CREATE OR REPLACE FUNCTION app_po_related(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM purchase_orders p WHERE p.org_id = p_org AND p.supplier_org_id = app_org() AND p.approval_status = 'approved')
      OR EXISTS (SELECT 1 FROM purchase_orders p WHERE p.supplier_org_id = p_org AND p.org_id = app_org())
$$;

CREATE OR REPLACE FUNCTION app_po_file_visible(p_file uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM purchase_orders p
    WHERE (p.pdf_file_id_ar = p_file OR p.pdf_file_id_en = p_file)
      AND ((p.supplier_org_id = app_org() AND p.approval_status = 'approved') OR p.org_id = app_org())
  ) OR EXISTS (
    SELECT 1 FROM shipments s WHERE p_file = ANY(s.attachment_file_ids) AND (s.org_id = app_org() OR s.supplier_org_id = app_org())
  ) OR EXISTS (
    SELECT 1 FROM goods_receipts g WHERE p_file = ANY(g.attachment_file_ids) AND (g.org_id = app_org() OR g.supplier_org_id = app_org())
  )
$$;

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_orders_select ON purchase_orders;
DROP POLICY IF EXISTS purchase_orders_write ON purchase_orders;
CREATE POLICY purchase_orders_select ON purchase_orders FOR SELECT USING (
  app_is_system() OR org_id = app_org() OR (supplier_org_id = app_org() AND approval_status = 'approved')
);
CREATE POLICY purchase_orders_write ON purchase_orders FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['po_items','shipments','goods_receipts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app_is_system() OR org_id = app_org() OR app_po_issued_to_me(po_id))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org())', t || '_write', t);
  END LOOP;
END $$;

ALTER TABLE po_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_events_select ON po_events;
DROP POLICY IF EXISTS po_events_write ON po_events;
CREATE POLICY po_events_select ON po_events FOR SELECT USING (app_is_system() OR org_id = app_org() OR (visible_to_supplier AND app_po_issued_to_me(po_id)));
CREATE POLICY po_events_write ON po_events FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());

ALTER TABLE shipment_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipment_items_select ON shipment_items;
DROP POLICY IF EXISTS shipment_items_write ON shipment_items;
CREATE POLICY shipment_items_select ON shipment_items FOR SELECT USING (app_is_system() OR org_id = app_org() OR supplier_org_id = app_org());
CREATE POLICY shipment_items_write ON shipment_items FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());

ALTER TABLE goods_receipt_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS goods_receipt_items_select ON goods_receipt_items;
DROP POLICY IF EXISTS goods_receipt_items_write ON goods_receipt_items;
CREATE POLICY goods_receipt_items_select ON goods_receipt_items FOR SELECT USING (app_is_system() OR org_id = app_org() OR supplier_org_id = app_org());
CREATE POLICY goods_receipt_items_write ON goods_receipt_items FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());
