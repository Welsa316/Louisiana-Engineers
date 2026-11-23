# Open questions: Professional Directory, Networking and Mentorship Platform

This document lists the product and technical choices for the member platform of Muslim Engineers in Science & Tech (MEST), what has been decided, and what is still open. Each question states why it matters, the options, the recommended default, who decides, and its status. Where a default is in use without a board decision, the implementer builds the default so that the plan in [06-build-plan-phase-1.md](06-build-plan-phase-1.md) is not blocked; every default is changeable later, and most are a row in the `config` table described in [02-technical-architecture.md](02-technical-architecture.md).

Decisions made before these documents were written (passwordless sign-in, approval queue for professionals, platform-mediated requests with handoff on accept, 14-day expiry, 3 pending requests, default maximum of 3 active mentees, 14-day deletion grace) are recorded in [01-product-requirements.md](01-product-requirements.md) and [02-technical-architecture.md](02-technical-architecture.md) and are not reopened here. The hosting decision (Supabase in the first draft) was reopened and is settled below.

People named as examples come from the prototype's `src/preview/network/data/mock.ts` and are fictional.

## Decisions recorded 2026-11-23

Taken by the organizer in the build-planning round, ahead of the first implementation phase. They supersede the recommended defaults below where they differ, and the architecture document has been revised to match.

| Question | Decision |
| --- | --- |
| Hosting (A11, T2, T6, T8, T15) | Everything on Railway: one Node service (API and static frontend) and Railway Postgres. No Supabase. Sentry deferred to Phase 2. Jobs run inside the service; local development uses Docker Compose; Resend is called from the service's outbox job |
| Where the platform lives (A10) | Paths under `/network/...` on the main domain. The service serves `index.html` for unknown `/network/*` paths only; any other unknown path is a real 404 |
| Default visibility (A1) | Hybrid. Approved professionals are `public` by default: name, title, organization, discipline, expertise, bio, education and the mentorship offer are visible to everyone. Contact details (email, LinkedIn, booking link, phone) are visible only to signed-in, email-verified members, and only the methods the professional opted to share (`contact_preferences.share_with_members`). Phone is never shared unless opted in. `members` and `hidden` remain as opt-outs |
| Contact on accept | A mentor can additionally share methods with an accepted mentee (the handoff), as the documents describe |
| Members under 18 (A4) | Allowed, no special rules, no age gate. `high-school` stays an audience value |
| Eligibility (A2, A3) | Members confirm the mission statement from `src/content/site.ts` at sign-up. Open to all; the approval queue is the human gate for professionals |
| Numbers (A8) | 14-day expiry, 3 pending per mentee, default `max_active` 3; all rows in the `config` table |
| Indexing (A6) | Public profiles are indexable: the server injects title, description and Open Graph tags into `index.html` for `/network/directory/:id`; everything else is `noindex` |
| Name (A14) | The landing header link says "Directory"; app titles say "MEST Network" |
| Phase gates | The build stops after each of Phases 1A, 1B, 1C and 1D for the organizer's review |

## Using the default until the board decides

These remain board decisions. The first release builds the recommended default for each so the work is not blocked, and the board can change any of them without a schema change.

| Question | Default in use | What the board would change |
| --- | --- | --- |
| A5 In-person meeting guidance | Community guidelines page plus the one-line reminder in the accept sheet: "Meet in public places; MEST does not supervise meetings" | The wording, or a fuller code of conduct members sign |
| A7 Who the administrators are | Two or three board-authorized volunteers, reviewed yearly; the platform refuses to drop below two | The names, and the review cadence |
| A9 Data retention periods | Request free text emptied after 24 months (`config.retention_months`); audit log kept indefinitely | The numbers, which appear in the privacy notice |
| A12 Legal documents | Draft community guidelines and privacy notice written in Phase 1A from the architecture document's facts, tagged "Draft for board review" | Review, edits and sign-off; a volunteer with legal background if available |
| A13 Mentor recognition | No recognition features | An optional "mentoring since" line, if mentors ask |

