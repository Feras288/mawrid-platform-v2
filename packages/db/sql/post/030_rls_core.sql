-- Repeatable: RLS for identity/organization/platform tables.
-- Pattern: every policy admits app_is_system(); tenant rows admit app_org(); personal rows admit app_user_id().

-- organizations ---------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_select ON organizations;
DROP POLICY IF EXISTS organizations_insert ON organizations;
DROP POLICY IF EXISTS organizations_update ON organizations;
DROP POLICY IF EXISTS organizations_delete ON organizations;
-- Supplier and platform orgs are a public directory; buyer orgs only to members / active org /
-- related parties (app_org_related is (re)defined in later module files).
CREATE POLICY organizations_select ON organizations FOR SELECT USING (
  app_is_system() OR type IN ('supplier', 'platform') OR id = app_org() OR app_is_member(id) OR app_org_related(id)
);
CREATE POLICY organizations_insert ON organizations FOR INSERT WITH CHECK (
  app_is_system() OR (app_user_id() IS NOT NULL AND created_by = app_user_id())
);
CREATE POLICY organizations_update ON organizations FOR UPDATE USING (app_is_system() OR id = app_org());
CREATE POLICY organizations_delete ON organizations FOR DELETE USING (app_is_system());

-- memberships -----------------------------------------------------------------
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memberships_select ON memberships;
DROP POLICY IF EXISTS memberships_write ON memberships;
CREATE POLICY memberships_select ON memberships FOR SELECT USING (
  app_is_system() OR user_id = app_user_id() OR org_id = app_org()
);
CREATE POLICY memberships_write ON memberships FOR ALL USING (app_is_system() OR org_id = app_org())
  WITH CHECK (app_is_system() OR org_id = app_org());

-- roles: system templates readable by all; org roles by the org -----------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_select ON roles;
DROP POLICY IF EXISTS roles_write ON roles;
CREATE POLICY roles_select ON roles FOR SELECT USING (app_is_system() OR org_id IS NULL OR org_id = app_org());
CREATE POLICY roles_write ON roles FOR ALL USING (app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()))
  WITH CHECK (app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()));

ALTER TABLE membership_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS membership_roles_all ON membership_roles;
CREATE POLICY membership_roles_all ON membership_roles FOR ALL USING (app_is_system() OR org_id = app_org())
  WITH CHECK (app_is_system() OR org_id = app_org());

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invitations_all ON invitations;
CREATE POLICY invitations_all ON invitations FOR ALL USING (app_is_system() OR org_id = app_org())
  WITH CHECK (app_is_system() OR org_id = app_org());

ALTER TABLE addresses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS addresses_all ON addresses;
CREATE POLICY addresses_all ON addresses FOR ALL
  USING (app_is_system() OR user_id = app_user_id() OR (org_id IS NOT NULL AND org_id = app_org()))
  WITH CHECK (app_is_system() OR user_id = app_user_id() OR (org_id IS NOT NULL AND org_id = app_org()));

ALTER TABLE org_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_counters_all ON org_counters;
CREATE POLICY org_counters_all ON org_counters FOR ALL USING (app_is_system() OR org_id = app_org())
  WITH CHECK (app_is_system() OR org_id = app_org());

-- audit_logs: append-only (grants), read own org ---------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT USING (app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()));
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (
  app_is_system() OR org_id IS NULL OR org_id = app_org()
);

-- outbox: any context may enqueue in-transaction; only system reads/dispatches ----
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbox_insert ON outbox_events;
DROP POLICY IF EXISTS outbox_system ON outbox_events;
CREATE POLICY outbox_insert ON outbox_events FOR INSERT WITH CHECK (true);
CREATE POLICY outbox_system ON outbox_events FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

-- breakglass: system only --------------------------------------------------------
ALTER TABLE breakglass_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS breakglass_system ON breakglass_grants;
CREATE POLICY breakglass_system ON breakglass_grants FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

-- notifications ------------------------------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_own ON notifications;
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_own ON notifications FOR ALL USING (app_is_system() OR user_id = app_user_id())
  WITH CHECK (app_is_system() OR user_id = app_user_id());

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_deliveries_system ON notification_deliveries;
CREATE POLICY notification_deliveries_system ON notification_deliveries FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

-- consents / data requests -------------------------------------------------------
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consents_own ON consents;
CREATE POLICY consents_own ON consents FOR ALL USING (app_is_system() OR user_id = app_user_id())
  WITH CHECK (app_is_system() OR user_id = app_user_id());

ALTER TABLE data_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_requests_own ON data_requests;
CREATE POLICY data_requests_own ON data_requests FOR ALL USING (app_is_system() OR user_id = app_user_id())
  WITH CHECK (app_is_system() OR user_id = app_user_id());

-- files: own org, public classification, or related-party visibility (app_file_visible) --
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS files_select ON files;
DROP POLICY IF EXISTS files_insert ON files;
DROP POLICY IF EXISTS files_update ON files;
CREATE POLICY files_select ON files FOR SELECT USING (
  app_is_system()
  OR classification = 'public'
  OR (org_id IS NOT NULL AND org_id = app_org())
  OR (org_id IS NULL AND uploaded_by = app_user_id())
  OR app_file_visible(id)
);
CREATE POLICY files_insert ON files FOR INSERT WITH CHECK (
  app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()) OR (org_id IS NULL AND uploaded_by = app_user_id())
);
CREATE POLICY files_update ON files FOR UPDATE USING (
  app_is_system() OR (org_id IS NOT NULL AND org_id = app_org()) OR (org_id IS NULL AND uploaded_by = app_user_id())
);
