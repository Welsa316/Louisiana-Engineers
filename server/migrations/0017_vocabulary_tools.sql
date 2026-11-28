-- Vocabulary tooling (07-build-plan-phases-2-4.md, Task 34): administrators
-- merge duplicate expertise tags, rename a discipline, topic or tag, and
-- retire a mentorship topic so it is no longer offered while the choices
-- members already made stay where they are.
--
-- A merged tag is retired, not deleted: it keeps its row as `rejected` with
-- `merged_into` naming the tag that replaced it, so a member who types the
-- old label is linked to the new tag, and the audit trail still resolves.
-- Merges are flattened (a tag merged into one that is merged later points
-- at the final tag), so `merged_into` is always one hop.

-- 1. Where a merged tag went ---------------------------------------------------

ALTER TABLE expertise_tags
  ADD COLUMN merged_into uuid REFERENCES expertise_tags (id),
  ADD CONSTRAINT expertise_tags_merged_is_retired
    CHECK (merged_into IS NULL OR (status = 'rejected' AND merged_into <> id));
CREATE INDEX expertise_tags_merged_into_idx ON expertise_tags (merged_into) WHERE merged_into IS NOT NULL;

-- A tag id, nothing personal; the vocabulary screen shows where a tag went.
GRANT SELECT (merged_into) ON expertise_tags TO app_user;

-- 2. admin_merge_tags ------------------------------------------------------------