## Part A: Decisions that need board approval

These shape who may join, what is public and what MEST is responsible for. The implementer should not decide them alone. Each carries its status as of 2026-11-23.

### A1. Default directory visibility for an approved professional

**Why it matters.** The default is what most members will keep. `public` makes the directory useful to visitors and search engines and grows the organization; `members` protects people who did not think about the open web when they signed up.

**Options.** (a) `public`; (b) `members`; (c) ask during onboarding with no preselected option.

**Recommended default.** (c) for the first release: the onboarding step shows the choices with plain explanations and no preselection, so every listing is a deliberate choice. If the board wants a default, `members`.

**Decides.** Board.

**Status.** Decided 2026-11-23: hybrid. `public` is preselected, and the onboarding copy explains that the profile may appear in search results while contact details stay behind sign-in and behind the member's own "Show to signed-in members" choices. The split between the profile and its contact layer is what makes `public` a safe default.

### A2. Eligibility statement at sign-up

**Why it matters.** The landing page describes MEST as a community for Muslim engineers, scientists, technologists and students. The platform needs one sentence that members acknowledge at step 1 of onboarding, and administrators need to know what the approval queue is checking for.

**Options.** (a) Restate the mission and ask members to confirm they are part of the community it describes; (b) a stricter membership requirement (see A3); (c) no statement, approval queue only.

**Recommended default.** (a), using the existing mission wording from `site.ts` so there is one voice.

**Decides.** Board.

**Status.** Decided 2026-11-23: (a). The checkbox text is `mission.statement` from `src/content/site.ts`, and `profiles.mission_accepted_at` records the confirmation.

### A3. Must platform members be MEST members?

**Why it matters.** If MEST has or plans a formal membership (dues, a roster), the directory could be a member benefit. The platform does not process money, so any check would be manual.

**Options.** (a) Open to anyone who meets the eligibility statement and passes the queue; (b) administrators check a roster before approving; (c) open now, member-only later.

**Recommended default.** (a). There is no roster to check today, and the queue already provides a human look at every professional.

**Decides.** Board.

**Status.** Decided 2026-11-23: (a).

### A4. Members under 18

**Why it matters.** "High school students" is an audience in the vocabulary, and Idris Fofana, a fictional high school senior, is one of the prototype's mentees. Minors on a platform that leads to in-person meetings with adults carry legal and safeguarding duties MEST must choose to accept or not.

**Options.** (a) Members must be 18 or older; high school outreach stays at MEST events; (b) allow 16 and 17 year olds with a guardian's email on file and online-only mentorship; (c) allow with no special rules.

**Recommended default.** (a) for the first release, with the high-school audience kept in the vocabulary so mentors can say they are willing, and a note on the Network home page that students under 18 can meet mentors at events.

**Decides.** Board, with legal advice if (b) is considered.

**Status.** Decided 2026-11-23: (c), against the recommendation. No age gate, no guardian field, no online-only rule. The A5 conduct line applies to every relationship. The board may revisit this; the schema can add an `is_minor` flag on `student_details` and extra rules in `create_mentorship_request` without changing existing rows.

### A5. In-person meeting guidance and code of conduct

**Why it matters.** Mentors like Khalid Boudreaux (fictional) offer in-person meetings. MEST is introducing two people who may not know each other. A short conduct statement protects both and sets expectations.

**Options.** (a) Community guidelines page plus a one-line reminder in the accept sheet ("Meet in public places; MEST does not supervise meetings"); (b) a full code of conduct members sign; (c) nothing beyond the guidelines page.

**Recommended default.** (a).

**Decides.** Board.

**Status.** Using the default until the board decides.

### A6. Search engine indexing of public profiles

**Why it matters.** Indexing makes "Muslim coastal engineer New Orleans" find Layla Haddad's fictional counterpart and grows the directory. It also means a member's name and employer appear in search results under MEST's domain.

**Options.** (a) Index `public` profiles; (b) index the directory page but not individual profiles; (c) `noindex` everything.

**Recommended default.** (a), because `public` is a deliberate choice under A1 and the onboarding copy says plainly "may appear in search results".

