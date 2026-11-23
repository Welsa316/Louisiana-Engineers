-- Core schema: accounts, sessions, sign-in tokens, profiles, configuration,
-- administrators, the audit log and account deletions, with row-level
-- security (02-technical-architecture.md sections 4.3, 4.5, 5.2 to 5.4).
--
-- The migrating role owns every table. `app_user` gets the default grants
-- from 0001; this file narrows them per table to what section 5.3 allows,
-- and the policies decide which rows. Every state transition and every
-- cross-user write is a SECURITY DEFINER function, which runs as the table
-- owner; owner-guard triggers let exactly that role through.

-- Enumerated types used by these tables ------------------------------------

CREATE TYPE profile_kind AS ENUM ('student', 'professional');
CREATE TYPE visibility AS ENUM ('public', 'members', 'hidden');
CREATE TYPE approval_state AS ENUM ('pending', 'approved', 'declined');

-- Shared trigger helpers ----------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- True when the statement runs as the owner of `rel`: the migrating role,
-- which is what SECURITY DEFINER functions, jobs, the auth module and the
-- seed run as. Owner-guard triggers use it to let those writes through and
-- stop the same change made directly by `app_user`. Deliberately not
-- SECURITY DEFINER: it must see the caller's `current_user`.
CREATE FUNCTION acting_as_table_owner(rel regclass) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT current_user = (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = rel)
$$;

-- users ---------------------------------------------------------------------

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE,
  email_verified_at timestamptz,
  google_sub text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz,
  suspended_at timestamptz,
  deleted_at timestamptz,
  -- The address goes only when the deletion sweep turns the row into a tombstone.
  CONSTRAINT users_email_until_deleted CHECK (email IS NOT NULL OR deleted_at IS NOT NULL)
);

-- sessions and auth_tokens --------------------------------------------------

