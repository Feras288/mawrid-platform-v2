-- Repeatable: projects & BOQ are private to the owning buyer org.
-- Project-level restriction (visibility = 'members') is enforced in the service layer on top of this.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','project_members','project_activity','boq_documents','boq_processing_runs','boq_items','boq_item_matches','boq_item_revisions','boq_versions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_system() OR org_id = app_org()) WITH CHECK (app_is_system() OR org_id = app_org())', t || '_own', t);
  END LOOP;
END $$;

-- AI usage: org reads its own; writes by system (worker) only.
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_select ON ai_usage;
DROP POLICY IF EXISTS ai_usage_system ON ai_usage;
CREATE POLICY ai_usage_select ON ai_usage FOR SELECT USING (app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()));
CREATE POLICY ai_usage_system ON ai_usage FOR INSERT WITH CHECK (app_is_system());