**Decides.** Board.

**Status.** Decided 2026-11-23: (a). The server injects the title, description, canonical and Open Graph tags for `/network/directory/:id` when the profile is `public` and approved; every other page sends `noindex`.

### A7. Who the administrators are and how they are authorized

**Why it matters.** Administrators see the approval queue, reports and the moderation actions. The platform enforces a minimum of two.

**Options.** (a) Two or three board-authorized volunteers, reviewed yearly; (b) all board members; (c) a single administrator (not supported by the schema).

**Recommended default.** (a). Fewer people with access is better, and yearly review is a calendar entry.

**Decides.** Board.

**Status.** Using the default until the board decides. The first two administrators are created with the `admin:grant` command line tool at launch.

### A8. Request expiry, pending cap and default capacity: confirm the numbers

**Why it matters.** 14 days, 3 pending and 3 active are defaults chosen by reasoning, not data. They live in the `config` table and can change without a release, but the board should own them.

**Options.** Keep; shorten expiry to 10 days; raise the pending cap to 5.

**Recommended default.** Keep for the first three months, then read the dashboard (expiry rate, answered-within-7-days) and adjust.

**Decides.** Board confirms; implementer makes the defaults configurable.

**Status.** Decided 2026-11-23: keep. `request_expiry_days 14`, `pending_cap 3`, `default_max_active 3`, with `reminder_days [5, 10]`, `daily_request_limit 5` and `daily_report_limit 3` alongside them in `config`.

### A9. Data retention periods

**Why it matters.** The architecture proposes emptying the free text of expired and declined requests after 24 months and keeping the audit log indefinitely. Retention is a promise made in the privacy notice.

**Options.** 12, 24 or 36 months for request text; audit log 5 years or indefinite.

**Recommended default.** 24 months for request text; audit log indefinite (it holds no contact values).

**Decides.** Board, since it appears in the privacy notice.

**Status.** Using the default until the board decides (`config.retention_months 24`).

### A10. Where the platform lives