-- Moves every profile's link from `from_tag` to `into_tag` (a profile that
-- had both keeps one), retires `from_tag` and re-points tags merged into it
-- earlier. The target must be another approved, unmerged tag. Returns the
-- number of profiles that carried the old tag. Both rows are locked in id
-- order, so two crossing merges cannot deadlock.
CREATE FUNCTION admin_merge_tags(from_tag uuid, into_tag uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  src expertise_tags%ROWTYPE;
  dst expertise_tags%ROWTYPE;
  holders uuid[];
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM expertise_tags t WHERE t.id IN (from_tag, into_tag) ORDER BY t.id FOR UPDATE;
  SELECT * INTO src FROM expertise_tags t WHERE t.id = from_tag;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO dst FROM expertise_tags t WHERE t.id = into_tag;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF src.id = dst.id OR src.merged_into IS NOT NULL OR dst.merged_into IS NOT NULL OR dst.status <> 'approved' THEN
    RAISE EXCEPTION 'mest.invalid_merge' USING ERRCODE = '23514',
      DETAIL = 'merge into another approved tag that has not been merged itself';
  END IF;

  SELECT coalesce(array_agg(pe.profile_id ORDER BY pe.profile_id), '{}') INTO holders
    FROM profile_expertise pe WHERE pe.tag_id = src.id;
  -- Delete first, so a profile at the tag limit has room for the new link.
  DELETE FROM profile_expertise pe WHERE pe.tag_id = src.id;
  INSERT INTO profile_expertise (profile_id, tag_id)
  SELECT h, dst.id FROM unnest(holders) AS h
  ON CONFLICT DO NOTHING;

  UPDATE expertise_tags t SET status = 'rejected', merged_into = dst.id WHERE t.id = src.id;
  UPDATE expertise_tags t SET merged_into = dst.id WHERE t.merged_into = src.id;

  PERFORM write_audit('tag.merged', 'expertise_tag', src.id, jsonb_build_object(
    'label', src.label, 'intoId', dst.id, 'intoLabel', dst.label, 'moved', cardinality(holders)
  ));
  RETURN cardinality(holders);
END
$$;

-- 3. admin_rename_vocabulary ------------------------------------------------------

-- Relabels a discipline or topic (by slug id; 2 to 80 characters) or an
-- expertise tag (by uuid; 2 to 40 characters, unique case-insensitively).
-- Ids and tag slugs never change, so filters and saved links keep working.
-- A merged tag cannot be renamed. Renaming to the same label does nothing.
CREATE FUNCTION admin_rename_vocabulary(kind text, id text, label text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  clean_label text := btrim(coalesce(label, ''));
  tag_uuid uuid;
  tag expertise_tags%ROWTYPE;
  previous text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  IF kind IS NULL OR kind NOT IN ('discipline', 'topic', 'tag') OR id IS NULL
     OR char_length(clean_label) NOT BETWEEN 2 AND (CASE WHEN kind = 'tag' THEN 40 ELSE 80 END) THEN
    RAISE EXCEPTION 'mest.invalid_vocabulary' USING ERRCODE = '22023';
  END IF;

  IF kind = 'tag' THEN
    BEGIN
      tag_uuid := id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
    END;
    SELECT * INTO tag FROM expertise_tags t WHERE t.id = tag_uuid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
    END IF;
    IF tag.merged_into IS NOT NULL THEN
      RAISE EXCEPTION 'mest.tag_merged' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM expertise_tags t WHERE lower(t.label) = lower(clean_label) AND t.id <> tag_uuid) THEN
      RAISE EXCEPTION 'mest.duplicate' USING ERRCODE = '23505', DETAIL = 'another tag has this label; merge them instead';
    END IF;
    previous := tag.label;
    IF previous = clean_label THEN
      RETURN;
    END IF;
    UPDATE expertise_tags t SET label = clean_label WHERE t.id = tag_uuid;
  ELSIF kind = 'discipline' THEN
    SELECT d.label INTO previous FROM disciplines d WHERE d.id = admin_rename_vocabulary.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
    END IF;
    IF previous = clean_label THEN
      RETURN;
    END IF;
    UPDATE disciplines d SET label = clean_label WHERE d.id = admin_rename_vocabulary.id;
  ELSE
    SELECT t.label INTO previous FROM mentorship_topics t WHERE t.id = admin_rename_vocabulary.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
    END IF;
    IF previous = clean_label THEN
      RETURN;
    END IF;
    UPDATE mentorship_topics t SET label = clean_label WHERE t.id = admin_rename_vocabulary.id;
  END IF;

  PERFORM write_audit(
    'vocabulary.renamed',
    CASE WHEN kind = 'tag' THEN 'expertise_tag' ELSE kind END,
    tag_uuid,
    jsonb_build_object('kind', kind, 'id', admin_rename_vocabulary.id, 'from', previous, 'to', clean_label)
  );
END
$$;

-- 4. admin_retire_topic -------------------------------------------------------------

-- Stops offering a mentorship topic: onboarding, settings and the directory
-- filter list active topics only, and nobody can choose it afresh (the
-- mentor_topics insert policy and complete_onboarding already require
-- `active`; student_details_check_topics below does the same for students).
-- Mentors and students who already chose it keep it. Returns false, without
-- auditing again, when the topic was already retired.
CREATE FUNCTION admin_retire_topic(id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  topic mentorship_topics%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'mest.forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO topic FROM mentorship_topics t WHERE t.id = admin_retire_topic.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mest.not_found' USING ERRCODE = '23514';
  END IF;
  IF NOT topic.active THEN
    RETURN false;
  END IF;
  UPDATE mentorship_topics t SET active = false WHERE t.id = topic.id;
  PERFORM write_audit('vocabulary.retired', 'topic', NULL,
    jsonb_build_object('kind', 'topic', 'id', topic.id, 'label', topic.label));
  RETURN true;
END
$$;

-- 5. A merged tag stays merged -------------------------------------------------------

-- Re-creates admin_review_tag from 0004 (applied in production) so a merged
-- tag cannot be approved back into the vocabulary beside its replacement.
CREATE OR REPLACE FUNCTION admin_review_tag(tag_id uuid, decision tag_status) RETURNS void
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
  IF tag.merged_into IS NOT NULL THEN
    RAISE EXCEPTION 'mest.tag_merged' USING ERRCODE = '23514';
  END IF;
  UPDATE expertise_tags t SET status = decision WHERE t.id = tag_id;
  IF decision = 'rejected' THEN
    DELETE FROM profile_expertise pe WHERE pe.tag_id = admin_review_tag.tag_id;
  END IF;
  PERFORM write_audit('tag.' || decision::text, 'expertise_tag', tag_id, jsonb_build_object('label', tag.label));
END
$$;

-- 6. Typing a merged label links its replacement ------------------------------------

-- Re-creates replace_profile_expertise from 0004 (applied in production).
-- Changes: a label that names a merged tag links the tag it was merged into,
-- and two labels that resolve to the same tag count once, so the two-tag
-- minimum is checked on the links that result.
CREATE OR REPLACE FUNCTION replace_profile_expertise(profile uuid, labels text[], proposer uuid) RETURNS void
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
    IF tag.merged_into IS NOT NULL THEN
      SELECT * INTO tag FROM expertise_tags t WHERE t.id = tag.merged_into;
    END IF;
    IF tag.status = 'rejected' THEN
      RAISE EXCEPTION 'mest.tag_rejected' USING ERRCODE = '23514', DETAIL = item;
    END IF;
    INSERT INTO profile_expertise (profile_id, tag_id) VALUES (profile, tag.id) ON CONFLICT DO NOTHING;
  END LOOP;
  IF (SELECT count(*) FROM profile_expertise pe WHERE pe.profile_id = profile) < 2 THEN
    RAISE EXCEPTION 'mest.invalid_expertise' USING ERRCODE = '23514', DETAIL = '2 to 12 tags of 2 to 40 characters';
  END IF;
END
$$;

-- 7. Students keep a retired topic but cannot add one --------------------------------

-- Re-creates student_details_check_topics from 0004 (applied in production).
-- Topic ids must exist and not repeat, as before; a retired topic is allowed
-- only when the student's saved row already holds it.
CREATE OR REPLACE FUNCTION student_details_check_topics() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  kept text[] := coalesce(
    (SELECT s.topics_needed FROM student_details s WHERE s.profile_id = NEW.profile_id), '{}'
  );
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.topics_needed) AS t(id)
     WHERE NOT EXISTS (SELECT 1 FROM mentorship_topics m WHERE m.id = t.id)
  ) OR (SELECT count(DISTINCT t) FROM unnest(NEW.topics_needed) AS t) <> cardinality(NEW.topics_needed) THEN
    RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '23514', DETAIL = 'unknown or repeated topic';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.topics_needed) AS t(id)
      JOIN mentorship_topics m ON m.id = t.id
     WHERE NOT m.active AND NOT (t.id = ANY (kept))
  ) THEN
    RAISE EXCEPTION 'mest.invalid_onboarding' USING ERRCODE = '23514', DETAIL = 'retired topic';
  END IF;
  RETURN NEW;
END
$$;
