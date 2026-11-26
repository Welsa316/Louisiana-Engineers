-- Profiles in full: professional and student details, education, the
-- vocabularies and expertise tags, mentorship settings and topics, contact
-- preferences, saved profiles and the approval queue, the directory and
-- dashboard views, and the functions that write them
-- (02-technical-architecture.md sections 4.2 to 4.5, 5.3 and 5.4).
--
-- Every length here is a number from shared/limits.ts. Reads follow the
-- parent profile: a detail row's policy asks whether the caller can read the
-- profile row (through the profiles policies), so the hybrid visibility rule
-- lives in one place. Contact values never leave through a table or view;
-- release_contact is the only path.

-- Enumerated types (section 4.2) ---------------------------------------------

CREATE TYPE mentor_status AS ENUM ('off', 'active', 'paused');
CREATE TYPE contact_method AS ENUM ('mest', 'email', 'linkedin', 'booking', 'phone');
CREATE TYPE participation AS ENUM ('directory', 'networking', 'mentoring', 'volunteering', 'speaking', 'collaborating');
CREATE TYPE audience AS ENUM ('high-school', 'undergrad', 'grad', 'early-career', 'mid-career');
CREATE TYPE mentoring_format AS ENUM ('one-time', 'recurring', 'either');
CREATE TYPE meeting_mode AS ENUM ('online', 'in-person', 'either');
CREATE TYPE discipline_group AS ENUM ('Engineering', 'Science', 'Technology');
CREATE TYPE verified_method AS ENUM ('work_email', 'linkedin', 'personal_knowledge');
CREATE TYPE tag_status AS ENUM ('approved', 'proposed', 'rejected');
CREATE TYPE review_decision AS ENUM ('approved', 'declined');

-- Check helpers ---------------------------------------------------------------

-- Every item of a text array has a character count in [low, high].
CREATE FUNCTION text_items_between(items text[], low int, high int) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM unnest(items) AS i WHERE i IS NULL OR char_length(i) NOT BETWEEN low AND high
  )
$$;