**Why it matters.** A subdomain (for example a `network.` prefix on MEST's domain) separates the app from the landing page and simplifies hosting rules; a path (`/network`, `/app`) keeps one domain and one header. The sitemap in [03-ux-information-architecture.md](03-ux-information-architecture.md) assumes paths.

**Options.** (a) Paths on the main domain; (b) a subdomain.

**Recommended default.** (a), because the landing page header should lead straight into the directory with no visible seam.

**Decides.** Board, since it involves the domain; the implementer advises.

**Status.** Decided 2026-11-23: (a). One Railway service serves the landing page at `/` and the app under `/network/*`, so there is no second host and no rewrite rule to configure.

### A11. Budget for paid tiers

**Why it matters.** Hosting has a monthly cost. Resend's free tier is enough for the expected volume. A domain and a Google Cloud project are free or near free.

**Options.** (a) A paid managed backend from soft launch; (b) a free tier with a keep-alive job and weekly dumps; (c) a free tier, accept the pause risk.

**Recommended default.** (a). A directory that is asleep when a student opens it costs more than the subscription.

**Decides.** Board.

**Status.** Decided 2026-11-23: the platform runs on the organizer's existing Railway account (one service and the Postgres plugin), which has no idle pause. The monthly amount is usage-based and small at this scale; the runbook records where to read it.

### A12. Legal documents and responsibility

**Why it matters.** The privacy notice must name who is responsible for the data (MEST as an organization), what is collected, who sees it, retention and how to leave. The community guidelines set behaviour. Both need an owner.

**Options.** (a) Drafts written during Phase 1A, reviewed by the board and, if available, a volunteer with legal background; (b) adapt a template from a comparable nonprofit.

**Recommended default.** (a); the architecture document already contains the facts the notice must state.

**Decides.** Board.

**Status.** Using the default until the board decides. The drafts are the `/network/guidelines` and `/network/privacy` pages, tagged "Draft for board review".

### A13. Mentor recognition

**Why it matters.** Mentors are volunteers. Some organizations thank them publicly (a "mentor since 2026" mark, a yearly list); others keep it quiet. This affects what the profile shows.

**Options.** (a) No recognition features; (b) an optional "mentoring since" line the mentor can turn on; (c) public counts of mentees helped.

**Recommended default.** (a) in the first release; (b) is cheap later if mentors ask. (c) is not recommended; it turns mentoring into a score.

**Decides.** Board.

**Status.** Using the default until the board decides.

### A14. Name of the product

**Why it matters.** "Professional Directory, Networking and Mentorship Platform" is a description, not a name members will say. The header has one slot for it.

**Options.** "Directory"; "MEST Network"; "Members"; something else.

**Recommended default.** The header link says "Directory" (it is what visitors want) and the signed-in area says "MEST Network" in its title. Changeable in `site.ts`.

**Decides.** Board.

**Status.** Decided 2026-11-23: the recommended default.

## Part B: Technical decisions the implementer can make

These do not change what members experience in a way the board needs to weigh. Each is recorded in the architecture document; the status line says what was settled on 2026-11-23.

### T1. Router: React Router 7 (library mode) or TanStack Router

**Why it matters.** Both work with Vite. React Router is more widely known, which matters for volunteer turnover; TanStack Router has typed routes and search params, which the directory filters would use.

**Decision.** React Router 7 in library mode, for the larger pool of people who know it. Directory filters live in URL search params by hand. Revisit only if that becomes painful.

### T2. SPA fallback and public-profile meta tags

**Why it matters.** Deep links such as `/network/directory/:id` must serve `index.html`, and public profiles need server-side meta tags for A6 to work for social previews.

**Decision.** The Node service serves `index.html` for `/`, `/network` and unknown `/network/*` paths, injects the meta tags for `/network/directory/:id`, and answers a real 404 for every other unknown path. No static host rewrite rules are involved.

### T3. Keyword search implementation

**Why it matters.** DIR-3 searches name, title, organization, expertise and bio. Options are `ILIKE`, Postgres full-text search with a `tsvector` column, or `pg_trgm` for typo tolerance.

**Decision.** Full-text search with trigger-maintained `search_tsv` columns and GIN indexes; add `pg_trgm` for names only if testers report misses on spelling variants (Touré, Yılmaz).

### T4. Expertise tags: curated with proposals, or free text

**Why it matters.** Free text produces "Hydraulic modeling", "hydraulic modelling" and "Hydraulics" as three filters. Curated-only frustrates specialists.

**Decision.** Curated with proposals, as in PRO-5: a proposed tag shows on the proposer's profile immediately and enters filters when an administrator approves it. Merge tooling in Phase 2.

### T5. Participation and interests: array columns or join tables

**Why it matters.** Arrays are simpler to read and write; join tables are easier to filter and count.

**Decision.** Array columns (`participation participation[]`, `interests text[]`) with GIN indexes. They are small, fixed vocabularies and Postgres filters arrays well. Expertise stays a join table because it has its own lifecycle.

### T6. Scheduled jobs: in the service or an external scheduler

**Why it matters.** Expiry, reminders, resume-after-pause, retention, the deletion sweep and the digest must run reliably, and email must leave even when a request fails midway.

**Decision.** Jobs run inside the API process under `JOBS_ENABLED`, each on an interval with a lock row in `job_runs`, so a second instance during a deploy skips a tick rather than running twice. Email goes through an `email_outbox` table drained by the `send-emails` job every minute. Jobs call SQL functions and hold no rules of their own. `pg_cron` was the Supabase-era answer and is not used.

### T7. Realtime or polling for notifications

**Why it matters.** Pushing new notifications needs a connection per client; polling every minute is simpler.

**Decision.** Polling with TanStack Query's refetch interval while the tab is active. Realtime adds a connection per client for little gain at this scale.

### T8. Local development

**Why it matters.** Every developer should have their own database so the policy suite runs offline and developers do not collide.

**Decision.** `docker-compose.yml` runs Postgres 16 locally with `mest` and `mest_test` databases; `npm run migrate` and `npm run seed` build the fictional data from `mock.ts`; magic links print in the server log instead of being sent. Each test worker gets a private database named with its `WORKTREE_ID`.

### T9. Testing strategy

**Why it matters.** The privacy promises are only as good as the tests that guard them.

**Decision.** vitest against a real Postgres for every policy row and every state transition (run in CI with a Postgres service); vitest for zod schemas, email template privacy assertions and pure functions; Playwright with axe for the smoke paths at 375 and 1280. Every regression test is shown failing against the bug before it is kept. pgTAP was the Supabase-era answer; running the same assertions from vitest keeps one test runner.

### T10. Analytics

**Why it matters.** The requirements rule out tracking individuals. The board still wants to know whether the directory is used.

**Decision.** No third-party analytics. The dashboard's measures come from SQL. If page-level numbers are wanted later, a privacy-respecting, cookie-free counter can be added as a separate decision.

### T11. Deletion anonymization: tombstone row or hard delete with cascades

**Why it matters.** Hard deleting a profile would delete every request and relationship it touched, destroying the other party's history and the program statistics.

**Decision.** Tombstone, as in the architecture document: the `profiles` row survives with name replaced and `anonymized_at` set; dependent personal tables are deleted; request and relationship rows are kept with free text emptied; the `users` row is kept with `email = null` and `deleted_at` set so every foreign key stays valid, and the `sessions`, `auth_tokens` and `email_outbox` rows for that address are deleted.

### T12. Rate limiting implementation

**Why it matters.** Limits on request creation, reports, tag proposals and magic links must be hard to bypass.

**Decision.** Counting the caller's rows in the last 24 hours inside the SQL function, with limits read from `config`. Magic links are counted per address and per IP from `auth_tokens` over the last hour, with `TRUST_PROXY` deciding whether the forwarded address is trusted.

### T13. Where the platform code lives in the repository

**Why it matters.** The landing page and the platform share tokens and components but have different lifecycles.

**Decision.** Same repository: `src/network/` beside the landing page code, `server/` as an npm workspace, `shared/` imported by both. Splitting into separate packages is a later refactor if the build time or the team grows.

### T14. Mentorship settings: a separate table or columns on `professional_details`

**Why it matters.** A separate table makes the "three independent settings" visible in the schema and keeps its own `updated_at`; columns are fewer joins.

**Decision.** Separate `mentorship_settings` and `contact_preferences` tables, because their read policies differ sharply (settings are visible with the profile; contact values are owner-only and released through one function).

### T15. Email provider: Resend or Postmark

**Why it matters.** Both are transactional-only with good deliverability. Resend has a simpler API and a free tier that covers the expected volume; Postmark has longer-standing deliverability reporting.

**Decision.** Resend through its SDK, called only by the `send-emails` job, for every email including magic links, so all mail comes from one verified domain. Switch to Postmark only if deliverability problems appear and cannot be fixed with DNS.

### T16. Introduction requests: same table as mentorship requests or separate

**Why it matters.** Networking requests ("Request an introduction") reuse the request flow. A single table keeps the caps and privacy rules in one place; a separate table keeps the mentorship statistics clean.

**Decision.** Same table with a nullable `topic_id` and a `kind` column (`mentorship`, `introduction`); `create_mentorship_request` takes the kind and the dashboard filters by it.

## Part C: Questions answered by the prototype

For completeness, these were open before the prototype and are now settled by it:

- Whether students appear in the directory: no (DIR-7).
- Whether a professional can also be a mentee: yes; Leen Saleh (fictional) is early career and a mentee.
- Whether contact details appear on profile pages: only the methods the professional chose to show to signed-in members (A1), and never to visitors; everything else only inside an accepted request.
- Whether administrators see request text: masked unless a report references it.
- Whether mentorship, contactability and visibility imply each other: they do not; Fatima Noor (fictional) is listed and paused, Tariq Mansour (fictional) is members-only and mentoring, Ibrahim Okafor (fictional) is listed, open to networking and not mentoring.
