-- Repeatable: price index & analytics.
-- Raw observations hold confidential prices and party identities: system-only.
-- Snapshots carry only aggregates; only published (k-anonymous) rows are readable by signed-in users.
-- Alerts belong to their owner.

ALTER TABLE price_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_observations_all ON price_observations;
CREATE POLICY price_observations_all ON price_observations FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

ALTER TABLE price_index_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_index_snapshots_select ON price_index_snapshots;
DROP POLICY IF EXISTS price_index_snapshots_write ON price_index_snapshots;
CREATE POLICY price_index_snapshots_select ON price_index_snapshots FOR SELECT USING (app_is_system() OR (published AND app_user_id() IS NOT NULL));
CREATE POLICY price_index_snapshots_write ON price_index_snapshots FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS price_alerts_all ON price_alerts;
CREATE POLICY price_alerts_all ON price_alerts FOR ALL USING (app_is_system() OR user_id = app_user_id()) WITH CHECK (app_is_system() OR user_id = app_user_id());

-- content pages: published pages are public; drafts and edits are system/admin (via services)
ALTER TABLE content_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_pages_select ON content_pages;
DROP POLICY IF EXISTS content_pages_write ON content_pages;
CREATE POLICY content_pages_select ON content_pages FOR SELECT USING (app_is_system() OR status = 'published');
CREATE POLICY content_pages_write ON content_pages FOR ALL USING (app_is_system()) WITH CHECK (app_is_system());

