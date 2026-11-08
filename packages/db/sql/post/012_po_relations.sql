-- Repeatable: create placeholder purchase-order predicates only when missing, so 015_relations.sql
-- can reference them on a fresh database. The real definitions live in 070_rls_po.sql; this file never
-- overwrites them (avoids a window where PO visibility would be false during migrations).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_po_related') THEN
    EXECUTE 'CREATE FUNCTION app_po_related(p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'app_po_file_visible') THEN
    EXECUTE 'CREATE FUNCTION app_po_file_visible(p_file uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT false $f$';
  END IF;
END $$;
