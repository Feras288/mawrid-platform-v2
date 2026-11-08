-- Repeatable: cross-party relationship predicates (SECURITY DEFINER to avoid RLS recursion).
-- Extended as modules add bridge tables (RFQ recipients, POs, order groups).

-- Is org p_org related to the current org through a business relationship?
CREATE OR REPLACE FUNCTION app_org_related(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT false
$$;

-- Is file p_file visible to the current org through a related entity?
CREATE OR REPLACE FUNCTION app_file_visible(p_file uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT false
$$;