CREATE TABLE sessions (
  id text PRIMARY KEY, -- sha256 of the cookie value
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL DEFAULT 'magic-link',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The per-address and per-IP hourly rate limits count from these.
CREATE INDEX auth_tokens_email_created_idx ON auth_tokens (email, created_at);
CREATE INDEX auth_tokens_ip_created_idx ON auth_tokens (ip, created_at);

-- job_runs ------------------------------------------------------------------

CREATE TABLE job_runs (
  job text PRIMARY KEY,
  last_run_at timestamptz,
  locked_at timestamptz
);

-- config --------------------------------------------------------------------

CREATE TABLE config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO config (key, value) VALUES
  ('request_expiry_days', '14'),
  ('reminder_days', '[5, 10]'),
  ('pending_cap', '3'),
  ('default_max_active', '3'),
  ('daily_request_limit', '5'),
  ('daily_report_limit', '3'),
  ('magic_links_per_hour', '5'),
  ('platform_paused', 'false'),
  ('retention_months', '24');

-- profiles ------------------------------------------------------------------

CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES users (id),
  first_name text CHECK (char_length(first_name) BETWEEN 1 AND 60),
  last_name text CHECK (char_length(last_name) BETWEEN 1 AND 60),
  credentials text CHECK (char_length(credentials) <= 20),
  kind profile_kind, -- null until onboarding
  region text NOT NULL DEFAULT 'greater-new-orleans'
    CHECK (char_length(region) <= 60 AND region ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  location text CHECK (char_length(location) BETWEEN 1 AND 80),
  bio text CHECK (char_length(bio) BETWEEN 120 AND 1200),
  linkedin_url text CHECK (
    char_length(linkedin_url) <= 300 AND linkedin_url ~* '^https://(www\.)?linkedin\.com(/|$)'
  ),
  website_url text CHECK (char_length(website_url) <= 300 AND website_url ~* '^https://[^/\s]+'),
  visibility visibility NOT NULL DEFAULT 'public',
  approval_state approval_state NOT NULL DEFAULT 'pending',
  mission_accepted_at timestamptz,
  admin_hidden_at timestamptz,
  last_active_at timestamptz,
  anonymized_at timestamptz,
  -- Names only, unstemmed ('simple'); professional_details.search_tsv carries
  -- title, organization, bio and tags (Task 11).
  search_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_search_tsv_idx ON profiles USING gin (search_tsv);
CREATE INDEX profiles_listing_idx ON profiles (kind, approval_state, visibility) WHERE admin_hidden_at IS NULL;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An owner (or an administrator acting directly) cannot move the columns
-- that only the functions in section 4.5 may change.
CREATE FUNCTION profiles_guard_protected_columns() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF acting_as_table_owner(TG_RELID) THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.approval_state IS DISTINCT FROM OLD.approval_state
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.anonymized_at IS DISTINCT FROM OLD.anonymized_at
     OR NEW.admin_hidden_at IS DISTINCT FROM OLD.admin_hidden_at
     OR NEW.mission_accepted_at IS DISTINCT FROM OLD.mission_accepted_at
     OR NEW.last_active_at IS DISTINCT FROM OLD.last_active_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'mest.protected_field'
      USING ERRCODE = '42501',
            DETAIL = 'id, approval_state, kind, anonymized_at, admin_hidden_at, mission_accepted_at, last_active_at and created_at change only through their functions';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER profiles_guard_protected_columns BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_guard_protected_columns();

-- admin_roles ---------------------------------------------------------------

CREATE TABLE admin_roles (
  profile_id uuid PRIMARY KEY REFERENCES profiles (id),
  granted_by uuid REFERENCES profiles (id), -- null when granted by the admin-grant command
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- audit_log -----------------------------------------------------------------

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES profiles (id), -- null for jobs and the seed
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  subject_type text,
  subject_id uuid,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_subject_idx ON audit_log (subject_type, subject_id);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);

-- Append-only for everyone, the table owner included.
CREATE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'mest.audit_append_only' USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- account_deletions ---------------------------------------------------------

CREATE TABLE account_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  execute_after timestamptz NOT NULL,
  canceled_at timestamptz,
  executed_at timestamptz,
  previous_visibility visibility NOT NULL,
  reason text CHECK (char_length(reason) <= 1000),
  immediate boolean NOT NULL DEFAULT false
);
-- At most one open deletion per member.
CREATE UNIQUE INDEX account_deletions_one_open_idx ON account_deletions (profile_id)
  WHERE canceled_at IS NULL AND executed_at IS NULL;
CREATE INDEX account_deletions_due_idx ON account_deletions (execute_after)
  WHERE canceled_at IS NULL AND executed_at IS NULL;

-- Role helpers (section 5.2) ------------------------------------------------
-- SECURITY DEFINER so policies can call them without reading the tables as
-- app_user (which would recurse into the same policies).

CREATE FUNCTION is_member() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM users u
      JOIN profiles p ON p.id = u.id
     WHERE u.id = app_uid()
       AND u.email_verified_at IS NOT NULL
       AND u.suspended_at IS NULL
       AND u.deleted_at IS NULL
       AND p.anonymized_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM account_deletions d
          WHERE d.profile_id = u.id AND d.canceled_at IS NULL AND d.executed_at IS NULL
       )
  )
$$;

CREATE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin_roles WHERE profile_id = app_uid() AND revoked_at IS NULL
  )
$$;

