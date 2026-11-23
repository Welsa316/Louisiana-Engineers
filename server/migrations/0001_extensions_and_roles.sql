-- Extensions, the application role and the acting-user helper.
--
-- Every API request runs as `app_user` (NOLOGIN, non-bypassing, so Row Level
-- Security applies) inside a transaction that sets `app.user_id`. Tables are
-- created by the migrating role, which stays their owner; definer functions
-- run as that owner and are how cross-user writes get through.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Roles are cluster-wide, so a database recreated by the test harness (or a
-- restore) finds the role already there.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

-- The migrating role must be able to `SET ROLE app_user` even where it is not
-- a superuser (Railway's user is; a locked-down one is not).
DO $$
BEGIN
  EXECUTE format('GRANT app_user TO %I', current_user);
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;

-- Tables, sequences and functions created by later migrations are reachable
-- by app_user; row-level policies decide which rows.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_user;

-- The acting user's id, null outside a user transaction (system context).
CREATE OR REPLACE FUNCTION app_uid() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION app_uid() TO app_user;
