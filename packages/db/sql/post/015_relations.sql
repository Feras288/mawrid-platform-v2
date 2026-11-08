-- Repeatable: cross-party relationship predicates (SECURITY DEFINER to avoid RLS recursion).
-- They read bridge tables as the owner, so callers cannot widen them with forged rows.

-- RFQ visible to the current (supplier) org: it is a recipient and the RFQ was actually sent to it.
CREATE OR REPLACE FUNCTION app_rfq_visible_to_supplier(p_rfq uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM rfq_recipients r
    WHERE r.rfq_id = p_rfq AND r.supplier_org_id = app_org() AND r.status IN ('sent','responded','declined')
  )
$$;

-- Is org p_org related to the current org through a business relationship?
CREATE OR REPLACE FUNCTION app_org_related(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM rfq_recipients r
    WHERE r.org_id = p_org AND r.supplier_org_id = app_org() AND r.status IN ('sent','responded','declined')
  ) OR EXISTS (
    SELECT 1 FROM rfq_recipients r
    WHERE r.supplier_org_id = p_org AND r.org_id = app_org()
  ) OR app_po_related(p_org)
$$;

-- File visible to the current org through a related entity (RFQ attachments for recipients,
-- submitted quotation attachments for the buyer, issued PO documents for the supplier).
CREATE OR REPLACE FUNCTION app_file_visible(p_file uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM rfq_attachments a
    JOIN rfq_recipients r ON r.rfq_id = a.rfq_id
    WHERE a.file_id = p_file AND r.supplier_org_id = app_org() AND r.status IN ('sent','responded','declined')
  ) OR EXISTS (
    SELECT 1 FROM quotation_attachments qa
    JOIN quotations q ON q.id = qa.quotation_id
    WHERE qa.file_id = p_file AND (q.supplier_org_id = app_org() OR (q.buyer_org_id = app_org() AND q.status IN ('submitted','superseded','withdrawn')))
  ) OR app_po_file_visible(p_file)
$$;