-- Whether a profile takes part in the directory at all. The participation
-- array lives in professional_details, which Task 11 creates; that task
-- replaces this body with `'directory' = ANY(participation)` (keeping
-- SECURITY DEFINER so the profiles policies never recurse through the
-- details table's own policy). Until then every profile participates.
CREATE FUNCTION profile_in_directory(profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT profile_id IS NOT NULL
$$;

-- Whether the caller may read a profile: `visible`, `members_only` (listed
-- for members, and the caller is not one) or `none`. Lets a route answer 403
-- versus 404 without reading rows the policies hide. Mirrors the profiles
-- SELECT policies below; Task 19 adds the counterparty case to both.
CREATE FUNCTION profile_access(id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p profiles%ROWTYPE;
BEGIN
  SELECT * INTO p FROM profiles WHERE profiles.id = profile_access.id;
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  IF p.id = app_uid() OR is_admin() THEN
    RETURN 'visible';
  END IF;
  IF p.kind IS DISTINCT FROM 'professional'
     OR p.approval_state <> 'approved'
     OR p.admin_hidden_at IS NOT NULL
     OR p.anonymized_at IS NOT NULL
     OR NOT profile_in_directory(p.id) THEN
    RETURN 'none';
  END IF;
  IF p.visibility = 'public' THEN
    RETURN 'visible';
  END IF;
  IF p.visibility = 'members' THEN
    RETURN CASE WHEN is_member() THEN 'visible' ELSE 'members_only' END;
  END IF;
  RETURN 'none';
END
$$;

-- Audit -----------------------------------------------------------------------

-- Removes private keys at any depth, case-insensitively, so contact values
-- and request text cannot reach the log by mistake.
CREATE FUNCTION audit_strip_private(detail jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
BEGIN
  CASE jsonb_typeof(detail)
    WHEN 'object' THEN
      RETURN coalesce(
        (SELECT jsonb_object_agg(e.key, audit_strip_private(e.value))
           FROM jsonb_each(detail) AS e
          WHERE lower(e.key) <> ALL (
            ARRAY['email', 'contact_email', 'phone', 'why', 'goals', 'scheduling_note', 'mentor_note']
          )),
        '{}'::jsonb
      );
    WHEN 'array' THEN
      RETURN coalesce(
        (SELECT jsonb_agg(audit_strip_private(a.value) ORDER BY a.ordinality)
           FROM jsonb_array_elements(detail) WITH ORDINALITY AS a),
        '[]'::jsonb
      );
    ELSE
      RETURN detail;
  END CASE;
END
$$;

-- The one way into audit_log. The actor is always app_uid() (null in system
-- context), so a caller cannot write an entry in someone else's name.
CREATE FUNCTION write_audit(action text, subject_type text, subject_id uuid, detail jsonb DEFAULT '{}')
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id bigint;
BEGIN
  IF action IS NULL OR char_length(action) = 0 THEN
    RAISE EXCEPTION 'mest.invalid_audit' USING ERRCODE = '22023';
  END IF;
  INSERT INTO audit_log (actor_id, action, subject_type, subject_id, detail)
  VALUES (app_uid(), action, subject_type, subject_id, audit_strip_private(coalesce(detail, '{}'::jsonb)))
  RETURNING id INTO new_id;
  RETURN new_id;
END
$$;

-- Configuration -------------------------------------------------------------

CREATE FUNCTION config_is_int_between(value jsonb, low int, high int) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_typeof(value) = 'number'
     AND value::numeric = trunc(value::numeric)
     AND value::numeric BETWEEN low AND high
$$;

-- Validates per key (ranges in section 4.3), writes, audits `config.updated`.
CREATE FUNCTION admin_update_config(key text, value jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous jsonb;
  expiry int;
  reminders jsonb;
  item jsonb;
  last_day int := 0;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;

  -- Expiry and reminder days validate against each other, so lock both rows
  -- (in a fixed order) before reading either; concurrent edits cannot then
  -- each pass and leave a reminder at or past the expiry.
  PERFORM 1 FROM config c WHERE c.key IN ('reminder_days', 'request_expiry_days') ORDER BY c.key FOR UPDATE;
  SELECT c.value INTO previous FROM config c WHERE c.key = admin_update_config.key FOR UPDATE;
  IF NOT FOUND OR value IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'unknown key';
  END IF;

  CASE admin_update_config.key
    WHEN 'request_expiry_days' THEN
      IF NOT config_is_int_between(value, 3, 60) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'request_expiry_days is 3..60';
      END IF;
      SELECT c.value INTO reminders FROM config c WHERE c.key = 'reminder_days';
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(reminders) AS r
         WHERE r.value::numeric >= admin_update_config.value::numeric
      ) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023',
          DETAIL = 'request_expiry_days must be above every reminder day';
      END IF;
    WHEN 'reminder_days' THEN
      IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 2 THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023',
          DETAIL = 'reminder_days is an array of at most 2 days (reminders_sent counts to 2)';
      END IF;
      SELECT c.value::int INTO expiry FROM config c WHERE c.key = 'request_expiry_days';
      FOR item IN SELECT a.value FROM jsonb_array_elements(admin_update_config.value) WITH ORDINALITY AS a ORDER BY a.ordinality LOOP
        IF NOT config_is_int_between(item, last_day + 1, expiry - 1) THEN
          RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023',
            DETAIL = 'reminder_days are ascending whole days below request_expiry_days';
        END IF;
        last_day := item::int;
      END LOOP;
    WHEN 'pending_cap' THEN
      IF NOT config_is_int_between(value, 1, 10) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'pending_cap is 1..10';
      END IF;
    WHEN 'default_max_active' THEN
      IF NOT config_is_int_between(value, 1, 10) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'default_max_active is 1..10';
      END IF;
    WHEN 'daily_request_limit' THEN
      IF NOT config_is_int_between(value, 1, 50) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'daily_request_limit is 1..50';
      END IF;
    WHEN 'daily_report_limit' THEN
      IF NOT config_is_int_between(value, 1, 20) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'daily_report_limit is 1..20';
      END IF;
    WHEN 'magic_links_per_hour' THEN
      IF NOT config_is_int_between(value, 1, 20) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'magic_links_per_hour is 1..20';
      END IF;
    WHEN 'platform_paused' THEN
      IF jsonb_typeof(value) <> 'boolean' THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'platform_paused is a boolean';
      END IF;
    WHEN 'retention_months' THEN
      IF NOT config_is_int_between(value, 6, 60) THEN
        RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'retention_months is 6..60';
      END IF;
    ELSE
      RAISE EXCEPTION 'mest.invalid_config' USING ERRCODE = '22023', DETAIL = 'unknown key';
  END CASE;

  UPDATE config c SET value = admin_update_config.value, updated_at = now() WHERE c.key = admin_update_config.key;
  PERFORM write_audit(
    'config.updated', 'config', NULL,
    jsonb_build_object('key', admin_update_config.key, 'previous', previous, 'value', admin_update_config.value)
  );
END
$$;

-- Privileges (section 5.3) ----------------------------------------------------
-- 0001's default privileges granted app_user SELECT, INSERT, UPDATE and
-- DELETE on every new table; take back what this schema does not allow.

REVOKE ALL ON users, sessions, auth_tokens, job_runs FROM app_user;
-- Audit entries come only from SECURITY DEFINER functions (which run as the
-- owner but still see the caller's app.user_id) and from system jobs.
REVOKE EXECUTE ON FUNCTION write_audit(text, text, uuid, jsonb) FROM PUBLIC, app_user;
REVOKE INSERT, DELETE ON profiles FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON config, admin_roles, audit_log, account_deletions FROM app_user;

-- Row-level security ----------------------------------------------------------
-- Every table has RLS on. Tables without a policy for app_user (users,
-- sessions, auth_tokens, job_runs) also have no grant.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY config_read ON config FOR SELECT TO app_user USING (true);

-- Public: approved, listed professionals who kept the default visibility.
CREATE POLICY profiles_public_read ON profiles FOR SELECT TO app_user USING (
  kind = 'professional'
  AND approval_state = 'approved'
  AND visibility = 'public'
  AND admin_hidden_at IS NULL
  AND anonymized_at IS NULL
  AND profile_in_directory(id)
);

-- Members: the same rule, plus members-only professionals.
CREATE POLICY profiles_member_read ON profiles FOR SELECT TO app_user USING (
  kind = 'professional'
  AND approval_state = 'approved'
  AND visibility IN ('public', 'members')
  AND admin_hidden_at IS NULL
  AND anonymized_at IS NULL
  AND profile_in_directory(id)
  AND is_member()
);

CREATE POLICY profiles_owner_read ON profiles FOR SELECT TO app_user USING (id = app_uid());
CREATE POLICY profiles_admin_read ON profiles FOR SELECT TO app_user USING (is_admin());

-- Owner and admin updates; the guard trigger keeps the protected columns out of reach.
CREATE POLICY profiles_owner_update ON profiles FOR UPDATE TO app_user
  USING (id = app_uid()) WITH CHECK (id = app_uid());
CREATE POLICY profiles_admin_update ON profiles FOR UPDATE TO app_user
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY admin_roles_admin_read ON admin_roles FOR SELECT TO app_user USING (is_admin());
CREATE POLICY admin_roles_owner_read ON admin_roles FOR SELECT TO app_user USING (profile_id = app_uid());

CREATE POLICY audit_log_admin_read ON audit_log FOR SELECT TO app_user USING (is_admin());

CREATE POLICY account_deletions_owner_read ON account_deletions FOR SELECT TO app_user USING (profile_id = app_uid());
CREATE POLICY account_deletions_admin_read ON account_deletions FOR SELECT TO app_user USING (is_admin());
