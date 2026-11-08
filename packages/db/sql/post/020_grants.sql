-- Repeatable: runtime role privileges. app_user never owns tables and has no BYPASSRLS.
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;
-- Audit log is append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_user;
