-- Repeatable: RFQ / quotation / evaluation / approvals access rules.

-- rfqs: buyer org full access; suppliers read RFQs sent to them.
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rfqs_select ON rfqs;
DROP POLICY IF EXISTS rfqs_write ON rfqs;
CREATE POLICY rfqs_select ON rfqs FOR SELECT USING (app_is_system() OR org_id = app_org() OR app_rfq_visible_to_supplier(id));
CREATE POLICY rfqs_write ON rfqs FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());

ALTER TABLE rfq_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rfq_items_select ON rfq_items;
DROP POLICY IF EXISTS rfq_items_write ON rfq_items;
CREATE POLICY rfq_items_select ON rfq_items FOR SELECT USING (app_is_system() OR org_id = app_org() OR app_rfq_visible_to_supplier(rfq_id));
CREATE POLICY rfq_items_write ON rfq_items FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());

ALTER TABLE rfq_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rfq_attachments_select ON rfq_attachments;
DROP POLICY IF EXISTS rfq_attachments_write ON rfq_attachments;
CREATE POLICY rfq_attachments_select ON rfq_attachments FOR SELECT USING (app_is_system() OR org_id = app_org() OR app_rfq_visible_to_supplier(rfq_id));
CREATE POLICY rfq_attachments_write ON rfq_attachments FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());

-- recipients: buyer sees all its recipients; a supplier sees only its own row once sent.
ALTER TABLE rfq_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rfq_recipients_select ON rfq_recipients;
DROP POLICY IF EXISTS rfq_recipients_write ON rfq_recipients;
CREATE POLICY rfq_recipients_select ON rfq_recipients FOR SELECT USING (
  app_is_system() OR org_id = app_org() OR (supplier_org_id = app_org() AND status IN ('sent','responded','declined'))
);
CREATE POLICY rfq_recipients_write ON rfq_recipients FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());

ALTER TABLE rfq_recipient_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rfq_recipient_events_select ON rfq_recipient_events;
DROP POLICY IF EXISTS rfq_recipient_events_write ON rfq_recipient_events;
CREATE POLICY rfq_recipient_events_select ON rfq_recipient_events FOR SELECT USING (app_is_system() OR org_id = app_org() OR supplier_org_id = app_org());
CREATE POLICY rfq_recipient_events_write ON rfq_recipient_events FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org());

-- quotations: the supplier owns its quotations; the buyer reads only submitted/superseded/withdrawn
-- versions. Competitors never see each other's quotations.
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotations_select ON quotations;
DROP POLICY IF EXISTS quotations_write ON quotations;
CREATE POLICY quotations_select ON quotations FOR SELECT USING (
  app_is_system() OR supplier_org_id = app_org() OR (buyer_org_id = app_org() AND status IN ('submitted','superseded','withdrawn'))
);
CREATE POLICY quotations_write ON quotations FOR ALL USING (app_is_system() OR supplier_org_id = app_org())
  WITH CHECK (app_is_system() OR (supplier_org_id = app_org() AND app_rfq_visible_to_supplier(rfq_id)));

ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotation_items_select ON quotation_items;
DROP POLICY IF EXISTS quotation_items_write ON quotation_items;
CREATE POLICY quotation_items_select ON quotation_items FOR SELECT USING (
  app_is_system() OR supplier_org_id = app_org()
  OR (buyer_org_id = app_org() AND EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND q.status IN ('submitted','superseded','withdrawn')))
);
CREATE POLICY quotation_items_write ON quotation_items FOR ALL USING (app_is_system() OR supplier_org_id = app_org()) WITH CHECK (app_is_system() OR supplier_org_id = app_org());

ALTER TABLE quotation_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotation_attachments_select ON quotation_attachments;
DROP POLICY IF EXISTS quotation_attachments_write ON quotation_attachments;
CREATE POLICY quotation_attachments_select ON quotation_attachments FOR SELECT USING (
  app_is_system() OR supplier_org_id = app_org()
  OR (buyer_org_id = app_org() AND EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND q.status IN ('submitted','superseded','withdrawn')))
);
CREATE POLICY quotation_attachments_write ON quotation_attachments FOR ALL USING (app_is_system() OR supplier_org_id = app_org()) WITH CHECK (app_is_system() OR supplier_org_id = app_org());

-- Buyer-private: RFQ events, evaluation, awards and approvals.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rfq_events','evaluation_scores','awards','award_lines','approval_policies','approval_policy_steps','approval_requests','approval_request_steps','approval_decisions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org())', t || '_own', t);
  END LOOP;
END $$;

-- Approval decisions are append-only for the application.
REVOKE UPDATE, DELETE ON approval_decisions FROM app_user;
