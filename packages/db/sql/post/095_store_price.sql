-- Repeatable: denormalized store listing price (lowest current retail tier ≤ 1, ex-VAT) used only for
-- storefront filtering and sorting. Viewer-specific prices are still resolved by the application.

CREATE OR REPLACE FUNCTION refresh_store_price(p_product uuid) RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE supplier_products sp SET store_price = (
    SELECT min(i.unit_price * (1 - i.discount_pct / 100) / CASE WHEN l.prices_include_vat THEN (1 + sp.vat_rate) ELSE 1 END)
    FROM price_list_items i JOIN price_lists l ON l.id = i.price_list_id
    WHERE i.supplier_product_id = sp.id AND l.kind = 'retail' AND l.is_active
      AND (l.valid_from IS NULL OR l.valid_from <= now()) AND (l.valid_to IS NULL OR l.valid_to > now()) AND i.min_qty <= 1
  )
  WHERE sp.id = p_product
$$;

-- Full refresh (daily job: validity windows open/close over time; also used as a backfill)
CREATE OR REPLACE FUNCTION refresh_all_store_prices() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH p AS (
    SELECT i.supplier_product_id AS id,
           min(i.unit_price * (1 - i.discount_pct / 100) / CASE WHEN l.prices_include_vat THEN (1 + sp.vat_rate) ELSE 1 END) AS price
    FROM price_list_items i
    JOIN price_lists l ON l.id = i.price_list_id
    JOIN supplier_products sp ON sp.id = i.supplier_product_id
    WHERE l.kind = 'retail' AND l.is_active AND (l.valid_from IS NULL OR l.valid_from <= now()) AND (l.valid_to IS NULL OR l.valid_to > now()) AND i.min_qty <= 1
    GROUP BY i.supplier_product_id
  )
  UPDATE supplier_products sp SET store_price = p.price FROM (
    SELECT s.id, p.price FROM supplier_products s LEFT JOIN p ON p.id = s.id
  ) p
  WHERE sp.id = p.id AND sp.store_price IS DISTINCT FROM p.price;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION trg_price_item_store_price() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_store_price(OLD.supplier_product_id);
  ELSE
    PERFORM refresh_store_price(NEW.supplier_product_id);
    IF TG_OP = 'UPDATE' AND OLD.supplier_product_id <> NEW.supplier_product_id THEN PERFORM refresh_store_price(OLD.supplier_product_id); END IF;
  END IF;
  RETURN NULL;
END $$;

-- Statement-level variant for bulk inserts (imports): one recompute per statement, not per row
CREATE OR REPLACE FUNCTION trg_price_items_bulk_store_price() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE supplier_products sp SET store_price = x.price FROM (
    SELECT n.supplier_product_id AS id,
           (SELECT min(i.unit_price * (1 - i.discount_pct / 100) / CASE WHEN l.prices_include_vat THEN (1 + s2.vat_rate) ELSE 1 END)
            FROM price_list_items i JOIN price_lists l ON l.id = i.price_list_id JOIN supplier_products s2 ON s2.id = i.supplier_product_id
            WHERE i.supplier_product_id = n.supplier_product_id AND l.kind = 'retail' AND l.is_active
              AND (l.valid_from IS NULL OR l.valid_from <= now()) AND (l.valid_to IS NULL OR l.valid_to > now()) AND i.min_qty <= 1) AS price
    FROM (SELECT DISTINCT supplier_product_id FROM new_rows) n
  ) x WHERE sp.id = x.id;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION trg_price_list_store_price() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM refresh_store_price(i.supplier_product_id) FROM price_list_items i WHERE i.price_list_id = NEW.id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS price_items_store_price_ins ON price_list_items;
DROP TRIGGER IF EXISTS price_items_store_price_row ON price_list_items;
DROP TRIGGER IF EXISTS price_lists_store_price ON price_lists;
CREATE TRIGGER price_items_store_price_ins AFTER INSERT ON price_list_items REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION trg_price_items_bulk_store_price();
CREATE TRIGGER price_items_store_price_row AFTER UPDATE OR DELETE ON price_list_items
  FOR EACH ROW EXECUTE FUNCTION trg_price_item_store_price();
CREATE TRIGGER price_lists_store_price AFTER UPDATE OF kind, is_active, valid_from, valid_to, prices_include_vat ON price_lists
  FOR EACH ROW EXECUTE FUNCTION trg_price_list_store_price();

-- backfill (cheap when already up to date)
SELECT refresh_all_store_prices();

-- Public store catalog: owner-privileged view (security_invoker off) exposing only what the storefront may
-- show (published, active, priced products of approved suppliers). Searching through it lets Postgres use
-- the trigram/btree indexes (RLS quals would block non-leakproof ILIKE pushdown). The application re-reads
-- the selected rows under the viewer's RLS context.
CREATE OR REPLACE VIEW store_catalog AS
  SELECT sp.id, sp.org_id, sp.sku, sp.category_id, sp.brand_name, sp.name_ar, sp.name_en, sp.normalized_name, sp.store_price, sp.created_at
  FROM supplier_products sp
  WHERE sp.is_published AND sp.status = 'active' AND sp.store_price IS NOT NULL
    AND sp.org_id IN (SELECT unnest(app_approved_supplier_ids()));
GRANT SELECT ON store_catalog TO app_user;