-- The value is a slug: lowercase letters, digits, single hyphens.
CREATE FUNCTION is_slug(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT value ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(value) BETWEEN 1 AND 60
$$;

-- Vocabularies ------------------------------------------------------------------

CREATE TABLE disciplines (
  id text PRIMARY KEY CHECK (is_slug(id)),
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
  -- Null for a discipline an administrator added without a group.
  group_name discipline_group,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE mentorship_topics (
  id text PRIMARY KEY CHECK (is_slug(id)),
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

-- Copied from shared/taxonomy.ts; server/test/policies/details.test.ts fails
-- if the two drift.
INSERT INTO disciplines (id, label, group_name, sort_order) VALUES
  ('civil', 'Civil & structural', 'Engineering', 1),
  ('coastal', 'Coastal & environmental', 'Engineering', 2),
  ('chemical', 'Chemical & process', 'Engineering', 3),
  ('mechanical', 'Mechanical', 'Engineering', 4),
  ('electrical', 'Electrical & power', 'Engineering', 5),
  ('biomedical', 'Biomedical', 'Engineering', 6),
  ('petroleum', 'Petroleum & energy', 'Engineering', 7),
  ('biology', 'Biology & life sciences', 'Science', 8),
  ('public-health', 'Public health & biostatistics', 'Science', 9),
  ('chemistry', 'Chemistry & materials', 'Science', 10),
  ('physics', 'Physics & mathematics', 'Science', 11),
  ('software', 'Software engineering', 'Technology', 12),
  ('data', 'Data science & AI', 'Technology', 13),
  ('security', 'Cybersecurity', 'Technology', 14),
  ('product', 'Product & design', 'Technology', 15);

INSERT INTO mentorship_topics (id, label, sort_order) VALUES
  ('internships-and-first-jobs', 'Internships and first jobs', 1),
  ('graduate-school', 'Graduate school applications', 2),
  ('professional-licensure', 'Professional licensure (PE, FE)', 3),
  ('technical-interviews', 'Technical interviews', 4),
  ('resume-and-portfolio', 'Resume and portfolio review', 5),
  ('research-and-publishing', 'Research and publishing', 6),
  ('career-change-into-tech', 'Career change into tech', 7),
  ('leadership-and-management', 'Leadership and management', 8),
  ('starting-a-company', 'Starting a company', 9),
  ('negotiating-offers', 'Negotiating offers', 10),
  ('choosing-a-major', 'Choosing a major or specialization', 11),
  ('faith-and-professional-life', 'Faith and professional life', 12);

CREATE TABLE expertise_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 40 AND label = btrim(label)),
  slug text NOT NULL UNIQUE CHECK (is_slug(slug)),
  status tag_status NOT NULL DEFAULT 'proposed',
  proposed_by uuid REFERENCES profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expertise_tags_label_ci_idx ON expertise_tags (lower(label));
CREATE INDEX expertise_tags_status_idx ON expertise_tags (status);

-- professional_details ----------------------------------------------------------

CREATE TABLE professional_details (
  profile_id uuid PRIMARY KEY REFERENCES profiles (id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  organization text NOT NULL CHECK (char_length(organization) BETWEEN 1 AND 120),
  discipline_id text NOT NULL REFERENCES disciplines (id),
  years_experience int NOT NULL CHECK (years_experience BETWEEN 0 AND 60),
  participation participation[] NOT NULL DEFAULT '{}',
  interests text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(interests) <= 10 AND text_items_between(interests, 1, 40)),
  verified boolean NOT NULL DEFAULT false,
  verified_method verified_method,
  verified_at timestamptz,
  -- Title, organization and approved tag labels (weight A/B), bio (C);
  -- maintained by the triggers below. The names live in profiles.search_tsv.
  search_tsv tsvector NOT NULL DEFAULT ''::tsvector,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT professional_details_verified_consistent CHECK (
    (verified AND verified_method IS NOT NULL AND verified_at IS NOT NULL)
    OR (NOT verified AND verified_method IS NULL AND verified_at IS NULL)
  )
);
CREATE INDEX professional_details_search_idx ON professional_details USING gin (search_tsv);
CREATE INDEX professional_details_discipline_idx ON professional_details (discipline_id);

CREATE TRIGGER professional_details_set_updated_at BEFORE UPDATE ON professional_details
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- student_details -----------------------------------------------------------------

CREATE TABLE student_details (
  profile_id uuid PRIMARY KEY REFERENCES profiles (id),
  program text NOT NULL CHECK (char_length(program) BETWEEN 1 AND 120),
  level audience NOT NULL,
  institution text NOT NULL CHECK (char_length(institution) BETWEEN 1 AND 120),
  goals text NOT NULL CHECK (char_length(goals) BETWEEN 20 AND 600),
  interests text[] NOT NULL DEFAULT '{}'
    CHECK (cardinality(interests) <= 10 AND text_items_between(interests, 1, 40)),
  topics_needed text[] NOT NULL CHECK (cardinality(topics_needed) BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER student_details_set_updated_at BEFORE UPDATE ON student_details
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- education -----------------------------------------------------------------------

CREATE TABLE education (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles (id),
  degree text NOT NULL CHECK (char_length(degree) BETWEEN 1 AND 120),
  field text NOT NULL CHECK (char_length(field) BETWEEN 1 AND 120),
  school text NOT NULL CHECK (char_length(school) BETWEEN 1 AND 120),
  -- The upper bound (current year plus 8) moves, so a trigger checks it.
  year int NOT NULL CHECK (year >= 1950),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX education_profile_idx ON education (profile_id);

-- profile_expertise -----------------------------------------------------------------

CREATE TABLE profile_expertise (
  profile_id uuid NOT NULL REFERENCES profiles (id),
  tag_id uuid NOT NULL REFERENCES expertise_tags (id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, tag_id)
);
CREATE INDEX profile_expertise_tag_idx ON profile_expertise (tag_id);

-- mentorship_settings and mentor_topics ---------------------------------------------

CREATE TABLE mentorship_settings (
  profile_id uuid PRIMARY KEY REFERENCES profiles (id),
  status mentor_status NOT NULL DEFAULT 'off',
  previous_status mentor_status,
  paused_until date,
  audience audience[] NOT NULL DEFAULT '{}',
  format mentoring_format NOT NULL DEFAULT 'either',
  mode meeting_mode NOT NULL DEFAULT 'either',
  availability text CHECK (char_length(availability) <= 160),
  duration_min int NOT NULL DEFAULT 45 CHECK (duration_min IN (30, 45, 60)),
  max_active int NOT NULL DEFAULT 3 CHECK (max_active BETWEEN 1 AND 10),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A resume date belongs to a paused offer, including one an administrator's
  -- hide turned off (it comes back paused until the same day).
  CONSTRAINT mentorship_settings_paused_until_only_when_paused CHECK (
    paused_until IS NULL OR status = 'paused' OR previous_status = 'paused'
  )
);
CREATE INDEX mentorship_settings_status_idx ON mentorship_settings (status);

CREATE TRIGGER mentorship_settings_set_updated_at BEFORE UPDATE ON mentorship_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE mentor_topics (
  profile_id uuid NOT NULL REFERENCES mentorship_settings (profile_id),
  topic_id text NOT NULL REFERENCES mentorship_topics (id),
  PRIMARY KEY (profile_id, topic_id)
);
CREATE INDEX mentor_topics_topic_idx ON mentor_topics (topic_id);

-- contact_preferences ---------------------------------------------------------------

CREATE TABLE contact_preferences (
  profile_id uuid PRIMARY KEY REFERENCES profiles (id),
  methods contact_method[] NOT NULL DEFAULT '{mest}',
  share_with_members contact_method[] NOT NULL DEFAULT '{}',
  contact_email citext CHECK (char_length(contact_email) <= 254 AND contact_email ~ '^[^@\s]+@[^@\s]+$'),
  phone text CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  booking_url text CHECK (char_length(booking_url) <= 300 AND booking_url ~* '^https://[^/\s]+'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_preferences_mest_always CHECK ('mest' = ANY (methods)),
  CONSTRAINT contact_preferences_share_subset CHECK (
    share_with_members <@ methods AND NOT ('mest' = ANY (share_with_members))
  ),
  -- A method is listed only with its value (linkedin's lives on profiles and
  -- is checked by complete_onboarding; release_contact skips a missing one).
  CONSTRAINT contact_preferences_phone_has_value CHECK (NOT ('phone' = ANY (methods)) OR phone IS NOT NULL),
  CONSTRAINT contact_preferences_booking_has_value CHECK (NOT ('booking' = ANY (methods)) OR booking_url IS NOT NULL)
);

CREATE TRIGGER contact_preferences_set_updated_at BEFORE UPDATE ON contact_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- saved_profiles --------------------------------------------------------------------

CREATE TABLE saved_profiles (
  saver_id uuid NOT NULL REFERENCES profiles (id),
  saved_id uuid NOT NULL REFERENCES profiles (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saver_id, saved_id),
  CHECK (saver_id <> saved_id)
);
CREATE INDEX saved_profiles_saved_idx ON saved_profiles (saved_id);

-- profile_reviews -------------------------------------------------------------------

CREATE TABLE profile_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles (id),
  reviewer_id uuid REFERENCES profiles (id),
  decision review_decision,
  notes text CHECK (char_length(notes) <= 1000),
  -- The profile as submitted, without contact values or the LinkedIn link.
  snapshot jsonb NOT NULL DEFAULT '{}',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT profile_reviews_decided_consistent CHECK ((decision IS NULL) = (decided_at IS NULL))
);
-- One open review per profile.
CREATE UNIQUE INDEX profile_reviews_one_open_idx ON profile_reviews (profile_id) WHERE decision IS NULL;
CREATE INDEX profile_reviews_open_submitted_idx ON profile_reviews (submitted_at) WHERE decision IS NULL;

-- The directory rule (replaces 0002's stub) --------------------------------------------

-- Whether a profile takes part in the directory at all: its professional
-- details list `directory`. SECURITY DEFINER so the profiles policies that
-- call it never recurse through professional_details' own policy.
CREATE OR REPLACE FUNCTION profile_in_directory(profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM professional_details d
     WHERE d.profile_id = $1 AND 'directory' = ANY (d.participation)
  )
$$;

-- Whether a mentor can take another mentee: mentoring is active and the
-- active relationships are below max_active. Requests and relationships
-- arrive in Task 19, which replaces this body to count them; until then an
-- active mentor has room. SECURITY DEFINER because max_active is the
-- owner's alone; this boolean is what everyone else gets.
CREATE FUNCTION mentor_has_capacity(profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM mentorship_settings s
     WHERE s.profile_id = $1 AND s.status = 'active' AND s.max_active > 0
  )
$$;

-- Triggers ----------------------------------------------------------------------------

-- A professional's bio is required once they have details.
CREATE FUNCTION professional_details_require_bio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = NEW.profile_id AND p.bio IS NOT NULL) THEN
    RAISE EXCEPTION 'mest.bio_required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER professional_details_0_require_bio BEFORE INSERT ON professional_details
  FOR EACH ROW EXECUTE FUNCTION professional_details_require_bio();

CREATE FUNCTION profiles_keep_professional_bio() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.bio IS NULL AND NEW.kind = 'professional'
     AND EXISTS (SELECT 1 FROM professional_details d WHERE d.profile_id = NEW.id) THEN
    RAISE EXCEPTION 'mest.bio_required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER profiles_keep_professional_bio BEFORE UPDATE OF bio, kind ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_keep_professional_bio();

-- The verification columns move only through admin_set_verified (and the
-- affiliation rule below); an owner or administrator acting directly
-- cannot set them. Runs first (trigger names fire in order).
CREATE FUNCTION professional_details_guard_protected_columns() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF acting_as_table_owner(TG_RELID) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.verified OR NEW.verified_method IS NOT NULL OR NEW.verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'mest.protected_field' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.verified IS DISTINCT FROM OLD.verified
     OR NEW.verified_method IS DISTINCT FROM OLD.verified_method
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'mest.protected_field'
      USING ERRCODE = '42501', DETAIL = 'verified, verified_method and verified_at change only through admin_set_verified';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER professional_details_1_guard BEFORE INSERT OR UPDATE ON professional_details
  FOR EACH ROW EXECUTE FUNCTION professional_details_guard_protected_columns();

-- A verified affiliation is a claim about a title at an organization: when
-- either changes on a verified row, verification lapses and the change is
-- audited (actor: the member). A writer that means to keep the verification
-- while changing the affiliation (only the seed does) sets verified_at too.
-- SECURITY DEFINER so it can write the audit entry.
CREATE FUNCTION professional_details_affiliation_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  detail jsonb := '{}';
BEGIN
  IF OLD.verified AND NEW.verified
     AND NEW.verified_at IS NOT DISTINCT FROM OLD.verified_at
     AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.organization IS DISTINCT FROM OLD.organization) THEN
    IF NEW.title IS DISTINCT FROM OLD.title THEN
      detail := detail || jsonb_build_object('title', jsonb_build_object('from', OLD.title, 'to', NEW.title));
    END IF;
    IF NEW.organization IS DISTINCT FROM OLD.organization THEN
      detail := detail || jsonb_build_object('organization', jsonb_build_object('from', OLD.organization, 'to', NEW.organization));
    END IF;
    NEW.verified := false;
    NEW.verified_method := NULL;
    NEW.verified_at := NULL;
    PERFORM write_audit('profile.affiliation_changed', 'profile', NEW.profile_id, detail);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER professional_details_2_affiliation BEFORE UPDATE ON professional_details
  FOR EACH ROW EXECUTE FUNCTION professional_details_affiliation_changed();

-- The search document for one professional: title and approved tags (A),
-- organization (B), bio (C). English stemming; the names are in
-- profiles.search_tsv ('simple'), and the directory view concatenates both.
CREATE FUNCTION professional_search_document(profile_id uuid, title text, organization text) RETURNS tsvector
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
      || setweight(to_tsvector('english'::regconfig, coalesce((
           SELECT string_agg(t.label, ' ' ORDER BY t.label)
             FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id
            WHERE pe.profile_id = $1 AND t.status = 'approved'
         ), '')), 'A')
      || setweight(to_tsvector('english'::regconfig, coalesce(organization, '')), 'B')
      || setweight(to_tsvector('english'::regconfig, coalesce((SELECT p.bio FROM profiles p WHERE p.id = $1), '')), 'C')
$$;

CREATE FUNCTION professional_details_set_search() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.search_tsv := professional_search_document(NEW.profile_id, NEW.title, NEW.organization);
  RETURN NEW;
END
$$;

CREATE TRIGGER professional_details_3_search BEFORE INSERT OR UPDATE OF title, organization, profile_id ON professional_details
  FOR EACH ROW EXECUTE FUNCTION professional_details_set_search();

-- Recomputes the stored document for some profiles (after a bio, a tag link
-- or a tag's status changes). Internal: definer triggers call it.
CREATE FUNCTION refresh_professional_search(profile_ids uuid[]) RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE professional_details d
     SET search_tsv = professional_search_document(d.profile_id, d.title, d.organization)
   WHERE d.profile_id = ANY ($1)
$$;

CREATE FUNCTION profiles_refresh_search() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.bio IS DISTINCT FROM OLD.bio THEN
    PERFORM refresh_professional_search(ARRAY[NEW.id]);
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER profiles_refresh_search AFTER UPDATE OF bio ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_refresh_search();

CREATE FUNCTION profile_expertise_refresh_search() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_professional_search(ARRAY(SELECT DISTINCT o.profile_id FROM old_rows o));
  ELSE
    PERFORM refresh_professional_search(ARRAY(SELECT DISTINCT n.profile_id FROM new_rows n));
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER profile_expertise_refresh_search_insert AFTER INSERT ON profile_expertise
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_expertise_refresh_search();
CREATE TRIGGER profile_expertise_refresh_search_delete AFTER DELETE ON profile_expertise
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION profile_expertise_refresh_search();

CREATE FUNCTION expertise_tags_refresh_search() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.label IS DISTINCT FROM OLD.label THEN
    PERFORM refresh_professional_search(ARRAY(SELECT pe.profile_id FROM profile_expertise pe WHERE pe.tag_id = NEW.id));
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER expertise_tags_refresh_search AFTER UPDATE OF status, label ON expertise_tags
  FOR EACH ROW EXECUTE FUNCTION expertise_tags_refresh_search();

-- Dropping `mentoring` from participation ends the offer: an active or
-- paused mentor who no longer mentors is `off` (set_mentorship_status
-- refuses `active` without it, so the two rules agree).
CREATE FUNCTION professional_details_mentoring_dropped() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF 'mentoring' = ANY (OLD.participation) AND NOT ('mentoring' = ANY (NEW.participation)) THEN
    UPDATE mentorship_settings s
       SET status = 'off', paused_until = NULL
     WHERE s.profile_id = NEW.profile_id AND s.status <> 'off';
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER professional_details_mentoring_dropped AFTER UPDATE OF participation ON professional_details
  FOR EACH ROW EXECUTE FUNCTION professional_details_mentoring_dropped();

-- Mentorship settings exist only for professionals.
CREATE FUNCTION mentorship_settings_professionals_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = NEW.profile_id AND p.kind = 'professional') THEN
    RAISE EXCEPTION 'mest.not_professional' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER mentorship_settings_professionals_only BEFORE INSERT ON mentorship_settings
  FOR EACH ROW EXECUTE FUNCTION mentorship_settings_professionals_only();

-- Status, previous status and the resume date move only through
-- set_mentorship_status and the administrator, job and deletion functions.
CREATE FUNCTION mentorship_settings_guard_protected_columns() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF acting_as_table_owner(TG_RELID) THEN
    RETURN NEW;
  END IF;
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.previous_status IS DISTINCT FROM OLD.previous_status
     OR NEW.paused_until IS DISTINCT FROM OLD.paused_until THEN
    RAISE EXCEPTION 'mest.protected_field'
      USING ERRCODE = '42501', DETAIL = 'status changes only through set_mentorship_status';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER mentorship_settings_guard BEFORE UPDATE ON mentorship_settings
  FOR EACH ROW EXECUTE FUNCTION mentorship_settings_guard_protected_columns();

-- Row-count limits: 6 education rows and 12 expertise tags per profile.
CREATE FUNCTION education_limits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.year > extract(year FROM now())::int + 8 THEN
    RAISE EXCEPTION 'mest.invalid_education' USING ERRCODE = '23514', DETAIL = 'year is at most 8 years ahead';
  END IF;
  IF TG_OP = 'INSERT' AND (SELECT count(*) FROM education e WHERE e.profile_id = NEW.profile_id) >= 6 THEN
    RAISE EXCEPTION 'mest.invalid_education' USING ERRCODE = '23514', DETAIL = 'at most 6 education entries';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER education_limits BEFORE INSERT OR UPDATE ON education
  FOR EACH ROW EXECUTE FUNCTION education_limits();

CREATE FUNCTION profile_expertise_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (SELECT count(*) FROM profile_expertise pe WHERE pe.profile_id = NEW.profile_id) >= 12 THEN
    RAISE EXCEPTION 'mest.invalid_expertise' USING ERRCODE = '23514', DETAIL = 'at most 12 expertise tags';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER profile_expertise_limit BEFORE INSERT ON profile_expertise
  FOR EACH ROW EXECUTE FUNCTION profile_expertise_limit();

-- Topic ids a student asks about must exist.
CREATE FUNCTION student_details_check_topics() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.topics_needed) AS t(id)
     WHERE NOT EXISTS (SELECT 1 FROM mentorship_topics m WHERE m.id = t.id)
  ) OR (SELECT count(DISTINCT t) FROM unnest(NEW.topics_needed) AS t) <> cardinality(NEW.topics_needed) THEN
    RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '23514', DETAIL = 'unknown or repeated topic';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER student_details_check_topics BEFORE INSERT OR UPDATE OF topics_needed ON student_details
  FOR EACH ROW EXECUTE FUNCTION student_details_check_topics();

-- Internal helpers (definer functions call these; app_user cannot) -------------------

-- Sends one notification to every active administrator.
CREATE FUNCTION notify_admins(
  category notification_category, title text, body text, link text, template text, payload jsonb, email boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  admin_id uuid;
BEGIN
  FOR admin_id IN
    SELECT a.profile_id
      FROM admin_roles a JOIN users u ON u.id = a.profile_id
     WHERE a.revoked_at IS NULL AND u.suspended_at IS NULL AND u.deleted_at IS NULL
     ORDER BY a.profile_id
  LOOP
    PERFORM create_notification(admin_id, category, title, body, link, template, payload, email);
  END LOOP;
END
$$;

-- A slug for a tag label, unique among existing tags.
CREATE FUNCTION expertise_tag_slug(label text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  base text := left(btrim(regexp_replace(lower(label), '[^a-z0-9]+', '-', 'g'), '-'), 50);
  candidate text;
  n int := 1;
BEGIN
  IF base = '' THEN
    base := 'tag';
  END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM expertise_tags t WHERE t.slug = candidate) LOOP
    n := n + 1;
    candidate := base || '-' || n;
  END LOOP;
  RETURN candidate;
END
$$;

-- Replaces a profile's expertise with these labels (2 to 12 after removing
-- case-insensitive repeats, each 2 to 40 characters). A known label links
-- the existing tag; an unknown one becomes a `proposed` tag by `proposer`; a
-- rejected label is refused.
CREATE FUNCTION replace_profile_expertise(profile uuid, labels text[], proposer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  clean text[];
  item text;
  tag expertise_tags%ROWTYPE;
BEGIN
  SELECT coalesce(array_agg(l ORDER BY first_seen), '{}') INTO clean
    FROM (
      SELECT DISTINCT ON (lower(btrim(x))) btrim(x) AS l, o AS first_seen
        FROM unnest(coalesce(labels, '{}')) WITH ORDINALITY AS u(x, o)
       WHERE btrim(x) <> ''
       ORDER BY lower(btrim(x)), o
    ) d;
  IF cardinality(clean) NOT BETWEEN 2 AND 12 OR NOT text_items_between(clean, 2, 40) THEN
    RAISE EXCEPTION 'mest.invalid_expertise' USING ERRCODE = '23514', DETAIL = '2 to 12 tags of 2 to 40 characters';
  END IF;

  DELETE FROM profile_expertise pe WHERE pe.profile_id = profile;
  FOREACH item IN ARRAY clean LOOP
    SELECT * INTO tag FROM expertise_tags t WHERE lower(t.label) = lower(item);
    IF NOT FOUND THEN
      INSERT INTO expertise_tags (label, slug, status, proposed_by)
      VALUES (item, expertise_tag_slug(item), 'proposed', proposer)
      ON CONFLICT ((lower(label))) DO NOTHING;
      SELECT * INTO tag FROM expertise_tags t WHERE lower(t.label) = lower(item);
    END IF;
    IF tag.status = 'rejected' THEN
      RAISE EXCEPTION 'mest.tag_rejected' USING ERRCODE = '23514', DETAIL = item;
    END IF;
    INSERT INTO profile_expertise (profile_id, tag_id) VALUES (profile, tag.id) ON CONFLICT DO NOTHING;
  END LOOP;
END
$$;

-- What an administrator reviews: the profile as it stands, without contact
-- values, the LinkedIn link or anything from contact_preferences.
CREATE FUNCTION profile_snapshot(profile uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'kind', p.kind,
    'firstName', p.first_name,
    'lastName', p.last_name,
    'credentials', p.credentials,
    'location', p.location,
    'region', p.region,
    'bio', p.bio,
    'websiteUrl', p.website_url,
    'visibility', p.visibility,
    'title', d.title,
    'organization', d.organization,
    'disciplineId', d.discipline_id,
    'yearsExperience', d.years_experience,
    'participation', to_jsonb(d.participation),
    'interests', to_jsonb(d.interests),
    'expertise', (
      SELECT jsonb_agg(t.label ORDER BY t.label)
        FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id
       WHERE pe.profile_id = p.id
    ),
    'education', (
      SELECT jsonb_agg(jsonb_build_object('degree', e.degree, 'field', e.field, 'school', e.school, 'year', e.year)
                       ORDER BY e.year DESC, e.degree)
        FROM education e WHERE e.profile_id = p.id
    ),
    'mentorship', (
      SELECT jsonb_build_object(
               'status', s.status,
               'audience', to_jsonb(s.audience),
               'format', s.format,
               'mode', s.mode,
               'availability', s.availability,
               'durationMin', s.duration_min,
               'maxActive', s.max_active,
               'topics', (SELECT jsonb_agg(mt.topic_id ORDER BY mt.topic_id) FROM mentor_topics mt WHERE mt.profile_id = s.profile_id)
             )
        FROM mentorship_settings s WHERE s.profile_id = p.id
    )
  ))
    FROM profiles p
    LEFT JOIN professional_details d ON d.profile_id = p.id
   WHERE p.id = profile
$$;

-- Opens a review for a professional and, when the queue was empty, tells
-- the administrators. Internal.
CREATE FUNCTION open_profile_review(profile uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  queue_was_empty boolean;
  new_id uuid;
BEGIN
  -- Serialize submissions so two at once cannot both find the queue empty.
  PERFORM pg_advisory_xact_lock(hashtext('profile_reviews.queue'));
  SELECT NOT EXISTS (SELECT 1 FROM profile_reviews r WHERE r.decision IS NULL) INTO queue_was_empty;
  SELECT r.id INTO new_id FROM profile_reviews r WHERE r.profile_id = profile AND r.decision IS NULL;
  IF new_id IS NULL THEN
    INSERT INTO profile_reviews (profile_id, snapshot) VALUES (profile, profile_snapshot(profile))
    RETURNING id INTO new_id;
  ELSE
    UPDATE profile_reviews r SET snapshot = profile_snapshot(profile), submitted_at = now() WHERE r.id = new_id;
  END IF;
  IF queue_was_empty THEN
    PERFORM notify_admins(
      'profile',
      'A profile is waiting for review',
      'A new professional profile was submitted to the directory.',
      '/network/admin/queue',
      'profile-submitted',
      '{}'::jsonb,
      true
    );
  END IF;
  RETURN new_id;
END
$$;

-- jsonb array of strings to text[] (null for a missing key).
CREATE FUNCTION jsonb_text_array(value jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN value IS NULL OR jsonb_typeof(value) = 'null' THEN NULL
    WHEN jsonb_typeof(value) <> 'array' THEN NULL
    ELSE ARRAY(SELECT jsonb_array_elements_text(value))
  END
$$;

-- An optional text field: trimmed, empty means null.
CREATE FUNCTION jsonb_optional_text(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN value IS NULL OR jsonb_typeof(value) <> 'string' THEN NULL ELSE nullif(btrim(value #>> '{}'), '') END
$$;

-- Owner functions (section 4.5) ----------------------------------------------------------

-- Writes a member's whole profile from the onboarding payload (the zod
-- output of shared/schemas/onboarding.ts, camelCase) in one transaction.
-- Allowed once, or again after a decline (a resubmission opens a new review).
CREATE FUNCTION complete_onboarding(payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  existing profiles%ROWTYPE;
  k text := payload ->> 'kind';
  participation_list participation[];
  mentoring boolean;
  offer jsonb := payload -> 'mentorship';
  contact jsonb := coalesce(payload -> 'contact', '{}'::jsonb);
  methods_list contact_method[];
  share_list contact_method[];
  linkedin text := jsonb_optional_text(payload -> 'linkedinUrl');
  topics text[];
  default_max int;
  item jsonb;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO existing FROM profiles p WHERE p.id = me FOR UPDATE;
  IF existing.kind IS NOT NULL AND existing.approval_state <> 'declined' THEN
    RAISE EXCEPTION 'mest.already_onboarded' USING ERRCODE = '23514';
  END IF;
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' OR k IS NULL OR k NOT IN ('student', 'professional') THEN
    RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '22023', DETAIL = 'kind is student or professional';
  END IF;
  IF existing.kind IS NOT NULL AND existing.kind::text <> k THEN
    RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '22023', DETAIL = 'use set_kind to change kind';
  END IF;
  IF (payload -> 'acceptMission') IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'mest.mission_required' USING ERRCODE = '23514';
  END IF;
  IF jsonb_optional_text(payload -> 'firstName') IS NULL OR jsonb_optional_text(payload -> 'lastName') IS NULL
     OR jsonb_optional_text(payload -> 'location') IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '23514', DETAIL = 'name and location are required';
  END IF;

  IF k = 'professional' THEN
    IF jsonb_optional_text(payload -> 'bio') IS NULL THEN
      RAISE EXCEPTION 'mest.bio_required' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM disciplines d WHERE d.id = payload ->> 'disciplineId' AND d.active) THEN
      RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '23514', DETAIL = 'unknown discipline';
    END IF;
    participation_list := coalesce(jsonb_text_array(payload -> 'participation'), '{}')::participation[];
    mentoring := 'mentoring' = ANY (participation_list);
    IF mentoring <> (offer IS NOT NULL AND jsonb_typeof(offer) = 'object') THEN
      RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '23514',
        DETAIL = 'the mentorship offer comes exactly with mentoring participation';
    END IF;
    methods_list := ARRAY(SELECT DISTINCT m FROM unnest(coalesce(jsonb_text_array(contact -> 'methods'), '{mest}')::contact_method[]) AS m ORDER BY m);
    share_list := ARRAY(SELECT DISTINCT m FROM unnest(coalesce(jsonb_text_array(contact -> 'shareWithMembers'), '{}')::contact_method[]) AS m ORDER BY m);
    IF NOT ('mest' = ANY (methods_list)) OR 'mest' = ANY (share_list) OR NOT (share_list <@ methods_list)
       OR ('linkedin' = ANY (methods_list) AND linkedin IS NULL)
       OR ('phone' = ANY (methods_list) AND jsonb_optional_text(contact -> 'phone') IS NULL)
       OR ('booking' = ANY (methods_list) AND jsonb_optional_text(contact -> 'bookingUrl') IS NULL) THEN
      RAISE EXCEPTION 'mest.invalid_contact' USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE profiles p SET
    first_name = btrim(payload ->> 'firstName'),
    last_name = btrim(payload ->> 'lastName'),
    credentials = jsonb_optional_text(payload -> 'credentials'),
    location = btrim(payload ->> 'location'),
    region = coalesce(jsonb_optional_text(payload -> 'region'), p.region),
    bio = jsonb_optional_text(payload -> 'bio'),
    linkedin_url = linkedin,
    website_url = jsonb_optional_text(payload -> 'websiteUrl'),
    kind = k::profile_kind,
    visibility = CASE WHEN k = 'student' THEN 'hidden'::visibility
                      ELSE coalesce(payload ->> 'visibility', 'public')::visibility END,
    approval_state = CASE WHEN k = 'student' THEN 'approved'::approval_state ELSE 'pending'::approval_state END,
    mission_accepted_at = coalesce(p.mission_accepted_at, now())
  WHERE p.id = me;

  INSERT INTO notification_preferences (profile_id) VALUES (me) ON CONFLICT (profile_id) DO NOTHING;

  IF k = 'student' THEN
    topics := jsonb_text_array(payload -> 'topicsNeeded');
    INSERT INTO student_details (profile_id, program, level, institution, goals, interests, topics_needed)
    VALUES (
      me,
      btrim(payload ->> 'program'),
      (payload ->> 'level')::audience,
      btrim(payload ->> 'institution'),
      btrim(payload ->> 'goals'),
      coalesce(jsonb_text_array(payload -> 'interests'), '{}'),
      coalesce(topics, '{}')
    )
    ON CONFLICT (profile_id) DO UPDATE SET
      program = EXCLUDED.program, level = EXCLUDED.level, institution = EXCLUDED.institution,
      goals = EXCLUDED.goals, interests = EXCLUDED.interests, topics_needed = EXCLUDED.topics_needed;
    PERFORM write_audit('profile.submitted', 'profile', me, jsonb_build_object('kind', k));
    RETURN;
  END IF;

  -- Professional
  INSERT INTO professional_details (profile_id, title, organization, discipline_id, years_experience, participation, interests)
  VALUES (
    me,
    btrim(payload ->> 'title'),
    btrim(payload ->> 'organization'),
    payload ->> 'disciplineId',
    (payload ->> 'yearsExperience')::int,
    participation_list,
    coalesce(jsonb_text_array(payload -> 'interests'), '{}')
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    title = EXCLUDED.title, organization = EXCLUDED.organization, discipline_id = EXCLUDED.discipline_id,
    years_experience = EXCLUDED.years_experience, participation = EXCLUDED.participation, interests = EXCLUDED.interests;

  DELETE FROM education e WHERE e.profile_id = me;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(payload -> 'education', '[]'::jsonb)) LOOP
    INSERT INTO education (profile_id, degree, field, school, year)
    VALUES (me, btrim(item ->> 'degree'), btrim(item ->> 'field'), btrim(item ->> 'school'), (item ->> 'year')::int);
  END LOOP;

  PERFORM replace_profile_expertise(me, jsonb_text_array(payload -> 'expertise'), me);

  SELECT c.value::int INTO default_max FROM config c WHERE c.key = 'default_max_active';
  INSERT INTO mentorship_settings (profile_id, max_active) VALUES (me, coalesce(default_max, 3))
  ON CONFLICT (profile_id) DO NOTHING;
  DELETE FROM mentor_topics mt WHERE mt.profile_id = me;
  IF mentoring THEN
    topics := coalesce(jsonb_text_array(offer -> 'topics'), '{}');
    IF cardinality(topics) = 0 OR EXISTS (
      SELECT 1 FROM unnest(topics) AS t(id)
       WHERE NOT EXISTS (SELECT 1 FROM mentorship_topics m WHERE m.id = t.id AND m.active)
    ) THEN
      RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '23514', DETAIL = 'unknown mentorship topic';
    END IF;
    IF cardinality(coalesce(jsonb_text_array(offer -> 'audience'), '{}')) = 0 THEN
      RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '23514', DETAIL = 'choose an audience';
    END IF;
    UPDATE mentorship_settings s SET
      status = 'active',
      previous_status = NULL,
      paused_until = NULL,
      audience = ARRAY(SELECT DISTINCT a FROM unnest(jsonb_text_array(offer -> 'audience')::audience[]) AS a ORDER BY a),
      format = coalesce(offer ->> 'format', 'either')::mentoring_format,
      mode = coalesce(offer ->> 'mode', 'either')::meeting_mode,
      availability = jsonb_optional_text(offer -> 'availabilityText'),
      duration_min = coalesce((offer ->> 'durationMin')::int, 45),
      max_active = coalesce((offer ->> 'maxActive')::int, default_max, 3)
    WHERE s.profile_id = me;
    INSERT INTO mentor_topics (profile_id, topic_id) SELECT DISTINCT me, t FROM unnest(topics) AS t;
  ELSE
    UPDATE mentorship_settings s SET status = 'off', previous_status = NULL, paused_until = NULL WHERE s.profile_id = me;
  END IF;

  INSERT INTO contact_preferences (profile_id, methods, share_with_members, contact_email, phone, booking_url)
  VALUES (
    me, methods_list, share_list,
    jsonb_optional_text(contact -> 'contactEmail'),
    jsonb_optional_text(contact -> 'phone'),
    jsonb_optional_text(contact -> 'bookingUrl')
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    methods = EXCLUDED.methods, share_with_members = EXCLUDED.share_with_members,
    contact_email = EXCLUDED.contact_email, phone = EXCLUDED.phone, booking_url = EXCLUDED.booking_url;

  PERFORM write_audit('profile.submitted', 'profile', me, jsonb_build_object('kind', k));
  PERFORM open_profile_review(me);
END
$$;

-- Switches a member between student and professional. To professional:
-- pending, listed by default once approved, a mentorship row (off), and a
-- review opened. To student: approved, hidden, mentorship off, the open
-- review withdrawn. Saved profiles (and, from Task 19, open requests) stay.
CREATE FUNCTION set_kind(kind profile_kind) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  existing profiles%ROWTYPE;
  default_max int;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF set_kind.kind IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_kind' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO existing FROM profiles p WHERE p.id = me FOR UPDATE;
  IF existing.kind IS NULL THEN
    RAISE EXCEPTION 'mest.not_onboarded' USING ERRCODE = '23514';
  END IF;
  IF existing.kind = set_kind.kind THEN
    RETURN;
  END IF;

  IF set_kind.kind = 'professional' THEN
    UPDATE profiles p SET kind = 'professional', approval_state = 'pending', visibility = 'public' WHERE p.id = me;
    SELECT c.value::int INTO default_max FROM config c WHERE c.key = 'default_max_active';
    INSERT INTO mentorship_settings (profile_id, max_active) VALUES (me, coalesce(default_max, 3))
    ON CONFLICT (profile_id) DO NOTHING;
    PERFORM write_audit('profile.kind_changed', 'profile', me, jsonb_build_object('from', existing.kind, 'to', set_kind.kind));
    PERFORM open_profile_review(me);
  ELSE
    UPDATE mentorship_settings s SET status = 'off', previous_status = NULL, paused_until = NULL WHERE s.profile_id = me;
    DELETE FROM profile_reviews r WHERE r.profile_id = me AND r.decision IS NULL;
    UPDATE profiles p SET kind = 'student', approval_state = 'approved', visibility = 'hidden' WHERE p.id = me;
    PERFORM write_audit('profile.kind_changed', 'profile', me, jsonb_build_object('from', existing.kind, 'to', set_kind.kind));
  END IF;
END
$$;

-- The owner turns mentoring on, pauses it (until `resume_on`, if given) or
-- turns it off.
CREATE FUNCTION set_mentorship_status(status mentor_status, resume_on date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
  p profiles%ROWTYPE;
  settings mentorship_settings%ROWTYPE;
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF set_mentorship_status.status IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO p FROM profiles pr WHERE pr.id = me;
  SELECT * INTO settings FROM mentorship_settings s WHERE s.profile_id = me FOR UPDATE;
  IF p.kind IS DISTINCT FROM 'professional' OR settings.profile_id IS NULL THEN
    RAISE EXCEPTION 'mest.not_professional' USING ERRCODE = '23514';
  END IF;
  IF p.admin_hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'mest.profile_hidden' USING ERRCODE = '23514';
  END IF;

  IF set_mentorship_status.status = 'active' THEN
    IF NOT EXISTS (
      SELECT 1 FROM professional_details d WHERE d.profile_id = me AND 'mentoring' = ANY (d.participation)
    ) THEN
      RAISE EXCEPTION 'mest.mentoring_not_offered' USING ERRCODE = '23514';
    END IF;
    IF cardinality(settings.audience) = 0 OR NOT EXISTS (SELECT 1 FROM mentor_topics mt WHERE mt.profile_id = me) THEN
      RAISE EXCEPTION 'mest.mentorship_incomplete' USING ERRCODE = '23514', DETAIL = 'choose topics and an audience';
    END IF;
    UPDATE mentorship_settings s SET status = 'active', paused_until = NULL WHERE s.profile_id = me;
  ELSIF set_mentorship_status.status = 'paused' THEN
    IF NOT EXISTS (
      SELECT 1 FROM professional_details d WHERE d.profile_id = me AND 'mentoring' = ANY (d.participation)
    ) THEN
      RAISE EXCEPTION 'mest.mentoring_not_offered' USING ERRCODE = '23514';
    END IF;
    IF resume_on IS NOT NULL AND resume_on <= current_date THEN
      RAISE EXCEPTION 'mest.invalid_resume_date' USING ERRCODE = '22023';
    END IF;
    UPDATE mentorship_settings s SET status = 'paused', paused_until = resume_on WHERE s.profile_id = me;
  ELSE
    UPDATE mentorship_settings s SET status = 'off', paused_until = NULL WHERE s.profile_id = me;
  END IF;
END
$$;

-- The owner's own settings row, max_active included (app_user cannot read
-- that column directly).
CREATE FUNCTION my_mentorship_settings() RETURNS SETOF mentorship_settings
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.* FROM mentorship_settings s WHERE s.profile_id = app_uid() AND app_uid() IS NOT NULL
$$;

-- Replaces the caller's expertise tags (the profile patch uses this).
CREATE FUNCTION set_my_expertise(labels text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = me AND p.kind = 'professional') THEN
    RAISE EXCEPTION 'mest.not_professional' USING ERRCODE = '23514';
  END IF;
  PERFORM replace_profile_expertise(me, labels, me);
END
$$;

CREATE FUNCTION save_profile(id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  me uuid := app_uid();
BEGIN
  IF me IS NULL OR NOT is_member() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF save_profile.id IS NULL OR save_profile.id = me
     OR profile_access(save_profile.id) <> 'visible'
     OR NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = save_profile.id AND p.kind = 'professional') THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  INSERT INTO saved_profiles (saver_id, saved_id) VALUES (me, save_profile.id) ON CONFLICT DO NOTHING;
END
$$;

CREATE FUNCTION unsave_profile(id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF app_uid() IS NULL THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM saved_profiles s WHERE s.saver_id = app_uid() AND s.saved_id = unsave_profile.id;
END
$$;

-- The single path by which a contact value leaves the database for another
-- member. A member who can see the profile gets the methods it shares with
-- members (`share_with_members`), each resolved to its value; anyone else
-- gets nothing. Task 19 adds an accepted relationship's shared_methods.
-- One `contact.viewed` audit entry per caller and profile, naming the
-- methods, never the values.
CREATE FUNCTION release_contact(profile_id uuid) RETURNS TABLE (method contact_method, value text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  me uuid := app_uid();
  target uuid := release_contact.profile_id;
  released contact_method[];
BEGIN
  IF me IS NULL OR NOT is_member() OR target IS NULL OR profile_access(target) <> 'visible' THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT r.method, r.value
      FROM (
        SELECT m AS method,
               CASE m
                 WHEN 'email' THEN coalesce(c.contact_email::text, u.email::text)
                 WHEN 'linkedin' THEN p.linkedin_url
                 WHEN 'booking' THEN c.booking_url
                 WHEN 'phone' THEN c.phone
               END AS value
          FROM contact_preferences c
          JOIN profiles p ON p.id = c.profile_id
          JOIN users u ON u.id = c.profile_id AND u.deleted_at IS NULL
          CROSS JOIN LATERAL unnest(c.share_with_members) AS m
         WHERE c.profile_id = target AND m <> 'mest' AND m = ANY (c.methods)
      ) r
     WHERE r.value IS NOT NULL
     ORDER BY r.method;

  SELECT array_agg(m ORDER BY m) INTO released
    FROM (
      SELECT m
        FROM contact_preferences c
        JOIN profiles p ON p.id = c.profile_id
        JOIN users u ON u.id = c.profile_id AND u.deleted_at IS NULL
        CROSS JOIN LATERAL unnest(c.share_with_members) AS m
       WHERE c.profile_id = target AND m <> 'mest' AND m = ANY (c.methods)
         AND CASE m
               WHEN 'email' THEN coalesce(c.contact_email::text, u.email::text)
               WHEN 'linkedin' THEN p.linkedin_url
               WHEN 'booking' THEN c.booking_url
               WHEN 'phone' THEN c.phone
             END IS NOT NULL
    ) x;

  IF released IS NOT NULL AND me <> target THEN
    PERFORM pg_advisory_xact_lock(hashtext('contact.viewed:' || me::text || ':' || target::text));
    IF NOT EXISTS (
      SELECT 1 FROM audit_log a
       WHERE a.action = 'contact.viewed' AND a.actor_id = me AND a.subject_id = target
    ) THEN
      PERFORM write_audit('contact.viewed', 'profile', target, jsonb_build_object('methods', to_jsonb(released)));
    END IF;
  END IF;
END
$$;

-- Records activity at most once a day. True when it wrote.
CREATE FUNCTION touch_last_active() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  touched int;
BEGIN
  IF app_uid() IS NULL THEN
    RETURN false;
  END IF;
  UPDATE profiles p SET last_active_at = now()
   WHERE p.id = app_uid() AND (p.last_active_at IS NULL OR p.last_active_at < now() - interval '1 day');
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched > 0;
END
$$;

-- Administrator functions (section 4.5) ---------------------------------------------------

CREATE FUNCTION admin_review_profile(review_id uuid, decision review_decision, notes text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  review profile_reviews%ROWTYPE;
  first_name_value text;
  clean_notes text := nullif(btrim(coalesce(notes, '')), '');
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF admin_review_profile.decision IS NULL THEN
    RAISE EXCEPTION 'mest.invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO review FROM profile_reviews r WHERE r.id = review_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF review.decision IS NOT NULL THEN
    RAISE EXCEPTION 'mest.review_closed' USING ERRCODE = '23514';
  END IF;

  UPDATE profile_reviews r
     SET reviewer_id = app_uid(), decision = admin_review_profile.decision, notes = clean_notes, decided_at = now()
   WHERE r.id = review_id;
  UPDATE profiles p SET approval_state = admin_review_profile.decision::text::approval_state WHERE p.id = review.profile_id;
  SELECT p.first_name INTO first_name_value FROM profiles p WHERE p.id = review.profile_id;

  IF admin_review_profile.decision = 'approved' THEN
    PERFORM create_notification(
      review.profile_id, 'profile', 'Your profile is approved',
      'Your profile is now part of the MEST Network directory.',
      '/network/me', 'profile-approved', jsonb_build_object('firstName', first_name_value), true,
      'profile_review', review_id
    );
  ELSE
    PERFORM create_notification(
      review.profile_id, 'profile', 'Your profile needs changes',
      coalesce(clean_notes, 'An administrator asked for changes before your profile is listed.'),
      '/network/me', 'profile-declined', jsonb_build_object('firstName', first_name_value, 'notes', clean_notes), true,
      'profile_review', review_id
    );
  END IF;
  PERFORM write_audit(
    'profile.' || admin_review_profile.decision::text, 'profile', review.profile_id,
    jsonb_build_object('review_id', review_id, 'notes', clean_notes)
  );
END
$$;

CREATE FUNCTION admin_set_verified(profile_id uuid, method verified_method) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_set_verified.profile_id;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM professional_details d WHERE d.profile_id = target) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF method IS NULL THEN
    UPDATE professional_details d SET verified = false, verified_method = NULL, verified_at = NULL WHERE d.profile_id = target;
    PERFORM write_audit('profile.unverified', 'profile', target, '{}'::jsonb);
  ELSE
    UPDATE professional_details d SET verified = true, verified_method = method, verified_at = now() WHERE d.profile_id = target;
    PERFORM create_notification(
      target, 'profile', 'Your affiliation is verified',
      'An administrator verified your title and organization.',
      '/network/me', 'profile-verified', '{}'::jsonb, true, 'profile', target
    );
    PERFORM write_audit('profile.verified', 'profile', target, jsonb_build_object('method', method));
  END IF;
END
$$;

CREATE FUNCTION admin_hide_profile(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_hide_profile.profile_id;
  already timestamptz;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT p.admin_hidden_at INTO already FROM profiles p WHERE p.id = target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF already IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE profiles p SET admin_hidden_at = now() WHERE p.id = target;
  -- paused_until stays, so a paused offer comes back paused until the same day.
  UPDATE mentorship_settings s SET previous_status = s.status, status = 'off'
   WHERE s.profile_id = target;
  PERFORM write_audit('profile.hidden', 'profile', target, '{}'::jsonb);
END
$$;

CREATE FUNCTION admin_restore_profile(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_restore_profile.profile_id;
  hidden timestamptz;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT p.admin_hidden_at INTO hidden FROM profiles p WHERE p.id = target FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF hidden IS NULL THEN
    RETURN;
  END IF;
  UPDATE profiles p SET admin_hidden_at = NULL WHERE p.id = target;
  UPDATE mentorship_settings s
     SET status = coalesce(s.previous_status, s.status),
         paused_until = CASE WHEN coalesce(s.previous_status, s.status) = 'paused' THEN s.paused_until END,
         previous_status = NULL
   WHERE s.profile_id = target;
  PERFORM write_audit('profile.restored', 'profile', target, '{}'::jsonb);
END
$$;

CREATE FUNCTION admin_grant(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_grant.profile_id;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM users u JOIN profiles p ON p.id = u.id
     WHERE u.id = target AND u.email_verified_at IS NOT NULL AND u.suspended_at IS NULL
       AND u.deleted_at IS NULL AND p.anonymized_at IS NULL
  ) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  INSERT INTO admin_roles (profile_id, granted_by, granted_at) VALUES (target, app_uid(), now())
  ON CONFLICT ON CONSTRAINT admin_roles_pkey DO UPDATE
    SET granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at, revoked_at = NULL
    WHERE admin_roles.revoked_at IS NOT NULL;
  PERFORM write_audit('admin.granted', 'profile', target, '{}'::jsonb);
END
$$;

-- Refuses a revocation that would leave fewer than two active
-- administrators (A7). Locks every active role row first, so two
-- concurrent revocations cannot both see three.
CREATE FUNCTION admin_revoke(profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target uuid := admin_revoke.profile_id;
  active int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM admin_roles a WHERE a.revoked_at IS NULL ORDER BY a.profile_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM admin_roles a WHERE a.profile_id = target AND a.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO active FROM admin_roles a WHERE a.revoked_at IS NULL;
  IF active - 1 < 2 THEN
    RAISE EXCEPTION 'mest.admin_minimum' USING ERRCODE = '23514', DETAIL = 'at least two administrators stay';
  END IF;
  UPDATE admin_roles a SET revoked_at = now() WHERE a.profile_id = target;
  PERFORM write_audit('admin.revoked', 'profile', target, '{}'::jsonb);
END
$$;

CREATE FUNCTION admin_review_tag(tag_id uuid, decision tag_status) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tag expertise_tags%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF decision IS NULL OR decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'mest.invalid_decision' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO tag FROM expertise_tags t WHERE t.id = tag_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  UPDATE expertise_tags t SET status = decision WHERE t.id = tag_id;
  IF decision = 'rejected' THEN
    DELETE FROM profile_expertise pe WHERE pe.tag_id = admin_review_tag.tag_id;
  END IF;
  PERFORM write_audit('tag.' || decision::text, 'expertise_tag', tag_id, jsonb_build_object('label', tag.label));
END
$$;

-- Adds a discipline (with an optional group) or a mentorship topic.
CREATE FUNCTION admin_add_vocabulary(kind text, id text, label text, group_name discipline_group DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  clean_label text := btrim(coalesce(label, ''));
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF kind IS NULL OR kind NOT IN ('discipline', 'topic') OR id IS NULL OR NOT is_slug(id)
     OR char_length(clean_label) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'mest.invalid_vocabulary' USING ERRCODE = '22023';
  END IF;
  IF kind = 'discipline' THEN
    IF EXISTS (SELECT 1 FROM disciplines d WHERE d.id = admin_add_vocabulary.id) THEN
      RAISE EXCEPTION 'mest.duplicate' USING ERRCODE = '23505';
    END IF;
    INSERT INTO disciplines (id, label, group_name, sort_order)
    VALUES (admin_add_vocabulary.id, clean_label, admin_add_vocabulary.group_name,
            (SELECT coalesce(max(d.sort_order), 0) + 1 FROM disciplines d));
  ELSE
    IF EXISTS (SELECT 1 FROM mentorship_topics t WHERE t.id = admin_add_vocabulary.id) THEN
      RAISE EXCEPTION 'mest.duplicate' USING ERRCODE = '23505';
    END IF;
    INSERT INTO mentorship_topics (id, label, sort_order)
    VALUES (admin_add_vocabulary.id, clean_label, (SELECT coalesce(max(t.sort_order), 0) + 1 FROM mentorship_topics t));
  END IF;
  PERFORM write_audit('vocabulary.added', kind, NULL, jsonb_build_object('id', admin_add_vocabulary.id, 'label', clean_label));
END
$$;

-- The members list: names, kind, approval state, mentor status and the
-- sign-up address's domain, never the address. `q` matches names.
CREATE FUNCTION admin_list_members(page int, size int, q text)
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  kind profile_kind,
  approval_state approval_state,
  mentor_status mentor_status,
  email_domain text,
  joined_at timestamptz,
  total int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  page_size int := least(greatest(coalesce(size, 20), 1), 50);
  page_number int := greatest(coalesce(page, 1), 1);
  pattern text := CASE WHEN nullif(btrim(coalesce(q, '')), '') IS NULL THEN NULL
                       ELSE '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.first_name, p.last_name, p.kind, p.approval_state, s.status,
           split_part(u.email::text, '@', 2), u.created_at, (count(*) OVER ())::int
      FROM profiles p
      JOIN users u ON u.id = p.id
      LEFT JOIN mentorship_settings s ON s.profile_id = p.id
     WHERE p.anonymized_at IS NULL AND u.deleted_at IS NULL
       AND (pattern IS NULL OR p.first_name ILIKE pattern OR p.last_name ILIKE pattern
            OR (p.first_name || ' ' || p.last_name) ILIKE pattern)
     ORDER BY p.last_name NULLS LAST, p.first_name NULLS LAST, p.id
     LIMIT page_size OFFSET (page_number - 1) * page_size;
END
$$;

-- Views (section 4.4) ---------------------------------------------------------------------

-- Every profile the caller can read, with its public layers joined and no
-- contact column, LinkedIn link or max_active. Runs as the caller
-- (security_invoker), so each table's policies apply.
CREATE VIEW profile_entries WITH (security_invoker = on) AS
SELECT
  p.id,
  p.kind,
  p.approval_state,
  p.visibility,
  p.first_name,
  p.last_name,
  p.credentials,
  p.region,
  p.location,
  p.bio,
  p.website_url,
  p.admin_hidden_at IS NOT NULL AS admin_hidden,
  p.last_active_at,
  p.created_at,
  d.title,
  d.organization,
  d.discipline_id,
  disc.label AS discipline_label,
  disc.group_name AS discipline_group,
  d.years_experience,
  CASE
    WHEN d.years_experience IS NULL THEN NULL
    WHEN d.years_experience <= 2 THEN '0-2'
    WHEN d.years_experience <= 9 THEN '3-9'
    WHEN d.years_experience <= 19 THEN '10-19'
    ELSE '20+'
  END AS experience_band,
  -- Enum arrays as text[], which the pg driver parses into string arrays.
  coalesce(d.participation, '{}')::text[] AS participation,
  coalesce(d.interests, '{}') AS interests,
  coalesce(d.verified, false) AS verified,
  coalesce((
    SELECT array_agg(t.label ORDER BY t.label)
      FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id
     WHERE pe.profile_id = p.id AND t.status <> 'rejected'
  ), '{}') AS tags,
  coalesce((
    SELECT array_agg(t.slug ORDER BY t.label)
      FROM profile_expertise pe JOIN expertise_tags t ON t.id = pe.tag_id
     WHERE pe.profile_id = p.id AND t.status = 'approved'
  ), '{}') AS tag_slugs,
  s.status AS mentor_status,
  coalesce((
    SELECT array_agg(mt.topic_id ORDER BY topic.sort_order, mt.topic_id)
      FROM mentor_topics mt JOIN mentorship_topics topic ON topic.id = mt.topic_id
     WHERE mt.profile_id = p.id
  ), '{}') AS mentor_topics,
  coalesce(s.audience, '{}')::text[] AS audience,
  s.format,
  s.mode,
  s.availability,
  s.duration_min,
  s.paused_until,
  mentor_has_capacity(p.id) AS has_capacity,
  coalesce(p.search_tsv, ''::tsvector) || coalesce(d.search_tsv, ''::tsvector) AS search_tsv
FROM profiles p
LEFT JOIN professional_details d ON d.profile_id = p.id
LEFT JOIN disciplines disc ON disc.id = d.discipline_id
LEFT JOIN mentorship_settings s ON s.profile_id = p.id;

-- The directory: approved, listed professionals with public or members-only
-- visibility. The caller's policies then decide which of those they see (a
-- visitor gets the public ones, a member both), so an administrator's or an
-- owner's wider reach never leaks hidden or pending profiles into it.
CREATE VIEW directory_entries WITH (security_invoker = on) AS
SELECT e.*
  FROM profile_entries e
 WHERE e.kind = 'professional'
   AND e.approval_state = 'approved'
   AND e.visibility IN ('public', 'members')
   AND NOT e.admin_hidden
   AND 'directory' = ANY (e.participation);

-- Success measures as aggregate counts, for administrators only. Runs as
-- the view owner (all rows) and returns no row unless the caller is an
-- administrator. Tasks 24 and 25 append report and request measures.
CREATE VIEW admin_dashboard AS
SELECT
  (SELECT count(*) FROM profiles p
    WHERE p.kind = 'professional' AND p.approval_state = 'approved' AND p.anonymized_at IS NULL)::int AS approved_professionals,
  (SELECT count(*) FROM profiles p
    WHERE p.kind = 'professional' AND p.approval_state = 'pending' AND p.anonymized_at IS NULL)::int AS pending_professionals,
  (SELECT count(*) FROM profiles p WHERE p.kind = 'student' AND p.anonymized_at IS NULL)::int AS students,
  (SELECT count(*) FROM mentorship_settings s JOIN profiles p ON p.id = s.profile_id
    WHERE s.status = 'active' AND p.approval_state = 'approved' AND p.admin_hidden_at IS NULL
      AND p.anonymized_at IS NULL)::int AS active_mentors
WHERE is_admin();

-- Privileges (section 5.3) ----------------------------------------------------------------

-- Internal helpers: only definer functions and triggers call them.
REVOKE EXECUTE ON FUNCTION notify_admins(notification_category, text, text, text, text, jsonb, boolean) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION expertise_tag_slug(text) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION replace_profile_expertise(uuid, text[], uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION profile_snapshot(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION open_profile_review(uuid) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION refresh_professional_search(uuid[]) FROM PUBLIC, app_user;
REVOKE EXECUTE ON FUNCTION professional_search_document(uuid, text, text) FROM PUBLIC, app_user;

-- Vocabularies: read by everyone, written only by admin_add_vocabulary.
REVOKE ALL ON disciplines, mentorship_topics FROM app_user;
GRANT SELECT ON disciplines, mentorship_topics TO app_user;

-- Expertise tags: read by policy; a member proposes through the onboarding
-- and profile functions or a direct insert as `proposed`.
REVOKE ALL ON expertise_tags FROM app_user;
GRANT SELECT ON expertise_tags TO app_user;
GRANT INSERT (label, slug, proposed_by) ON expertise_tags TO app_user;

-- Professional details: the owner inserts and edits everything but the
-- verification and search columns.
REVOKE ALL ON professional_details FROM app_user;
GRANT SELECT ON professional_details TO app_user;
GRANT INSERT (profile_id, title, organization, discipline_id, years_experience, participation, interests)
  ON professional_details TO app_user;
GRANT UPDATE (title, organization, discipline_id, years_experience, participation, interests)
  ON professional_details TO app_user;

REVOKE ALL ON student_details FROM app_user;
GRANT SELECT ON student_details TO app_user;
GRANT INSERT (profile_id, program, level, institution, goals, interests, topics_needed) ON student_details TO app_user;
GRANT UPDATE (program, level, institution, goals, interests, topics_needed) ON student_details TO app_user;

REVOKE ALL ON education FROM app_user;
GRANT SELECT, DELETE ON education TO app_user;
GRANT INSERT (profile_id, degree, field, school, year) ON education TO app_user;
GRANT UPDATE (degree, field, school, year) ON education TO app_user;

REVOKE ALL ON profile_expertise FROM app_user;
GRANT SELECT, INSERT, DELETE ON profile_expertise TO app_user;

-- Mentorship settings: every column but max_active is readable where the
-- profile is (others get has_capacity from the views); the owner edits the
-- offer, never the status columns.
REVOKE ALL ON mentorship_settings FROM app_user;
GRANT SELECT (profile_id, status, previous_status, paused_until, audience, format, mode, availability, duration_min, updated_at)
  ON mentorship_settings TO app_user;
GRANT UPDATE (audience, format, mode, availability, duration_min, max_active) ON mentorship_settings TO app_user;

REVOKE ALL ON mentor_topics FROM app_user;
GRANT SELECT, INSERT, DELETE ON mentor_topics TO app_user;

-- Contact preferences: the owner's alone.
REVOKE ALL ON contact_preferences FROM app_user;
GRANT SELECT ON contact_preferences TO app_user;
GRANT INSERT (profile_id, methods, share_with_members, contact_email, phone, booking_url) ON contact_preferences TO app_user;
GRANT UPDATE (methods, share_with_members, contact_email, phone, booking_url) ON contact_preferences TO app_user;

-- Saved profiles: read by the saver; written through save_profile and unsave_profile.
REVOKE ALL ON saved_profiles FROM app_user;
GRANT SELECT ON saved_profiles TO app_user;

-- Reviews: written only by the functions; who reviewed stays with administrators' functions.
REVOKE ALL ON profile_reviews FROM app_user;
GRANT SELECT (id, profile_id, decision, notes, snapshot, submitted_at, decided_at) ON profile_reviews TO app_user;

-- Views are read-only for requests (the default privileges also granted writes).
REVOKE ALL ON profile_entries, directory_entries, admin_dashboard FROM app_user;
GRANT SELECT ON profile_entries, directory_entries, admin_dashboard TO app_user;

-- Row-level security ----------------------------------------------------------------------

ALTER TABLE disciplines ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentorship_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE expertise_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE professional_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE education ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_expertise ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentorship_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mentor_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY disciplines_read ON disciplines FOR SELECT TO app_user USING (true);
CREATE POLICY mentorship_topics_read ON mentorship_topics FOR SELECT TO app_user USING (true);

-- Approved tags for everyone; proposed and rejected ones for their proposer and administrators.
CREATE POLICY expertise_tags_approved_read ON expertise_tags FOR SELECT TO app_user USING (status = 'approved');
CREATE POLICY expertise_tags_proposer_read ON expertise_tags FOR SELECT TO app_user
  USING (status = 'proposed' AND proposed_by = app_uid());
CREATE POLICY expertise_tags_admin_read ON expertise_tags FOR SELECT TO app_user USING (is_admin());
CREATE POLICY expertise_tags_member_propose ON expertise_tags FOR INSERT TO app_user
  WITH CHECK (status = 'proposed' AND proposed_by = app_uid() AND is_member());

-- "Follows the parent profile": readable when the caller can read the
-- profile row through the profiles policies.
CREATE POLICY professional_details_read ON professional_details FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = professional_details.profile_id));
CREATE POLICY professional_details_owner_insert ON professional_details FOR INSERT TO app_user
  WITH CHECK (
    profile_id = app_uid() AND is_member()
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = app_uid() AND p.kind = 'professional')
  );
CREATE POLICY professional_details_owner_update ON professional_details FOR UPDATE TO app_user
  USING (profile_id = app_uid() AND is_member()) WITH CHECK (profile_id = app_uid() AND is_member());
CREATE POLICY professional_details_admin_update ON professional_details FOR UPDATE TO app_user
  USING (is_admin()) WITH CHECK (is_admin());

-- Students are never listed: their details are the owner's and the
-- administrators' (Task 19 adds the mentor of a request).
CREATE POLICY student_details_owner_read ON student_details FOR SELECT TO app_user USING (profile_id = app_uid());
CREATE POLICY student_details_admin_read ON student_details FOR SELECT TO app_user USING (is_admin());
CREATE POLICY student_details_owner_insert ON student_details FOR INSERT TO app_user
  WITH CHECK (
    profile_id = app_uid() AND is_member()
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = app_uid() AND p.kind = 'student')
  );
CREATE POLICY student_details_owner_update ON student_details FOR UPDATE TO app_user
  USING (profile_id = app_uid() AND is_member()) WITH CHECK (profile_id = app_uid() AND is_member());

CREATE POLICY education_read ON education FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = education.profile_id));
CREATE POLICY education_owner_insert ON education FOR INSERT TO app_user
  WITH CHECK (profile_id = app_uid() AND is_member());
CREATE POLICY education_owner_update ON education FOR UPDATE TO app_user
  USING (profile_id = app_uid() AND is_member()) WITH CHECK (profile_id = app_uid() AND is_member());
CREATE POLICY education_owner_delete ON education FOR DELETE TO app_user
  USING (profile_id = app_uid() AND is_member());

CREATE POLICY profile_expertise_read ON profile_expertise FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = profile_expertise.profile_id));
-- The owner links a tag they can see that is not rejected.
CREATE POLICY profile_expertise_owner_insert ON profile_expertise FOR INSERT TO app_user
  WITH CHECK (
    profile_id = app_uid() AND is_member()
    AND EXISTS (SELECT 1 FROM expertise_tags t WHERE t.id = profile_expertise.tag_id AND t.status <> 'rejected')
  );
CREATE POLICY profile_expertise_owner_delete ON profile_expertise FOR DELETE TO app_user
  USING (profile_id = app_uid() AND is_member());

CREATE POLICY mentorship_settings_read ON mentorship_settings FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = mentorship_settings.profile_id));
CREATE POLICY mentorship_settings_owner_update ON mentorship_settings FOR UPDATE TO app_user
  USING (profile_id = app_uid() AND is_member()) WITH CHECK (profile_id = app_uid() AND is_member());

CREATE POLICY mentor_topics_read ON mentor_topics FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = mentor_topics.profile_id));
CREATE POLICY mentor_topics_owner_insert ON mentor_topics FOR INSERT TO app_user
  WITH CHECK (
    profile_id = app_uid() AND is_member()
    AND EXISTS (SELECT 1 FROM mentorship_topics t WHERE t.id = mentor_topics.topic_id AND t.active)
  );
CREATE POLICY mentor_topics_owner_delete ON mentor_topics FOR DELETE TO app_user
  USING (profile_id = app_uid() AND is_member());

-- Nobody but the owner, ever: administrators included.
CREATE POLICY contact_preferences_owner_read ON contact_preferences FOR SELECT TO app_user
  USING (profile_id = app_uid());
CREATE POLICY contact_preferences_owner_insert ON contact_preferences FOR INSERT TO app_user
  WITH CHECK (profile_id = app_uid() AND is_member());
CREATE POLICY contact_preferences_owner_update ON contact_preferences FOR UPDATE TO app_user
  USING (profile_id = app_uid() AND is_member()) WITH CHECK (profile_id = app_uid() AND is_member());

-- The saver only: not the saved person, not administrators.
CREATE POLICY saved_profiles_saver_read ON saved_profiles FOR SELECT TO app_user USING (saver_id = app_uid());

CREATE POLICY profile_reviews_subject_read ON profile_reviews FOR SELECT TO app_user USING (profile_id = app_uid());
CREATE POLICY profile_reviews_admin_read ON profile_reviews FOR SELECT TO app_user USING (is_admin());
