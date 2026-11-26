# MEST Network (Phase 1 MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first production release of the MEST professional directory, networking and mentorship platform (roadmap Phases 1A to 1D) as one Railway service with Railway Postgres, built and tested locally first, paused for your review at the end of each phase.

**Architecture:** One Node 22 service (Hono) serves the API under `/api/*`, the existing landing page at `/`, and the network app under `/network/*` with an SPA fallback limited to that prefix. Railway Postgres holds all data. Authorization lives in the database: reads and owner-only writes go through Row Level Security with the API running every request as the non-bypassing role `app_user` with `app.user_id` set; every state transition and every cross-user write (requests, responses, approvals, notifications, audit, contact release, deletion) is a `SECURITY DEFINER` SQL function that checks the caller first, exactly as the architecture doc's section 4.5 lists them. The TypeScript service layer only validates input and calls those functions. Email leaves through an outbox table drained by an in-process job; other jobs (expiry, reminders, resume, retention, deletions, digest) run in the same process under a lock row. The frontend keeps React 19, Vite 6 and Tailwind 4, adds React Router 7 and TanStack Query, and reuses the prototype's UI and stylesheet.

**Tech Stack:** Node 22, Hono 4, `pg` 8, zod 3, `arctic` (Google OAuth), Resend SDK, `tsx` (dev) and `esbuild` (production bundle; both resolve `@shared/*` from tsconfig paths), vitest, `@playwright/test` + `@axe-core/playwright`, React Router 7, `@tanstack/react-query` 5, react-hook-form 7. Railway: one service from a Dockerfile plus the Postgres plugin. No ORM: SQL in migrations, parameterized queries in services.

**Spec:** `docs/professional-network/` (01 requirements, 02 architecture, 03 UX, 04 roadmap, 05 open questions). Task 1 revises 02 and 05 for the decisions below; after that the docs and this plan agree and the docs are the reference for every table column, policy row and notification.

## Context

The planning phase produced the docs above and a frontend-only prototype at `/preview/professional-network` (branch `professional-network-prototype`, two local commits, not pushed). You approved building, asked for an in-depth plan reviewed before code, and for a multi-agent workflow. This plan was reviewed once by an independent reviewer agent (26 findings, all folded in). Decisions taken in this round, which supersede the docs where they differ:

| Decision | Answer |
| --- | --- |
| Hosting | Everything on Railway: one service (API + static frontend) and Railway Postgres. No Supabase. Sentry deferred to Phase 2 (not in this plan). |
| Routing | Path routes under `/network/...`; the service serves `index.html` for unknown `/network/*` paths only; any other unknown path is a real 404. |
| Visibility (A1) | Hybrid. Approved professionals are public by default (name, title, organization, discipline, expertise, bio, education, mentorship offer). Contact details (email, LinkedIn, booking link, phone) are visible only to signed-in, email-verified members, and only the methods the professional opted to share. Phone is never shared unless opted in. `members` and `hidden` remain as opt-outs. |
| Contact on accept | A mentor can additionally share methods with an accepted mentee (handoff), as in the docs. |
| Under 18 (A4) | Allowed, no special rules, no age gate. `high-school` stays an audience value. |
| Eligibility (A2, A3) | Members confirm the mission statement from `src/content/site.ts` at sign-up. Open to all; the approval queue is the human gate for professionals. |
| Numbers (A8) | 14-day expiry, 3 pending per mentee, default `max_active` 3; all in the `config` table. |
| Indexing (A6) | Public profiles indexable: the server injects title, description and Open Graph tags into `index.html` for `/network/directory/:id`; everything else `noindex`. |
| Name (A14) | Landing header link says "Directory"; app titles say "MEST Network". |
| Defaults used and flagged for the board | A5 conduct line in the accept sheet, A7 two administrators minimum, A9 retention (request free text emptied after 24 months; audit kept), A12 legal page drafts, A13 no recognition features. |
| Phase gates | Stop after each of 1A, 1B, 1C, 1D for your review. |
| Accounts you provide | Railway project and Postgres, Resend API key and verified sending domain, Google OAuth client. Everything runs locally without them. |

## Global Constraints

- Landing page files (`src/App.tsx`, `src/components/*`, `src/content/site.ts`, `src/styles.css`, `src/hooks`, `src/lib`, `index.html`) change only where a task names them: Task 9 (header link and the section observer guard), Task 13 (meta placeholders in `index.html`), Task 29 (prototype gate removal).
- Node 22 or newer; dependencies pinned to exact versions; every dependency the whole plan needs is installed in Task 2 so no later task edits `package.json` or the lockfile.
- No passwords stored. Sign-in is magic link or Google only.
- The account email lives only in `users`; no other table, view or list endpoint carries it.
- Every API request runs inside `withUser`: `BEGIN; SET LOCAL ROLE app_user; set_config('app.user_id', ...)` on the request pool, which logs in as `mest_request` (never the owner), so `RESET ROLE` cannot escape. Every `SECURITY DEFINER` function declares `SET search_path = public, pg_temp` (a test fails otherwise). `profiles` grants SELECT per column with `linkedin_url` withheld; a migration that adds a `profiles` column must grant SELECT on it explicitly. `withSystem` (table owner, bypasses RLS) is allowed only in: jobs (`server/src/jobs/*`), the pre-identity auth module (`server/src/auth/*`: token consumption, session lookup, user creation, rate-limit counts), the seed and the `admin-grant` CLI. Nothing else.
- Every status transition and cross-user write is one `SECURITY DEFINER` SQL function with `SET search_path = public` whose first statement checks the caller; routes, services and jobs never `UPDATE` a status column themselves. Owner-guard triggers pass when `current_user` is the table owner (which is how definer functions get through).
- Every task lists `Depends on:`; the workflow orders tasks by it and runs the rest in parallel.
- Error responses: `401 { code: 'unauthenticated' }` from `requireUser`; `403 { code: 'not_member' }` from `requireMember`; `403 { code: 'not_admin' }` from `requireAdmin`; domain errors `409 { code }` from the `mest.<code>` SQL exceptions; validation `400 { code: 'validation', issues }`.
- List endpoints are paged `?page` (1-based) `&size` (default 20, max 50) and return `{ items, total }`.
- Validation limits live once in `shared/limits.ts` (Task 7); zod schemas and SQL `CHECK` constraints both use those numbers.
- Every outbound email passes the privacy test (Task 20): no `why`, `goals`, `scheduling_note`, `mentor_note`, email address or phone in any template.
- Copy rules: plain English, no em-dashes, no "seamless/elevate/unleash/supercharge", nothing references an AI assistant, no board member names.
- Commits: first person, no attribution lines, one commit per task, on branch `network-build` (created from `professional-network-prototype`, no upstream; nobody pushes).
- Aggregator files are owned by the orchestrator and edited only in the integrate step: `server/src/routes/index.ts` (mounts sub-apps), `src/network/app/routes.tsx` (route objects), `src/network/app/nav.ts` (rail and tab bar items), `server/seed/seed.ts` (calls per-area seed modules), `server/src/jobs/index.ts` (registers jobs). A task that adds routes, nav items, jobs or seed data creates its own module (`server/src/routes/<area>.ts` exporting a Hono sub-app, `src/network/features/<area>/routes.tsx` exporting `RouteObject[]`, `server/seed/<area>.ts` exporting `seed<Area>(db)`, `server/src/jobs/<name>.ts` exporting a `Job`) and states in its commit message what to mount. Server route tests mount their own sub-app with `testApp(subApp)` from the harness, so they never need the aggregator.
- Shared types go in `shared/types/<area>.ts`, one file per task; new UI controls go in `src/network/ui/<area>-*.tsx`; the moved prototype files `ui.tsx`, `directory.tsx` and `network.css` are edited only by Task 8.
- Tests: server tests use `DATABASE_URL_TEST` with the database name suffixed by `WORKTREE_ID` (set by the workflow per agent) so parallel agents never share a test database; Playwright runs only in the integrate step.
- UI reuses the prototype's `pn-*` classes and components; new controls go in `src/network/ui/`, not in `src/styles.css`.

## Review Focus

Inputs the spec implies but no happy-path test exercises, each pinned to a test in the owning task:

1. A signed-in professional opening their own profile while `approval_state = pending` sees it with a "waiting for review" banner; a visitor gets 404; a member gets 404 (Task 13 test `profile_pending_visible_to_owner_only`).
2. A student who switches to professional (`set_kind`) enters the queue without losing saved profiles or open requests (Task 12 test `set_kind_keeps_requests_and_saved`).
3. A member who deletes their account while a request they received is pending: the request is declined with reason `member_left` and the mentee is notified (Task 26 test `deletion_declines_received_pending`); after the sweep the mentee's history shows "Former member" (Task 26 test `sweep_leaves_no_personal_field_and_keeps_request_counts`).
4. Two concurrent accepts for a mentor's last free slot produce exactly one `accepted` (Task 19 test `concurrent_accept_respects_cap`).
5. A magic link opened by a mail scanner (GET) is not consumed (Task 5 test `magic_link_get_does_not_consume`); a second submit after the first fails and a link after 15 minutes fails (Task 5 test `magic_link_single_use_and_expiry`).

## Multi-agent workflow (how each phase is executed)

Each phase runs as one `Workflow` script:

