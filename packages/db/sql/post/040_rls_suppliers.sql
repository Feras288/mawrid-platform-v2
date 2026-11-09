-- Repeatable: supplier, catalog and pricing access rules.
-- A supplier is publicly visible only when its profile is approved AND its organization is active
-- (an admin suspension must hide its catalog, prices and directory entry immediately).

CREATE OR REPLACE FUNCTION app_approved_supplier_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(sp.org_id), '{}') FROM supplier_profiles sp JOIN organizations o ON o.id = sp.org_id
  WHERE sp.status = 'approved' AND o.status = 'active'
$$;

CREATE OR REPLACE FUNCTION app_supplier_approved(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM supplier_profiles sp JOIN organizations o ON o.id = sp.org_id
                 WHERE sp.org_id = p_org AND sp.status = 'approved' AND o.status = 'active')
$$;

-- Type of the current org ('buyer' | 'supplier' | 'platform' | NULL)
CREATE OR REPLACE FUNCTION app_org_type() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.type FROM organizations o WHERE o.id = app_org()
$$;

-- Total available (on hand - reserved) for a product; exposes availability without raw stock rows.
CREATE OR REPLACE FUNCTION product_available_qty(p_product uuid) RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(i.on_hand - i.reserved), 0)
  FROM inventory_levels i JOIN warehouses w ON w.id = i.warehouse_id AND w.is_active
  WHERE i.supplier_product_id = p_product
$$;

-- Verification status can only change through trusted (system-mode) service code.
CREATE OR REPLACE FUNCTION supplier_status_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT app_is_system() THEN
    RAISE EXCEPTION 'supplier status can only be changed by the platform' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) AND NOT app_is_system() THEN
    RAISE EXCEPTION 'review fields are read-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_status_guard ON supplier_profiles;
CREATE TRIGGER supplier_status_guard BEFORE UPDATE ON supplier_profiles FOR EACH ROW EXECUTE FUNCTION supplier_status_guard();

CREATE OR REPLACE FUNCTION supplier_profile_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'new' AND NOT app_is_system() THEN
    RAISE EXCEPTION 'new supplier profiles must start in status new' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_profile_insert_guard ON supplier_profiles;
CREATE TRIGGER supplier_profile_insert_guard BEFORE INSERT ON supplier_profiles FOR EACH ROW EXECUTE FUNCTION supplier_profile_insert_guard();

-- Document verification fields are platform-only.
CREATE OR REPLACE FUNCTION supplier_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_system() THEN
    IF TG_OP = 'INSERT' AND NEW.status <> 'uploaded' THEN
      RAISE EXCEPTION 'documents start as uploaded' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by) THEN
      RAISE EXCEPTION 'document verification is platform-only' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_document_guard ON supplier_documents;
CREATE TRIGGER supplier_document_guard BEFORE INSERT OR UPDATE ON supplier_documents FOR EACH ROW EXECUTE FUNCTION supplier_document_guard();

-- supplier_profiles: public when approved; own org always ----------------------------------
ALTER TABLE supplier_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_profiles_select ON supplier_profiles;
DROP POLICY IF EXISTS supplier_profiles_write ON supplier_profiles;
CREATE POLICY supplier_profiles_select ON supplier_profiles FOR SELECT USING (app_is_system() OR status = 'approved' OR org_id = app_org());
CREATE POLICY supplier_profiles_write ON supplier_profiles FOR ALL USING (app_is_system() OR org_id = app_org())
  WITH CHECK (app_is_system() OR org_id = app_org());

-- Private supplier data: own org only (admin review uses system mode after authorization) --
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_status_history','supplier_documents','warehouses','inventory_levels','inventory_movements']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org())', t || '_own', t);
  END LOOP;
END $$;

-- supplier_categories: public read (directory/suggestions), own write -------------------------
ALTER TABLE supplier_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_categories_select ON supplier_categories;
DROP POLICY IF EXISTS supplier_categories_write ON supplier_categories;
CREATE POLICY supplier_categories_select ON supplier_categories FOR SELECT USING (true);
CREATE POLICY supplier_categories_write ON supplier_categories FOR ALL USING (app_is_system() OR org_id = app_org())
  WITH CHECK (app_is_system() OR org_id = app_org());

-- supplier_products: public when active+published (or active for RFQ visibility) of approved suppliers
ALTER TABLE supplier_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_products_select ON supplier_products;
DROP POLICY IF EXISTS supplier_products_write ON supplier_products;
-- The approved-supplier set is computed once per query (InitPlan) instead of a function call per row.
CREATE POLICY supplier_products_select ON supplier_products FOR SELECT USING (
  app_is_system() OR org_id = app_org() OR (status = 'active' AND org_id IN (SELECT unnest(app_approved_supplier_ids())))
);
CREATE POLICY supplier_products_write ON supplier_products FOR ALL USING (app_is_system() OR org_id = app_org())
  WITH CHECK (app_is_system() OR org_id = app_org());

-- price lists: retail/regional public; enterprise to buyer orgs; org_specific to that buyer only
ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_lists_select ON price_lists;
DROP POLICY IF EXISTS price_lists_write ON price_lists;
CREATE POLICY price_lists_select ON price_lists FOR SELECT USING (
  app_is_system() OR org_id = app_org() OR (
    is_active AND app_supplier_approved(org_id) AND (
      kind IN ('retail', 'regional')
      OR (kind = 'enterprise' AND app_org_type() = 'buyer')
      OR (kind = 'org_specific' AND buyer_org_id = app_org())
    )
  )
);
CREATE POLICY price_lists_write ON price_lists FOR ALL USING (app_is_system() OR org_id = app_org())
  WITH CHECK (app_is_system() OR org_id = app_org());

ALTER TABLE price_list_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_list_items_select ON price_list_items;
DROP POLICY IF EXISTS price_list_items_write ON price_list_items;
CREATE POLICY price_list_items_select ON price_list_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM price_lists pl WHERE pl.id = price_list_items.price_list_id)
);
CREATE POLICY price_list_items_write ON price_list_items FOR ALL
  USING (app_is_system() OR EXISTS (SELECT 1 FROM price_lists pl WHERE pl.id = price_list_items.price_list_id AND pl.org_id = app_org()))
  WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM price_lists pl WHERE pl.id = price_list_items.price_list_id AND pl.org_id = app_org()));

-- imports: own org (org_id NULL = platform/admin batch, system only) -------------------------
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_batches_own ON import_batches;
CREATE POLICY import_batches_own ON import_batches FOR ALL USING (app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()))
  WITH CHECK (app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()));
ALTER TABLE import_batch_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_batch_rows_own ON import_batch_rows;
CREATE POLICY import_batch_rows_own ON import_batch_rows FOR ALL USING (app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()))
  WITH CHECK (app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()));

-- Reference data & canonical catalog: readable by all; writes go through admin services ---------
-- (no RLS: categories, units, attribute_definitions, category_attributes, brands, regions, cities,
--  canonical_products, duplicate_candidates)