1. **Implement.** Independent tasks run in parallel, each on its own agent in its own worktree branched from `network-build`, with `WORKTREE_ID` set so its test database is private. Dependent tasks run in order. Each agent receives its task text, the Global Constraints, and the Interfaces blocks it consumes; it runs its own server tests and typecheck, and commits on its worktree branch.
2. **Review.** A fresh reviewer agent per task reads the diff against the task text and the constraints, runs the task's tests, and returns `pass` or `fail` with findings. A `fail` goes back to a fresh implementer once; a second `fail` stops the workflow for me.
3. **Integrate.** I merge in dependency order, mount routes, nav and seed modules in the aggregators, run the full server suite, web and server typecheck, build, and Playwright against the local stack.
4. **Audit.** Two read-only audits of the phase diff: a Codex pass (your standing rule; the account's working model) and a security/privacy reviewer agent working from the "Who can read what" table. I verify each finding in the code, fix confirmed ones, re-run everything, commit.
5. **Gate.** I stop, give you the local demo steps, and wait.

At most 8 agents per phase run.

## File structure (after Phase 1)

```
package.json                     web app (scripts unchanged) + workspaces ["server"] + all pinned deps
Dockerfile, railway.json, docker-compose.yml, .env.example, .github/workflows/ci.yml, playwright.config.ts
shared/                          imported as @shared/* (vite resolve.alias; tsx and esbuild read tsconfig paths)
  taxonomy.ts                    copied from the prototype; topics become { id, label }
  limits.ts                      every length and count limit, one place
  schemas/*.ts                   zod: auth, onboarding, profile, settings, request, admin
  types/<area>.ts                API response types, one file per task
server/
  package.json, tsconfig.json (rootDir ../, outDir dist), vitest.config.ts
  migrations/0001..0009_*.sql    hand-written, numbered, forward-only (0001 roles, 0002 core, 0003 notifications, 0004 profiles, 0005 requests, 0006 jobs, 0007 reports, 0008 dashboard, 0009 deletions)
  src/index.ts                   Hono app, static dist, /network/* fallback, meta injection, health
  src/env.ts, src/db/{pool,migrate,tx}.ts, src/http/{errors,validate}.ts, src/audit.ts
  src/auth/{magic-link,google,session,middleware}.ts
  src/email/{resend,outbox,templates/*}.ts
  src/jobs/{scheduler,send-emails,expire-requests,reminders,resume-paused,retention,deletions,digest}.ts
  src/services/{profiles,directory,contact,requests,reports,admin,notifications,account,export}.ts
  src/routes/{index,auth,config,me,profiles,directory,requests,notifications,admin,reports,account,export}.ts
  src/cli/admin-grant.ts
  seed/{seed,users,profiles,requests,reports}.ts
  test/{harness.ts,db/*,auth/*,policies/*,services/*,email/*,jobs/*}
src/network/
  main.tsx, app/{router,routes,nav,shells,guards}.tsx, lib/{api,query,session,meta}.tsx
  ui/                            moved prototype ui.tsx, directory.tsx, network.css
  features/{public,auth,onboarding,me,mentor,admin,settings,notifications}/*
e2e/*.spec.ts
docs/professional-network/       02 and 05 revised; runbook.md added
```

---

## Phase 1A: Foundations

### Task 1: Revise the architecture and open-questions docs for the Railway decision

**Depends on:** nothing.

**Files:** Modify `docs/professional-network/02-technical-architecture.md` (sections 2, 3, 4.5, 4.6, 5, 6, 7, 9, 10), `05-open-questions.md`, `README.md`.

**Interfaces:** Produces the written rules every later task cites: `withUser` and `withSystem`; the `app_user` role; the list of `SECURITY DEFINER` functions (4.5) with their argument lists; the outbox and job tables; hybrid visibility and `contact_preferences.share_with_members`; `release_contact(profile_id)`; the limits table (copied into `shared/limits.ts` by Task 7); `users` kept as a tombstone row on deletion.

- [ ] **Step 1:** Rewrite 2.1 as "Decision: Node API and Postgres on Railway" (reasons: one vendor the organizer uses, fallback rewrite is ours, one deploy; trade-off: auth and helpers are our code, mitigated by keeping RLS and SQL functions). Keep Supabase as an alternative considered.
- [ ] **Step 2:** 4.5 keeps every function and adds `release_contact(profile_id uuid)`, `create_notification(recipient uuid, category, title, body, link, email boolean)`, `write_audit(...)`, `enqueue_email(...)`, `request_introduction` folded into `create_mentorship_request(kind)`. 4.6 becomes the in-process job table with the lock row. 5.1 describes magic link (GET shows a continue form, POST consumes) and Google via `arctic`, the `sessions` table and cookie. 5.2 helpers read `app.user_id`. 5.3 adds a `users` row (owner reads own `email_verified_at` through `is_member()` only; no direct policy) and keeps the "via RPC only" write rows, now meaning "via SQL function".
- [ ] **Step 3:** 5.4 adds the hybrid rule and the `release_contact` path; 6 adds "SPA fallback only under `/network`" and the server-injected meta; 8 changes the sweep to keep `users` with `email = null`, `deleted_at = now()`, and to delete `auth_tokens` and `email_outbox` rows for that address; 10 becomes Railway.
- [ ] **Step 4:** Record the decisions in 05 dated 2026-11-23 and list A5, A7, A9, A12, A13 under "Using the default until the board decides".
- [ ] **Step 5:** Commit: `Revise the platform architecture for Railway hosting`.

### Task 2: Workspace, dependencies, Docker, CI, local stack, migration runner

**Depends on:** nothing (runs in parallel with Task 1).

**Files:**
- Modify: `package.json` (workspaces; every dependency this plan uses, pinned; scripts `dev:server`, `dev:all`, `typecheck` = `tsc -b && tsc -p server --noEmit`, `test:server`, `e2e`, `migrate`, `seed`, `job`, `admin:grant`), `.gitignore` (`.env`, `server/dist`, `playwright-report`, `test-results`), `vite.config.ts` (`resolve.alias` for `@shared`, `server.proxy['/api']` to `http://127.0.0.1:8787`), `tsconfig.json` (`paths` for `@shared/*`, `include` adds `shared`)
- Create: `server/package.json` (scripts `dev` = `tsx watch src/index.ts`, `build` = esbuild bundle `src/index.ts` to `dist/index.js`, platform node, external `pg`), `server/tsconfig.json`, `server/vitest.config.ts` (includes `../shared/**/*.test.ts`), `docker-compose.yml` (postgres:16 on 54329 with databases `mest` and `mest_test`), `.env.example`, `Dockerfile`, `railway.json`, `.github/workflows/ci.yml`, `playwright.config.ts` (webServer starts the built server on 8787 against the seeded database; projects at 375 and 1280)
- Create: `server/src/env.ts`, `server/src/index.ts` (health, static, fallback), `server/src/db/pool.ts`, `server/src/db/migrate.ts`, `server/migrations/0001_extensions_and_roles.sql`, `server/test/harness.ts`
- Test: `server/test/db/migrate.test.ts`

**Interfaces:**
- `env`: `{ DATABASE_URL, DATABASE_URL_TEST?, APP_ORIGIN, SESSION_SECRET (32+ chars), RESEND_API_KEY?, EMAIL_FROM, GOOGLE_CLIENT_ID?, GOOGLE_CLIENT_SECRET?, PORT=8787, NODE_ENV, JOBS_ENABLED=false, TRUST_PROXY=false }`.
- `runMigrations(pool)` applies `server/migrations/*.sql` in name order under `pg_advisory_lock(7231)`, records in `schema_migrations(name, applied_at)`.
- 0001: `citext`, `pgcrypto`; `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN CREATE ROLE app_user NOLOGIN; END IF; END $$;` plus grants and default privileges; `app_uid()` returning `nullif(current_setting('app.user_id', true), '')::uuid`.
- Static serving: `/assets/*`, `/images/*`, `/fonts/*`, `/logo/*`, `/favicon.svg`, `/og.jpg`, `/apple-touch-icon.png` from `dist/`; `/` serves `dist/index.html`; `/network` and `/network/*` serve `dist/index.html` (Task 13 adds meta injection); any other path returns 404 (`text/plain` "Not found").
- `GET /api/health` returns `{ ok: true, migrations: n }`.
- Harness: `createTestDb()` builds `mest_test_${WORKTREE_ID ?? 'local'}` by dropping and creating it from the maintenance connection, runs migrations; `asUser(pool, userId, fn)` and `asSystem(pool, fn)`; `truncateAll()` between tests.

- [ ] **Step 1:** Failing test `migrations_apply_and_app_uid_scopes` (one `schema_migrations` row; `app_uid()` null outside, equal to the id inside `asUser`; the role exists after a second `createTestDb()`).
- [ ] **Step 2:** Run `npm run test:server`; expect FAIL. Implement everything listed.
- [ ] **Step 3:** `docker compose up -d && npm run test:server && npm run typecheck && npm run build && npm run build -w server && node server/dist/index.js` answers `/api/health` and `/`; `docker build .` starts and answers the same. CI workflow runs the same commands with a Postgres service.
- [ ] **Step 4:** Commit: `Add the server workspace, local Postgres and Railway build`.

### Task 3: Core schema: users, sessions, tokens, profiles, config, admins, audit, deletions

**Depends on:** Task 2.

**Files:** Create `server/migrations/0002_core.sql`, `server/src/audit.ts`; Test `server/test/policies/{profiles,helpers}.test.ts`.

**Interfaces:**
- `users(id uuid pk default gen_random_uuid(), email citext unique, email_verified_at timestamptz, google_sub text unique, created_at, last_sign_in_at, suspended_at, deleted_at)`; `email` nullable only after deletion.
- `sessions(id text pk, user_id uuid references users, expires_at, created_at, user_agent)`; `auth_tokens(id uuid pk, email citext, token_hash text unique, purpose text, expires_at, used_at, ip inet, created_at)`; `job_runs(job text pk, last_run_at, locked_at)`.
- `profiles` per 02 section 4.3 with `id references users(id)`, `visibility default 'public'`, `approval_state default 'pending'`, `kind` nullable until onboarding, `region default 'greater-new-orleans'`, `mission_accepted_at timestamptz`, `admin_hidden_at timestamptz` (an administrator's hide, which the owner cannot clear; the directory rule adds `admin_hidden_at IS NULL`), `search_tsv` generated from names; `config` seeded (`request_expiry_days 14`, `reminder_days [5,10]`, `pending_cap 3`, `default_max_active 3`, `daily_request_limit 5`, `daily_report_limit 3`, `magic_links_per_hour 5`, `platform_paused false`, `retention_months 24`); `admin_roles`; `audit_log`; `account_deletions(id, profile_id, requested_at, execute_after, canceled_at, executed_at, previous_visibility, reason, immediate boolean)` created here so `is_member()` can reference it.
- Helpers (`SECURITY DEFINER`, `STABLE`): `is_member()` = `app_uid()` not null, `users.email_verified_at` not null, `users.suspended_at` null, `users.deleted_at` null, `profiles.anonymized_at` null, no `account_deletions` row with `canceled_at` and `executed_at` null; `is_admin()`. `is_counterparty` arrives in Task 19.
- Functions: `write_audit(action text, subject_type text, subject_id uuid, detail jsonb)` strips keys `email, phone, why, goals, scheduling_note, mentor_note` from `detail`, records `app_uid()` as actor (null in system context); `admin_update_config(key, value)`.
- Policies: `profiles` SELECT public rule (`kind = 'professional' AND approval_state = 'approved' AND visibility = 'public' AND admin_hidden_at IS NULL AND 'directory' = ANY(participation)`), member rule (`visibility IN ('public','members')`), owner, admin; owner UPDATE limited by a trigger that rejects changes to `approval_state`, `kind`, `anonymized_at`, `admin_hidden_at`, `mission_accepted_at` unless `current_user` is the table owner; `config` read by all, write by `admin_update_config` which validates per key (`request_expiry_days 3..60`, `reminder_days` ascending ints below expiry, `pending_cap 1..10`, `default_max_active 1..10`, `daily_request_limit 1..50`, `daily_report_limit 1..20`, `magic_links_per_hour 1..20`, `platform_paused boolean`, `retention_months 6..60`); `admin_roles` admin read; `audit_log` admin read; `account_deletions` owner and admin read.
- `profile_access(id uuid)` (`SECURITY DEFINER`) returns `visible | members_only | none` for the caller, so a route can answer 403 versus 404 without a policy leak.
- `audit(db, ...)` in `server/src/audit.ts` is a thin caller of `write_audit`.

- [ ] **Step 1:** Failing tests: `anon_reads_public_professionals_only`, `member_reads_members_visibility_not_hidden`, `owner_reads_own_pending_profile`, `student_profiles_never_listed`, `owner_update_cannot_change_approval_state`, `is_member_false_for_unverified_suspended_or_deleting`, `is_admin_true_only_with_unrevoked_role`, `write_audit_strips_private_keys`.
- [ ] **Step 2:** Run; FAIL. Implement 0002 and `audit.ts`. Run; PASS. Commit: `Add the core schema with row-level security`.

### Task 4: Transaction helpers and HTTP skeleton

**Depends on:** Task 2 (parallel with Task 3).

**Files:** Create `server/src/db/tx.ts`, `server/src/http/errors.ts`, `server/src/http/validate.ts`, `server/src/routes/index.ts` and `server/src/jobs/index.ts` (orchestrator-owned afterwards); Modify `server/src/index.ts`, `server/test/harness.ts` (add `testApp(subApp)`); Test `server/test/db/tx.test.ts`.

**Interfaces:** `withUser<T>(userId: string | null, fn: (db: Db) => Promise<T>)`, `withSystem<T>(fn)`; `Db` wraps a `pg.PoolClient` with `query<T>(sql, params)` and `one<T>`/`maybeOne<T>`. `AppError(status, code, message, extra?)`; `validate(schema)` middleware; a global error handler that also maps Postgres exceptions whose message starts with `mest.` to `409 { code }`; `routes/index.ts` mounts sub-apps; unknown `/api/*` → `404 { code: 'not_found' }`; `testApp(subApp)` returns a Hono app with the error handler and the sub-app mounted at `/api` for route tests.

- [ ] **Step 1:** Failing test `with_user_sets_role_and_uid_and_rolls_back_on_throw`. Implement; PASS. Commit: `Add transaction helpers that run every request as the acting user`.

### Task 5: Magic-link sign-in, sessions, notifications table, outbox sender, public config

**Depends on:** Tasks 3 and 4.

**Files:** Create `server/migrations/0003_notifications.sql` (`notifications`, `notification_preferences`, `email_outbox`, functions `create_notification`, `enqueue_email`), `server/src/auth/{magic-link,session,middleware}.ts`, `server/src/routes/{auth,config}.ts`, `server/src/email/{resend,outbox,templates/registry,templates/magic-link,templates/default}.ts`, `shared/schemas/auth.ts`, `shared/types/auth.ts`; Test `server/test/auth/{magic-link,session}.test.ts`, `server/test/email/outbox.test.ts`.

**Interfaces:**
- `notification_preferences(profile_id pk, email_requests, email_responses, email_reminders, email_profile, email_reports, email_admin_digest, email_product_updates)` all boolean default true except `email_product_updates` false. `notifications` per 02 plus `template text`, `payload jsonb`, `email_status`. `email_outbox(id, notification_id uuid null, to_email, template text, payload jsonb, attempts, last_error, sent_at, created_at)`: rows store the template name and data; the sender renders at send time with the TypeScript registry.
- `create_notification(recipient uuid, category notification_category, title text, body text, link text, template text, payload jsonb, email boolean)` (`SECURITY DEFINER`): inserts the row; when `email` is true, enqueues an outbox row if the category is `account` (always) or the recipient's column for that category is true (map: request→email_requests, response→email_responses, reminder→email_reminders, profile→email_profile, report→email_reports, admin_digest→email_admin_digest). `enqueue_email(to, template, payload)`.
- `registry.ts`: `registerTemplate(name, render)`, `renderTemplate(name, data) → { subject, text, html }`; this task registers `magic-link` and `default` (title and body from the payload plus the link); later tasks register more. `sendOutboxBatch(db, limit = 50)` renders and sends through Resend, sets `sent_at` or `attempts + 1` with `last_error`, gives up after 3; without `RESEND_API_KEY` it marks sent and logs the text body (how a local magic link is read). Task 10 wraps it as the `send-emails` job.
- `POST /api/auth/magic-link { email }` → `202 {}` always; rate limit `magic_links_per_hour` per email and per IP (`TRUST_PROXY` decides whether `X-Forwarded-For` is read) → `429 { code: 'rate_limited' }`; token 32 random bytes, `token_hash = sha256`, 15-minute expiry. The auth module runs its token, session and user writes inside `withSystem` (the one allowed pre-identity exception).
- `GET /api/auth/callback?token=` renders a minimal HTML page "Continue to MEST Network" with a form that POSTs the token (scanner-safe). `POST /api/auth/callback` consumes the token once, creates `users` (+ `email_verified_at`) and a `profiles` row with `kind null` when new, creates a session, sets cookie `mest_session` (httpOnly, `Secure` outside development, `SameSite=Lax`, 30 days), redirects to `/network/onboarding` when `kind` is null, `/network/scheduled-for-deletion` when a deletion is active, else `/network/me`. Failures redirect to `/network/signin?error=link`.
- `POST /api/auth/signout`; `GET /api/auth/me` → `{ user: { id, kind, approvalState, isAdmin, mentorStatus (null until Task 11 adds the settings table), hasDeletionScheduled } | null }`; `GET /api/config/public` → `{ googleEnabled, platformPaused }`.
- `sessions.id = sha256(cookie)`; rotate on each callback; `requireUser`, `requireMember`, `requireAdmin`; Origin check on every non-GET.
- Test-only routes registered when `NODE_ENV = 'test'`: `POST /api/auth/dev-login { email }` and `GET /api/auth/dev-last-link?email=` (the raw link kept in process memory per email, test mode only, since the database stores hashes). Both return 404 otherwise.

- [ ] **Step 1:** Failing tests: `magic_link_enqueues_email_and_stores_hash_only`, `magic_link_get_does_not_consume`, `magic_link_single_use_and_expiry`, `callback_creates_user_profile_and_cookie`, `rate_limit_per_email_and_ip`, `signout_clears_session`, `me_null_without_cookie`, `dev_routes_absent_outside_test`, `create_notification_account_always_emails`, `create_notification_respects_category_preference`, `outbox_sends_retries_and_gives_up_after_3` (Resend mocked).
- [ ] **Step 2:** Implement; PASS. Commit: `Add passwordless sign-in with sessions`.

### Task 6: Google sign-in

**Depends on:** Task 5.

**Files:** Create `server/src/auth/google.ts`; Modify `server/src/routes/auth.ts`; Test `server/test/auth/google.test.ts` (mock at the `arctic` boundary).

**Interfaces:** `GET /api/auth/google` (state + PKCE in a 10-minute cookie), `GET /api/auth/google/callback` (validates state, exchanges code, requires `email_verified`, links by email or creates, then Task 5's session logic). Returns 404 when `GOOGLE_CLIENT_ID` is unset.

- [ ] **Step 1:** Failing tests `google_links_existing_user_by_verified_email`, `google_rejects_unverified_email`, `google_disabled_without_client_id`. Implement; PASS. Commit: `Add Google sign-in`.

### Task 7: Shared vocabularies, limits and zod schemas

**Depends on:** Task 2 (parallel with Tasks 3 to 6). Does not edit the prototype; Task 8 adapts the prototype to the new shapes.

**Files:** Create `shared/taxonomy.ts` (copied from the prototype; `mentorshipTopics` becomes `{ id: string; label: string }[]` with slug ids), `shared/limits.ts`, `shared/schemas/{common,onboarding,profile,settings,request,admin}.ts`, `shared/types/common.ts`; Test `shared/schemas.test.ts`.

**Interfaces:**
- `limits.ts` (the numbers from 02 section 4.3 after Task 1): `name 1..60`, `credentials 0..20`, `bio 120..1200`, `location 1..80`, `title 1..120`, `organization 1..120`, `yearsExperience 0..60`, `expertise 2..12 tags of 2..40`, `interests 0..10`, `education 0..6`, `program 1..120`, `goals 20..600`, `topicsNeeded 1..5`, `availabilityText 0..160`, `maxActive 1..10`, `why 30..800`, `requestGoals 0..400`, `schedulingNote 0..200`, `note 0..600`, `reportDetail 0..1000`.
- Schemas: `studentOnboardingSchema` (+ `acceptMission: literal(true)`), `professionalOnboardingSchema` (+ `acceptMission: literal(true)`; fields from 03 section 5 steps 2, 3a, 4: identity, work, participation, mentorship when `mentoring` chosen, visibility `public | members`, contact `methods` containing `mest`, `shareWithMembers ⊆ methods \ {mest}`, `contactEmail?`, `phone?`, `bookingUrl?`, `linkedinUrl?` host `linkedin.com`/`www.linkedin.com`, `websiteUrl?` https), `profilePatchSchema`, `settingsPatchSchema`, `createRequestSchema` (`mentorId`, `kind: mentorship | introduction`, `topicId` required for mentorship, `why`, `goals`, `format one-time | recurring`, `mode`, `schedulingNote`), `respondSchema` (`decision`; `note`; `declineReason: not_fit | no_capacity | outside_experience | other` when declined; `shareMethods ⊆ contact methods` when accepted), `reportSchema` (`reason` enum from 02, `detail`), `adminReviewSchema`, `configPatchSchema`.

- [ ] **Step 1:** Failing boundary tests (one accept, one reject per limit and rule). Implement; PASS. Commit: `Add the shared vocabularies, limits and validation schemas`.

### Task 8: Frontend foundation: router, API client, session, shells, nav

**Depends on:** Tasks 5 and 7.

**Files:** Create `src/network/main.tsx`, `src/network/app/{router,routes,nav,shells,guards}.tsx`, `src/network/lib/{api,query,session,meta}.tsx`, `src/network/features/public/Stub.tsx` (placeholder pages for every route until their tasks land); move the prototype's `components/ui.tsx`, `components/directory.tsx`, `network.css` to `src/network/ui/` and point the prototype at the new paths and at `@shared/taxonomy` (topic `.label` where it rendered strings); Modify `src/main.tsx` (gate `/network` and `/network/*` to the lazy `NetworkApp`, keep the prototype gate); Test `e2e/foundation.spec.ts`.

**Interfaces:** `api<T>(path, init?)` with `credentials: 'include'`, throws `ApiError { status, code, issues }`; `useSession()` → `{ user, status: 'loading' | 'anon' | 'ready', refresh }`; guards `RequireMember`, `RequireOnboarded`, `RequireAdmin`; `routes.tsx` concatenates each feature's `routes.tsx`; `nav.ts` derives rail and tab items from `user.kind`, `user.mentorStatus`, `user.isAdmin` (a mentoring professional sees Mentoring and Find mentors); `shells.tsx` renders a `headerSlot` prop where Task 18 mounts the Bell; `useMeta({ title, description, noindex = true, canonical?, og? })`. Route list: `/`, `/directory`, `/directory/:id`, `/mentorship`, `/signin`, `/check-email`, `/join`, `/onboarding/*`, `/scheduled-for-deletion`, `/me/*`, `/mentor/*`, `/admin/*`, `/settings/*`, `/guidelines`, `/privacy`, `*`.

- [ ] **Step 1:** `e2e/foundation.spec.ts`: `/` still renders the landing sections (ids `hero`, `mission`, `events`, `get-involved`) at 375 and 1280; `/network` renders the stub home; `/network/me` anonymous redirects to `/network/signin`; `/network/directory` served by the Node server returns `index.html`; `/nothing-here` returns 404. (Playwright runs in the integrate step after Task 10's seed exists.)
- [ ] **Step 2:** Implement; `npm run typecheck && npm run build && npm run e2e` PASS. Commit: `Add the network app shell, router and session`.

### Task 9: Public screens and the landing header link

> **Handoff from integration (wave 4):** Sign-in failures land on `/network/signin?error=link` (bad, used or expired magic link) or `/network/signin?error=google` (canceled or failed Google sign-in, including an address already linked to a different Google account). Show a distinct plain-language message for each, with an e2e assertion. Task 8 built stub pages and the aggregator `src/network/app/routes.tsx`; export this task's `RouteObject[]` from `features/public/routes.tsx` and `features/auth/routes.tsx` and say in the commit message what to swap in. Run `npx playwright install chromium` once if the browser is missing.

**Depends on:** Task 8.

**Files:** Create `src/network/features/public/{Home,Mentorship,Guidelines,Privacy,routes}.tsx`, `src/network/features/auth/{SignIn,CheckEmail,Join,ScheduledForDeletion,routes}.tsx` (`ScheduledForDeletion` renders the grace screen from `GET /api/auth/me`; its Keep-my-account button is wired in Task 26); Modify `src/content/site.ts` (add `{ label: "Directory", href: "/network/directory" }`), `src/components/Header.tsx` and `src/components/Footer.tsx` (skip hrefs not starting with `#` in the section observer and `aria-current`; render them as plain links); Test `e2e/auth.spec.ts`.

**Interfaces:** Sign-in shows Google only when `googleEnabled`; posts the magic link, routes to `/check-email`. Join shows the two paths and the mission-statement checkbox (text from `mission.statement`). Guidelines and Privacy are drafts tagged "Draft for board review", written from the architecture doc's facts (collected data, who sees what, 24-month retention, deletion with 14-day grace, A5 conduct line).

- [ ] **Step 1:** `e2e/auth.spec.ts`: request a link for a new address, fetch it from `dev-last-link`, open the GET page, submit Continue, land on the URL `/network/onboarding` (a stub until Task 14); sign out; the landing header shows "Directory" and clicking it opens `/network/directory`; the landing's section links still scroll.
- [ ] **Step 2:** Implement; PASS. Commit: `Add the public network screens and sign-in`.

### Task 10: Development seed (core), job scheduler, outbox job

> **Handoff from integration (wave 3):** `sendOutboxBatch(db, limit, mailer)` sends a whole batch inside the caller's transaction, so one failing statement after some sends would roll their `sent_at` back and resend them next run. The `send-emails` job must claim and mark rows in short per-row transactions (or wrap each row in a SAVEPOINT), with a test that a failure on row 3 leaves rows 1 and 2 marked sent.

**Depends on:** Task 5.

**Files:** Create `server/seed/{seed,users,profiles}.ts` (users with verified emails `<prototype-id>@example.test`, profiles for the 23 people with `kind`, `approval_state` and `mission_accepted_at` from the prototype, admin roles for `admin@example.test` and `admin2@example.test`, written inside `withSystem`), `server/src/jobs/{scheduler,send-emails}.ts`; Modify `server/src/index.ts` (start the scheduler from `jobs/index.ts` when `JOBS_ENABLED`; in development the `send-emails` job always runs so magic links print); Test `server/test/jobs/scheduler.test.ts`.

**Interfaces:** `Job = { name, everyMs, run(db, now) }`; `registerJob(job)`, `runJobOnce(name)` (also `npm run job -- <name>`); lock via `job_runs.locked_at` (stale after 10 minutes); `send-emails` every 60 000 ms calling Task 5's `sendOutboxBatch`. `seed.ts` exports `SEED` (prototype id → user id and email) for tests and e2e. Later schema tasks add `seed/<area>.ts` modules and the orchestrator calls them from `seed.ts`.

- [ ] **Step 1:** Failing tests `scheduler_skips_when_locked`, `scheduler_runs_stale_lock`, `send_emails_job_drains_outbox`. Implement; seed inserts 23 profiles and 2 admins. Commit: `Add the development seed and job scheduler`.

### Phase 1A gate

`npm run typecheck`, `npm run test:server`, `npm run build`, `npm run e2e`, `docker build .` serving `/`, `/network`, `/api/health`, 404 elsewhere. Demo: sign in locally by magic link (link printed by the server), land on onboarding, sign out; landing unchanged at 375 and 1280 except the new header link. Audits on the 1A diff. Stop.

---

## Phase 1B: Profiles and directory

### Task 11: Profile schema: details, vocabularies, expertise, settings, contact, reviews, saved, dashboard view

> **Handoff from integration (wave 4):** The core seed writes only the columns that exist after 0003. When `profile_in_directory()` becomes the participation check, every seeded professional disappears unless `server/seed/profiles-details.ts` writes `participation` from the prototype (every listed professional includes `directory`); `server/test/seed/seed.test.ts` (14 visible to a visitor) must stay green after this task.

> **Handoff from integration (wave 2):** Migration 0002 ships `profile_in_directory(profile_id uuid)` as a SECURITY DEFINER stub that returns true; the profiles read policies and `profile_access` call it. This task must `CREATE OR REPLACE` its body with `EXISTS (SELECT 1 FROM professional_details d WHERE d.profile_id = $1 AND 'directory' = ANY(d.participation))`, keep it SECURITY DEFINER, and add a test that a professional without `directory` participation is invisible to visitors and members. Also: `write_audit` is not executable by `app_user`, so every audited action must happen inside a definer function; a professional's `bio` is required (enforce in `complete_onboarding` and by a trigger on professional_details or profiles, with a test); `profiles.linkedin_url` is readable through row policies on `profiles`, so the profile and directory endpoints must never select it (Task 13's tests guard this); the prototype's Musa Grant bio is under 120 characters and must be lengthened in the seed.

**Depends on:** Tasks 5, 7 and 10.

**Files:** Create `server/migrations/0004_profiles.sql`, `server/seed/profiles-details.ts`, `shared/types/profiles.ts`; Test `server/test/policies/{details,contact,settings,saved,reviews}.test.ts`.

**Interfaces:**
- Tables per 02 section 4.3 with `CHECK`s from `shared/limits.ts`; `contact_preferences(profile_id pk, methods contact_method[] default '{mest}', share_with_members contact_method[] default '{}', contact_email citext, phone text, booking_url text)` with `CHECK (share_with_members <@ methods AND NOT ('mest' = ANY(share_with_members)))`; `mentorship_settings` with `status default 'off'`, `max_active` set by `complete_onboarding` from `config.default_max_active`, `previous_status` for restore; `professional_details.verified*` protected by an owner-guard trigger like Task 3's, and a trigger that clears `verified` and audits `profile.affiliation_changed` when `title` or `organization` changes on a verified row by the owner; `professional_details.search_tsv` trigger-maintained from title, organization, bio and tag labels, GIN indexed; vocabulary seed from `shared/taxonomy.ts` (disciplines, topics with slug ids, expertise tags `approved`).
- Views: `directory_entries` (`security_invoker`; excludes contact columns and `linkedin_url`; `has_capacity` boolean; `experience_band` = `0-2 | 3-9 | 10-19 | 20+` years; `verified`; `participation`; `tags`; `location`; `last_active_at`); `admin_dashboard` (approved, pending, students, active mentors; reports and request measures appended by Tasks 24 and 25).
- Functions (`SECURITY DEFINER`): `complete_onboarding(payload jsonb)` (writes profile including `mission_accepted_at`, details, education, expertise with unknown labels as `proposed` tags, settings and topics when mentoring, contact prefs, notification prefs; sets `approval_state = 'approved'` for students and opens `profile_reviews` for professionals; audits `profile.submitted`; notifies admins `profile` with template `profile-submitted` when the queue was empty), `set_kind(kind)`, `set_mentorship_status(status, resume_on date)` (`active` requires `mentoring` in participation; stores `paused_until`), `save_profile(id)`, `unsave_profile(id)`, `release_contact(profile_id)` (this task: `share_with_members` for any `is_member()` caller; Task 19 `CREATE OR REPLACE`s it to add an accepted relationship's `shared_methods`; `email` resolves `contact_email ?? users.email`; `linkedin` returns `profiles.linkedin_url`; audits `contact.viewed` once per caller and profile), `touch_last_active()`, `admin_review_profile(review_id, decision, notes)`, `admin_set_verified(profile_id, method verified_method | null)` (`work_email | linkedin | personal_knowledge`), `admin_hide_profile(profile_id)` (sets `admin_hidden_at`, mentorship to `off` with `previous_status` kept), `admin_restore_profile(profile_id)`, `admin_grant(profile_id)`, `admin_revoke(profile_id)` (refuses below two), `admin_review_tag(tag_id, decision)`, `admin_add_vocabulary(kind, id, label)`, `admin_list_members(page, size, q)` (returns names, kind, status, mentor status and the sign-up email domain only).
- Policies per 02 section 5.3: `contact_preferences` owner-only read and write; `mentorship_settings` readable wherever the profile is, `max_active` reachable only by the owner (others use `has_capacity`), `status` writable only through `set_mentorship_status`; `profile_reviews` subject reads decision and notes; `saved_profiles` saver only; vocabulary tables readable by all; `expertise_tags` `proposed` visible to proposer and admin.

- [ ] **Step 1:** Failing policy tests covering every cell of the "Who can read what" table for these tables (visitor, member, owner, admin; `contact_preferences_unreadable_by_members_and_admins`, `linkedin_absent_from_directory_view`, `proposed_tag_visible_to_proposer_and_admin_only`) and function tests `complete_onboarding_student_approved`, `complete_onboarding_professional_opens_review_and_notifies_admins_when_queue_empty`, `affiliation_change_clears_verified`, `release_contact_shared_methods_only_for_members`, `release_contact_phone_never_without_opt_in`, `release_contact_audited_once`, `admin_revoke_refuses_below_two`, `admin_hide_sets_mentorship_off_and_restore_returns_it`, `owner_cannot_clear_admin_hidden`, `admin_list_members_has_no_email`.
- [ ] **Step 2:** Implement; PASS; `seed/profiles-details.ts` fills details, settings, contact prefs, saved and reviews from the prototype data. Commit: `Add the profile, vocabulary and settings schema`.

### Task 12: Profile services and routes

> **Handoff from integration (Phase 1B wave 1):** Read `server/migrations/0004_profiles.sql` before writing SQL against it. Enum array columns (`participation`, `audience`, `methods`, `share_with_members`) come back from `pg` as strings like `'{email}'`; cast them to `text[]` in every select (the views already do). `mentorship_settings.max_active` is column-withheld from requests; the owner reads it through `my_mentorship_settings()`, everyone else through `directory_entries.has_capacity`. `profile_entries` is the unfiltered companion view to `directory_entries` (same columns, no listing filter; RLS still applies). `GET /api/auth/me` now returns `mentorStatus`. `complete_onboarding(payload jsonb)` takes the camelCase output of the shared onboarding schema as is. `set_my_expertise(labels text[])` exists for the profile patch (unknown labels become `proposed`; a rejected label raises `mest.tag_rejected`). `release_contact` now follows the member-visible rule (approved, listed, not hidden), so for `GET /api/me/preview?as=member` compute the contact list from the owner's own `contact_preferences.share_with_members` resolved the same way, not by calling `release_contact` as the owner; `as=visitor` has no contact. Students get `visibility = 'hidden'` and no mentorship row; every professional has a mentorship row.

> **Handoff from the Phase 1A audit:** requests cannot select `profiles.linkedin_url` (column grant withheld). `GET /api/me/profile` returns the owner's own LinkedIn link through a definer function (for example `my_profile_private()` returning `linkedin_url` for `app_uid()`), with a test that a visitor and another member still get permission denied on the column. A member with an open deletion can no longer update their profile at all (`profiles_owner_update` requires `is_member()`).

**Depends on:** Task 11 (parallel with Task 13).

**Files:** Create `server/src/services/profiles.ts`, `server/src/routes/me.ts`; Test `server/test/services/profiles.test.ts`.

**Interfaces:** `GET /api/me/profile` → own profile in any state with `approvalState`, latest review decision and notes, settings and contact preferences; `POST /api/me/onboarding` (shared schema, then `complete_onboarding`); `PATCH /api/me/profile` (owner columns through RLS); `GET|PATCH /api/me/settings` (visibility, contact prefs, `maxActive`, `availabilityText`, format, mode, topics, audience, notification prefs; mentorship status changes call `set_mentorship_status`); `POST /api/me/kind`; `POST /api/me/touch`; `GET /api/me/preview?as=visitor|member` → `{ access: 'visible' | 'members_only' | 'none', profile?, contact? }` built from `profile_access`, the directory view and `release_contact` as that viewer (PRO-13).

- [ ] **Step 1:** Failing tests `student_onboarding_lands_approved`, `professional_onboarding_pending_with_review`, `unknown_expertise_becomes_proposed`, `set_kind_keeps_saved` (Task 19 adds `set_kind_keeps_requests`), `mentoring_requires_participation`, `lowering_max_active_keeps_relationships`, `preview_as_visitor_hides_members_only_profile`. Implement; PASS. Commit: `Add onboarding and profile services`.

### Task 13: Directory, profile and contact reads; meta injection

> **Handoff from integration (Phase 1B wave 1):** Read `server/migrations/0004_profiles.sql` before writing SQL against it. Enum array columns (`participation`, `audience`, `methods`, `share_with_members`) come back from `pg` as strings like `'{email}'`; cast them to `text[]` in every select (the views already do). `mentorship_settings.max_active` is column-withheld from requests; the owner reads it through `my_mentorship_settings()`, everyone else through `directory_entries.has_capacity`. `profile_entries` is the unfiltered companion view to `directory_entries` (same columns, no listing filter; RLS still applies). `GET /api/auth/me` now returns `mentorStatus`. `release_contact(profile_id)` returns nothing to administrators beyond what a member gets (tested), so the contact route can call it directly. Never select `linkedin_url` from `profiles`; it is not granted.

**Depends on:** Task 11 (parallel with Task 12).

**Files:** Create `server/src/services/{directory,contact}.ts`, `server/src/routes/{directory,profiles}.ts`, `server/src/meta.ts`, `shared/types/directory.ts`; Modify `index.html` (add `<!--meta-->` placeholder after the existing title tag), `server/src/index.ts` (for `/network/directory/:id` call `renderMeta`); Test `server/test/services/{directory,contact}.test.ts`.

**Interfaces:**
- `GET /api/directory?q&discipline[]&tag[]&topic[]&experience[]&location&verified=1&mentoring=any|available|all&audience&participation[]&sort=relevance|name|experience|recent&page&size` → `{ items: DirectoryEntry[], total, facets: { disciplines: { id, count }[] } }`; `relevance` = `ts_rank` on `search_tsv` when `q` is set, else mentors with capacity first, then `last_active_at` desc; `name` = last name; `experience` = years desc; `recent` = `last_active_at` desc; `location` is a case-insensitive substring; returns `{ items: [], total: 0, paused: true }` when `platform_paused`.
- `GET /api/profiles/:id` → the profile without contact columns or `linkedin_url`, with `approvalState` only for the owner; `403 { code: 'members_only' }` when `profile_access` says `members_only`; `404` when `none`.
- `GET /api/profiles/:id/contact` (`requireMember`) → `{ methods: { method, value }[] }` from `release_contact`.
- `POST|DELETE /api/profiles/:id/save`.
- `renderMeta(profileId)` returns the `index.html` string with title `"<Name>, <Title> · MEST Network"`, description (first 150 characters of the bio), canonical, `og:title`, `og:description`, `og:image` (`/og.jpg`), and `robots: noindex` unless `visibility = public` and approved; unknown ids get the default tags.

- [ ] **Step 1:** Failing tests `visitor_search_public_only`, `member_search_includes_members_visibility`, `search_matches_tag_organization_and_name`, `experience_location_verified_filters`, `paused_platform_returns_empty`, `members_only_profile_returns_403_to_visitor`, `profile_pending_visible_to_owner_only`, `contact_empty_for_visitor_and_shared_only_for_member`, `meta_indexable_for_public_noindex_for_members`. Implement; PASS. Commit: `Add the directory, profile and contact reads`.

### Task 14: Onboarding screens

**Depends on:** Task 12 (parallel with Tasks 15 to 18).

**Files:** Create `src/network/features/onboarding/{Onboarding,StudentSteps,ProfessionalSteps,Review,routes}.tsx` (ported from the prototype; react-hook-form + shared schemas; draft saved in `localStorage` under `mest-onboarding-<userId>` and removed on submit and on sign-out), `src/network/ui/onboarding-*.tsx` for any new control; Test `e2e/onboarding.spec.ts`.

**Interfaces:** Fields and privacy marks per 03 section 5; mission checkbox on step 1 for both kinds; visibility step offers Public (preselected) and Members only with the hybrid explanation; contact step has "Methods I use" and "Show to signed-in members" columns, phone unchecked by default; Review posts and routes to `/network/me` (student) or `/network/me?submitted=1` (professional; Task 18's Home renders the "waiting for review" notice from `approvalState`).

- [ ] **Step 1:** e2e: a new student completes onboarding keyboard-only at 375; a new professional with mentoring on lands on `/network/me?submitted=1` and `GET /api/me/profile` returns `pending`; the draft is gone after submit.
- [ ] **Step 2:** Implement; PASS. Commit: `Add student and professional onboarding`.

### Task 15: Directory and profile screens

> **Handoff from integration (Phase 1B wave 2):** `GET /api/profiles/:id/contact` answers a visitor with `401 { code: 'unauthenticated' }` (it requires membership), not an empty list; ContactPanel shows the sign-in prompt on 401 and never calls it for an anonymous session. `ProfileView` (shared/types/directory.ts) carries the experience band, never exact years. `/network/*` pages already get a server-injected `noindex`; profile pages get their own title, description, canonical and Open Graph tags from `renderMeta(profileId, indexHtml, origin)`.

**Depends on:** Task 13 (parallel with Tasks 14, 16 to 18).

**Files:** Create `src/network/features/public/{Directory,Profile,ContactPanel,ProfileActions}.tsx` and `src/network/features/me/discover-routes.tsx` (ported; filters in URL search params; `/me/discover` renders Directory with `mentoring=available` preset and is owned here, not by Task 22; the owner's own profile shows a "Waiting for review" banner while `approvalState` is `pending`; ContactPanel shows "Sign in to see how to reach Layla" to visitors and the shared methods with copy buttons to members; `ProfileActions` renders the request buttons as "Available soon" tags with a `slot` prop that Task 22 fills, and a `reportSlot` that Task 24 fills); Test `e2e/directory.spec.ts`.

- [ ] **Step 1:** e2e against the seed: visitor `total` 14, member `total` 15 (Tariq Mansour is members-only), search "coastal" includes Layla, discipline facet counts match the cards, the 375 filter sheet applies, Tariq's profile shows the members-only screen to a visitor and the profile to a member, a member sees Layla's shared methods and a visitor sees the sign-in prompt; `curl /network/directory/<layla id>` contains her name in `<title>`.
- [ ] **Step 2:** Implement; PASS. Commit: `Add the directory and profile pages`.

### Task 16: Settings screens

> **Handoff from integration (Phase 1B wave 2):** `GET /api/me/preview?as=visitor|member` returns `{ as, access, profile?, contact? }` where `profile` is the same `ProfileView` a viewer gets from `GET /api/profiles/:id` (without `approvalState`, with approved tags only), so render the preview with Task 15's profile components. `GET|PATCH /api/me/settings` shapes are in shared/types/me.ts; a refused status change rolls the whole patch back (409 with the code).

**Depends on:** Task 12 (parallel with Tasks 14, 15, 17, 18).

**Files:** Create `src/network/features/settings/{Layout,ProfileSettings,PrivacySettings,MentorshipSettings,NotificationSettings,Preview,routes}.tsx` (ported from the prototype's edit, availability and settings screens; one settings area for every member; Preview uses `GET /api/me/preview`; `routes.tsx` leaves an `account` child route rendering a stub that Task 26 replaces); Test `e2e/settings.spec.ts`.

- [ ] **Step 1:** e2e (sign in via `dev-login`): Layla pauses mentorship with a resume date and her profile shows Paused; she adds `phone` to "Show to signed-in members" and a member sees it while a visitor does not; the preview-as-visitor hides it.
- [ ] **Step 2:** Implement; PASS. Commit: `Add member settings`.

### Task 17: Administration area

> **Handoff from integration (Phase 1B wave 1):** Read `server/migrations/0004_profiles.sql` before writing SQL against it. Enum array columns (`participation`, `audience`, `methods`, `share_with_members`) come back from `pg` as strings like `'{email}'`; cast them to `text[]` in every select (the views already do). `mentorship_settings.max_active` is column-withheld from requests; the owner reads it through `my_mentorship_settings()`, everyone else through `directory_entries.has_capacity`. `profile_entries` is the unfiltered companion view to `directory_entries` (same columns, no listing filter; RLS still applies). `GET /api/auth/me` now returns `mentorStatus`. Use the admin functions from 0004 as they are: `admin_review_profile`, `admin_set_verified`, `admin_hide_profile`, `admin_restore_profile` (a profile whose owner dropped mentoring while hidden comes back with mentoring off), `admin_grant`, `admin_revoke`, `admin_review_tag`, `admin_add_vocabulary(kind, id, label, group_name default null)`, `admin_list_members(page, size, q)` and the `admin_dashboard` view. Members can no longer insert expertise tags directly. Administrators have no contact access; do not add any.

**Depends on:** Task 11 (parallel with Tasks 12 to 16, 18).

**Files:** Create `server/src/services/admin.ts`, `server/src/routes/admin.ts`, `shared/types/admin.ts`, `src/network/features/admin/{Overview,Approvals,ReviewDrawer,Members,Admins,Vocabulary,Mentorship,Settings,routes}.tsx` (`routes.tsx` includes a `reports` child rendering a stub that Task 24 replaces); Test `server/test/services/admin.test.ts`, `e2e/admin.spec.ts`.

**Interfaces:** Routes under `/api/admin/*` (`requireAdmin`), all paged where they list: `GET /dashboard`, `GET /reviews?status`, `POST /reviews/:id` `{ decision, notes }`, `POST /profiles/:id/verified` `{ method | null }`, `POST /profiles/:id/hide`, `POST /profiles/:id/restore`, `GET /members?q` (via `admin_list_members`), `GET|POST|DELETE /admins`, `GET /tags?status`, `POST /tags/:id` `{ decision }`, `POST /vocabulary` `{ kind, id, label }`, `PATCH /config`. `Mentorship.tsx` shows the request measures once Task 25 lands (placeholder text until then).

- [ ] **Step 1:** Failing tests `review_approve_lists_and_notifies`, `review_decline_keeps_hidden_with_notes`, `members_list_has_no_email`, `config_update_audited`, `non_admin_403`. Implement; e2e: approve Dawud Jenkins (appears in directory), decline Musa Grant (owner sees notes). Commit: `Add the administration area`.

### Task 18: In-app notifications and the member home

**Depends on:** Task 12 (parallel with Tasks 14 to 17). Mounts the Bell through Task 8's `headerSlot` without editing `shells.tsx`.

**Files:** Create `server/src/services/notifications.ts`, `server/src/routes/notifications.ts`, `shared/types/notifications.ts`, `src/network/features/notifications/{List,Bell,routes}.tsx`, `src/network/features/me/{Home,routes}.tsx`; Test `server/test/services/notifications.test.ts`.

**Interfaces:** `GET /api/notifications?unread=1&page&size` → `{ items: { id, category, title, body, link, createdAt, readAt }[], total, unread }`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`; Home shows the profile status banner ("Waiting for review" when `pending`, with the review notes when `declined`), the latest notifications and, from 1C, request counts from `GET /api/me/mentorship`.

- [ ] **Step 1:** Failing tests `recipient_only_reads`, `mark_read_only_own`. Implement; PASS. Commit: `Add in-app notifications and the member home`.

### Phase 1B gate

All suites; e2e at 375 and 1280; audits (contact rules, student invisibility, admin masking). Demo: three fictional professionals through onboarding, queue and directory at the three visibility levels; member sees shared methods, visitor does not. Stop.

---

## Phase 1C: Mentorship and moderation

### Task 19: Requests and relationships: schema, functions, lifecycle functions, routes

> **Handoff from integration (Phase 1B wave 2):** Strengthen `lowering_max_active_keeps_relationships` (server/test/services/profiles.test.ts): add an accepted mentee, lower `maxActive` below the active count, and assert the relationship survives and new accepts are refused with `mentor_full`. When re-creating `release_contact` and `profile_access`, update `preview_my_contact()` and `preview_my_access(viewer)` in `0004_self_reads.sql` to match (the preview copies their rules), with a test comparing the preview against what a second member actually gets for pending, hidden, members-only, public and admin-hidden profiles.

> **Handoff from integration (wave 2):** When re-creating the profiles policies with the counterparty case, also `CREATE OR REPLACE profile_access(id)` so a counterparty gets `visible` rather than `none`, with a test.

**Depends on:** Phase 1B complete.

**Files:** Create `server/migrations/0005_requests.sql`, `server/src/services/requests.ts`, `server/src/routes/requests.ts`, `server/seed/requests.ts`, `shared/types/requests.ts`; Test `server/test/services/requests.test.ts`, `server/test/policies/requests.test.ts`.

**Interfaces:**
- Tables `mentorship_requests` (with `kind request_kind`, `reminders_sent`), `mentorship_relationships`; partial unique index `(mentee_id, mentor_id) WHERE status IN ('pending','accepted')`; `is_counterparty(uuid)`; profile and `student_details` policies re-created to include counterparties; `release_contact` re-created to add an accepted relationship's `shared_methods`; view `my_requests` (both directions, counterparty public fields only).
- Functions, all `SECURITY DEFINER`: `create_mentorship_request(mentor uuid, kind, topic text, why, goals, format, mode, scheduling_note)` checking in order under `SELECT ... FOR UPDATE` on the mentor's settings row: `platform_paused`, mentor listed and member, `mentorship` kind: status `active`, topic offered, `accepted` count < `max_active`; `introduction` kind: `networking` in participation; caller pending count < `pending_cap`; no pending or accepted pair; daily count < `daily_request_limit`; raises `mest.<code>` for `platform_paused | mentor_unavailable | topic_not_offered | mentor_full | pending_cap | duplicate | rate_limited`; sets `expires_at`; notifies the mentor (`request`, template `request-received`, email). `cancel_request(request_id)` (mentee; notifies mentor in-app only). `respond_to_request(request_id, decision, note, decline_reason, share_methods contact_method[])` (pending only; mentor only; `share_methods ⊆ methods with a value`; on accept re-checks capacity under lock and creates the relationship; notifies the mentee `response`, template `request-accepted` or `request-declined`, email). `complete_relationship(request_id)` (either party; resolves the relationship from the request; notifies the other, in-app only). `get_request_handoff(request_id)` (mentee of an accepted request; returns the `shared_methods` values via `release_contact`'s resolution; audits `contact.viewed`). Lifecycle functions for Task 21's jobs: `expire_request(request_id)`, `send_request_reminder(request_id, n)`, `resume_mentor(profile_id)`, `purge_request_text(before timestamptz)`.
- Routes: `GET /api/requests?role=mentee|mentor&status&page&size` → `{ items: RequestSummary[], total }`; `POST /api/requests`; `GET /api/requests/:id` (parties only; includes `handoff` for the accepted mentee); `POST /api/requests/:id/{cancel,respond,complete}` (`:id` is always the request id); `GET /api/mentors/:id/availability` → `{ state: 'off' | 'networking_only' | 'paused' | 'full' | 'taking', resumeOn? }` evaluated in that order; `GET /api/me/mentorship` → `{ status, maxActive, activeCount, pendingIncoming, pendingOutgoing }`; `GET /api/me/suggested-mentors` → up to 3 available mentors scoring topic and audience overlap with the caller's student details, excluding mentors with an open pair row.

- [ ] **Step 1:** Failing tests: one per error code; `accept_creates_relationship_and_shares_methods`; `concurrent_accept_respects_cap`; `handoff_only_for_accepted_mentee`; `student_visible_to_mentor_of_pending_request`; `cancel_and_complete_notify_in_app_only`; `set_kind_keeps_requests`; `availability_precedence`; `lifecycle_functions_transition_once`.
- [ ] **Step 2:** Implement; PASS; `seed/requests.ts` inserts the prototype's requests and relationships. Commit: `Add mentorship requests and relationships`.

### Task 20: Email templates

**Depends on:** Task 19 (parallel with Task 21).

**Files:** Create `server/src/email/templates/{request-received,request-reminder,request-accepted,request-declined,request-expired,profile-submitted,profile-approved,profile-declined,profile-verified,report-received,report-status,moderation-action,deletion-requested,deletion-canceled,admin-digest}.ts` and register them in a new `server/src/email/templates/all.ts` imported by `registry.ts`'s consumers; Test `server/test/email/privacy.test.ts`.

**Interfaces:** Each template receives the `payload` its `create_notification` caller stores (names, topic label, dates, reason, link) and carries nothing else. Callers from Tasks 11, 19, 21, 24 and 26 already name these templates; until this task lands they render through `default`.

- [ ] **Step 1:** `privacy.test.ts` renders every template with the seeded Amina to Layla request and asserts the seeded `why`, `goals`, `scheduling_note`, Amina's seeded email address (read from `SEED`) and Layla's seeded phone are absent from subject, text and html.
- [ ] **Step 2:** Implement; PASS. Commit: `Add the email templates`.

### Task 21: Lifecycle jobs: expiry, reminders, resume, retention, digest

**Depends on:** Task 19 (parallel with Task 20).

**Files:** Create `server/src/jobs/{expire-requests,reminders,resume-paused,retention,digest}.ts`, `server/migrations/0006_jobs.sql` (function `admin_digest()`); Test `server/test/jobs/lifecycle.test.ts`. Migration numbering from here: 0006 jobs (Task 21), 0007 reports (Task 24), 0008 dashboard (Task 25), 0009 deletions (Task 26).

**Interfaces:** Jobs only select ids and call Task 19's functions: `expire-requests` (`everyMs` 3 600 000; pending past `expires_at` → `expire_request`, which sets `expired`, notifies the mentee `response` with `request-expired`, email, and audits), `reminders` (86 400 000; pending requests older than `reminder_days[n]` days with `reminders_sent = n` → `send_request_reminder(id, n)`), `resume-paused` (86 400 000; `paused_until <= now` → `resume_mentor`), `retention` (86 400 000; `purge_request_text(now - retention_months)`), `admin-digest` (86 400 000, but runs `admin_digest()` only when `job_runs.last_run_at` for it is older than 7 days, so at most once a week; one `admin_digest` notification per active admin with queue size, open reports, requests waiting, oldest waiting). All take the scheduler's `now`.

- [ ] **Step 1:** Failing tests `expiry_at_day_14_once`, `reminders_at_day_5_and_10_exactly_once`, `resume_paused_on_date`, `retention_empties_text_after_24_months`, `digest_one_per_admin_at_most_weekly`. Implement; PASS. Commit: `Add the request lifecycle, retention and digest jobs`.

### Task 22: Mentee screens

> **Handoff from integration (Phase 1B wave 3):** Task 15 owns `src/network/features/public/directory-routes.tsx` and `src/network/features/me/discover-routes.tsx`; pass the request buttons as `slot` to `<Profile>` in both (a ReactNode or `(profile: ProfileView) => ReactNode`). `ProfileActions` already treats a signed-in account with `kind === null` as "finish joining"; keep that branch. Use the query key `["me", "profile"]` for `GET /api/me/profile` (onboarding invalidates `["me"]`).

**Depends on:** Task 19 (parallel with Tasks 20, 21, 24).

**Files:** Create `src/network/features/me/{RequestForm,Requests,RequestDetail,Saved,RequestActions,mentee-routes}.tsx` (ported from the prototype; `RequestActions` fills Task 15's `ProfileActions` slot with the real buttons using `GET /api/mentors/:id/availability`; `RequestForm` maps every `409` code to the prototype's gating copy; `RequestDetail` shows the handoff for accepted requests and `GET /api/me/suggested-mentors` on decline or expiry); Test `e2e/request-flow-mentee.spec.ts`.

- [ ] **Step 1:** e2e: Amina sends a request to Layla; a fourth pending request shows the cap message; a second request to Layla shows the duplicate message; a request to Fatima (paused) is refused and her profile shows Paused; an introduction request to Ibrahim (networking, not mentoring) succeeds.
- [ ] **Step 2:** Implement; PASS. Commit: `Add the mentee request flow`.

### Task 23: Mentor screens

**Depends on:** Task 22.

**Files:** Create `src/network/features/mentor/{Dashboard,Requests,RequestDrawer,Mentees,Relationship,routes}.tsx` (ported; Dashboard and the capacity line read `GET /api/me/mentorship`; Mentees reads `GET /api/requests?role=mentor&status=accepted`; the accept sheet lists the mentor's methods with checkboxes prefilled from `share_with_members` and the A5 line "Meet in public places; MEST does not supervise meetings"); Test `e2e/request-flow-mentor.spec.ts` (creates its own request through the API in `beforeAll`).

- [ ] **Step 1:** e2e: Layla accepts sharing email; Amina's detail shows Accepted and the email value; another member gets 404 on that request; Layla marks it complete; her capacity line drops by one.
- [ ] **Step 2:** Implement; PASS. Commit: `Add the mentor inbox and relationship screens`.

### Task 24: Reports and moderation

**Depends on:** Task 19 (parallel with Tasks 20 to 22); its UI parts depend on Tasks 15 and 17 (already merged).

**Files:** Create `server/migrations/0007_reports.sql` (`reports`; view `admin_requests` masking `why`, `goals`, `scheduling_note`, `mentor_note` unless an open report references a party; `admin_dashboard` re-created with open reports; functions `report_profile`, `admin_resolve_report`), `server/src/services/reports.ts`, `server/src/routes/reports.ts` (member `POST /api/profiles/:id/report`; admin `GET /api/admin/reports`, `POST /api/admin/reports/:id/resolve`, `GET /api/admin/requests`), `server/seed/reports.ts`, `shared/types/reports.ts`, `src/network/features/public/ReportDialog.tsx` (fills Task 15's `reportSlot`), `src/network/features/admin/Reports.tsx` (replaces Task 17's stub by editing `features/admin/routes.tsx`); Test `server/test/services/reports.test.ts`, `e2e/reports.spec.ts`.

**Interfaces:** `report_profile(profile_id, reason, detail)` rate limited by `daily_report_limit`; notifies admins (`report`, template `report-received`). `admin_resolve_report(id, status, note, action)` with `action` in `none | hide_profile | suspend_requests | remove_account`: `hide_profile` calls `admin_hide_profile`; `suspend_requests` sets `users.suspended_at` and notifies the member (`account`, template `moderation-action`, no reporter identity); `remove_account` raises `mest.not_available` until Task 26 re-creates the function to call `request_account_deletion(immediate := true, reason)`. Reporter gets a `report` status notification (template `report-status`) without the note; the reported member never learns the reporter.

- [ ] **Step 1:** Failing tests `report_rate_limited`, `reported_member_cannot_read_report`, `resolve_hide_removes_from_directory_and_pauses_mentoring`, `suspend_blocks_request_creation`, `reporter_status_without_note`, `admin_requests_masks_text_unless_reported`. Implement; e2e: report Bilal Chowdhury (approved in the seed), resolve with hide, his card disappears; restore brings it back. Commit: `Add profile reports and moderation`.

### Task 25: Dashboard measures

**Depends on:** Task 24.

**Files:** Create `server/migrations/0008_dashboard.sql` (re-create `admin_dashboard` adding: requests sent, answered within 7 days percentage, acceptance rate, expiry rate, active relationships, completed, median hours to approval, median paused days, members inactive 6 months, requests by topic); Modify `src/network/features/admin/{Overview,Mentorship}.tsx`; Test `server/test/services/admin.test.ts` (`dashboard_matches_hand_counts`).

- [ ] Implement; PASS. Commit: `Add the mentorship activity measures to the dashboard`.

### Phase 1C gate

All suites; e2e loop end to end with every email printed by the development mailer; audits (handoff, concurrency, admin masking, email privacy). Demo: Amina to Layla from creation to completion; a report handled. Stop.

---

## Phase 1D: Launch hardening

### Task 26: Account deletion with grace period and the sweep

> **Handoff from integration (wave 5):** The grace screen (`src/network/features/auth/ScheduledForDeletion.tsx`, built by Task 9) shows no date because `GET /api/auth/me` carries only `hasDeletionScheduled`. Add the `execute_after` date (to the me response or a small endpoint), show "Your account is scheduled for deletion on [date]" per 02 section 8 step 3, and wire its disabled Keep my account button.

> **Handoff from integration (wave 2):** `visibility` is an ordinary owner column, so an owner could set it back to `public` during the grace period. Guard it: while an open `account_deletions` row exists, the owner-guard trigger rejects visibility changes (or the listing rule excludes profiles with an open deletion through a definer helper), with a test.

**Depends on:** Phase 1C complete.

**Files:** Create `server/migrations/0009_deletions.sql` (functions `request_account_deletion(immediate boolean, reason text)`, `cancel_account_deletion()`, `execute_account_deletion(id)`; `CREATE OR REPLACE admin_resolve_report` so `remove_account` works), `server/src/services/account.ts`, `server/src/routes/account.ts` (`POST /api/me/deletion`, `DELETE /api/me/deletion`), `server/src/jobs/deletions.ts` (86 400 000 ms; calls `execute_account_deletion` for due rows), `src/network/features/settings/Account.tsx` (replaces Task 16's stub by editing `features/settings/routes.tsx`); Modify `src/network/features/auth/ScheduledForDeletion.tsx` (wire Keep my account); Test `server/test/services/account.test.ts`.

**Interfaces:** Per 02 section 8 as revised in Task 1: request hides, sets mentorship `off`, cancels sent pending, declines received pending with reason `member_left` (mentee notified, no name later than the tombstone), notifies `account`; cancel restores `previous_visibility`; the sweep anonymizes the profile ("Former member"), deletes per-member tables, blanks request text, keeps counts, sets `users.email = null, deleted_at = now()`, deletes sessions, `auth_tokens` and `email_outbox` rows for that address, audits `account.deleted`.

- [ ] **Step 1:** Failing tests `deletion_hides_immediately_and_cancels_sent`, `deletion_declines_received_pending`, `cancel_restores_visibility`, `sweep_leaves_no_personal_field_and_keeps_request_counts`, `signin_during_grace_routes_to_deletion_screen`. Implement; PASS. Commit: `Add account deletion with a grace period`.

### Task 27: Data export

> **Handoff from the Phase 1A audit:** `audit_log` is administrator-read only, and routes may not use `withSystem`. Add a definer function `my_audit_entries()` returning the caller's rows (`subject_id = app_uid()`, `detail` already stripped), granted to `app_user`, and use it for the export's audit section, with a test that another member's entries never appear.

**Depends on:** Phase 1C complete (parallel with Task 26).

**Files:** Create `server/src/services/export.ts`, `server/src/routes/export.ts` (`GET /api/me/export`, JSON attachment: profile, settings, requests in both directions with the counterparty as a display name, relationships, notifications, audit entries about the caller); Test `server/test/services/export.test.ts` (`export_contains_own_data_and_only_display_names_for_others`).

- [ ] Implement; PASS. Commit: `Add the personal data export`.

### Task 28: Accessibility, overflow, performance pass

> **Deferred from the Phase 1B reviews (do these here):** (1) The profile page has no sticky action bar on phones (03 section 12); its actions sit in the profile header. Add the bar below 768px. (2) The admin members list searches by name only; 03 also lists kind, approval, mentor status, verified and region filters, which need `admin_list_members` to grow parameters. (3) Onboarding prefills "mentees at once" with 3 rather than `config.default_max_active`; expose the default in `GET /api/config/public` and prefill from it. (4) Mentorship topic choices in settings and onboarding come from `shared/taxonomy.ts`, so a topic an administrator adds is not offered; add a public vocabulary read and use it.

> **Handoff from integration (Phase 1B wave 2):** `directory_entries.search_tsv` is the concatenation of `profiles.search_tsv` and `professional_details.search_tsv`, so no GIN index can serve `search_tsv @@ query` against the view, and step 2's EXPLAIN check will fail as written. Match the base columns (`p.search_tsv @@ q OR d.search_tsv @@ q`, exposed through the view) or keep one combined indexed column, then re-run the EXPLAIN.

**Depends on:** Tasks 26 and 27.

**Files:** Create `e2e/a11y.spec.ts` (axe on every route at 375 and 1280, zero serious or critical), `e2e/no-overflow.spec.ts`; Modify screens as findings require.

- [ ] **Step 1:** Specs written; fix every finding; PASS.
- [ ] **Step 2:** `GET /api/directory?q=coastal` under 300 ms locally on the seed and `EXPLAIN` uses the GIN index.
- [ ] **Step 3:** Commit: `Pass the accessibility and overflow checks`.

### Task 29: Runbook, deployment files, prototype removal

> **Handoff from the Phase 1A audit:** The runbook must cover creating the request login: `ALTER ROLE mest_request PASSWORD '<generated>'` on the Railway database and setting `REQUEST_DATABASE_URL` (same host and database, user `mest_request`); the server refuses to start in production without it.

> **Handoff from integration (wave 3):** The runbook must tell the operator to confirm, on the live Railway service, how many proxies append to `X-Forwarded-For` (send a request with a fake leading entry and read the stored `auth_tokens.ip`), and set `TRUST_PROXY=true` and `TRUST_PROXY_HOPS` to match. The per-IP magic-link limit depends on it.

**Depends on:** Task 28.

**Files:** Create `docs/professional-network/runbook.md` (accounts and holders; Railway project, Postgres and variables from `.env.example`; Resend domain records; Google OAuth redirect `APP_ORIGIN/api/auth/google/callback`; `npm run admin:grant -- email`; weekly `pg_dump` and restore; `config.platform_paused`; deletion requests by email; rotating `SESSION_SECRET`; incident steps), `server/src/cli/admin-grant.ts`; Delete `src/preview/` and the prototype gate in `src/main.tsx`; Modify `README.md`, `docs/professional-network/README.md`.

- [ ] **Step 1:** Remove the prototype; `npm run typecheck && npm run build && npm run e2e` PASS. Commit: `Add the runbook and remove the prototype`.

### Phase 1D gate (release candidate)

Everything above plus the Docker image running against the local database with `JOBS_ENABLED=true` for 10 minutes without errors; audits on the whole branch. Stop. Deploying to Railway is a runbook step you run with your accounts; the same image is the soft-launch build.

---

## Verification (end to end)

- Local: `docker compose up -d`, `npm run migrate`, `npm run seed`, `npm run dev:all`.
- Server: `npm run test:server`. Web and server types: `npm run typecheck`. Build: `npm run build && npm run build -w server`.
- End to end: `npm run e2e` (seeded database, development mailer, `dev-login` and `dev-last-link` under `NODE_ENV=test`, 375 and 1280).
- Image: `docker build -t mest . && docker run --env-file .env -p 8787:8787 mest`; then `/api/health`, `/`, `/network/directory`, a 404 for `/nothing`.

## Out of scope for Phase 1

Phase 2 scheduling and meetings, photos, feedback, member digests, iCal, chapters, Sentry. The prototype's meeting screens are not ported. The untracked root files (`.openai/`, `MEST-PREMIUM-DESIGN-AUDIT.md`, `mest-concept.html`) stay untouched.
