# Open questions: Professional Directory, Networking and Mentorship Platform

This document lists the product and technical choices for the member platform of Muslim Engineers in Science & Tech (MEST) that are not yet settled. Each question states why it matters, the options, a recommended default, and who decides. The recommended default is what the implementer will build if no decision arrives, so that the roadmap in [04-implementation-roadmap.md](04-implementation-roadmap.md) is not blocked; every default is changeable later, and most are a row in the `config` table described in [02-technical-architecture.md](02-technical-architecture.md).

Decisions already made (Supabase, passwordless sign-in, approval queue for professionals, private-by-default contact details, platform-mediated requests with handoff on accept, 14-day expiry, 3 pending requests, default maximum of 3 active mentees, 14-day deletion grace) are recorded in [01-product-requirements.md](01-product-requirements.md) and [02-technical-architecture.md](02-technical-architecture.md) and are not reopened here.

People named as examples come from the prototype's `src/preview/network/data/mock.ts` and are fictional.

## Part A: Decisions that need board approval

These shape who may join, what is public and what MEST is responsible for. The implementer should not decide them alone.

### A1. Default directory visibility for an approved professional

**Why it matters.** The default is what most members will keep. `public` makes the directory useful to visitors and search engines and grows the organization; `members` protects people who did not think about the open web when they signed up.

**Options.** (a) `public`; (b) `members`; (c) ask during onboarding with no preselected option.

**Recommended default.** (c) for the first release: the onboarding step shows the three choices with plain explanations and no preselection, so every listing is a deliberate choice. If the board wants a default, `members`.

**Decides.** Board.

### A2. Eligibility statement at sign-up

**Why it matters.** The landing page describes MEST as a community for Muslim engineers, scientists, technologists and students. The platform needs one sentence that members acknowledge at step 1 of onboarding, and administrators need to know what the approval queue is checking for.

**Options.** (a) Restate the mission and ask members to confirm they are part of the community it describes; (b) a stricter membership requirement (see A3); (c) no statement, approval queue only.

**Recommended default.** (a), using the existing mission wording from `site.ts` so there is one voice.

**Decides.** Board.

### A3. Must platform members be MEST members?

**Why it matters.** If MEST has or plans a formal membership (dues, a roster), the directory could be a member benefit. The platform does not process money, so any check would be manual.

**Options.** (a) Open to anyone who meets the eligibility statement and passes the queue; (b) administrators check a roster before approving; (c) open now, member-only later.

**Recommended default.** (a). There is no roster to check today, and the queue already provides a human look at every professional.

**Decides.** Board.

### A4. Members under 18

**Why it matters.** "High school students" is an audience in the vocabulary, and Idris Fofana, a fictional high school senior, is one of the prototype's mentees. Minors on a platform that leads to in-person meetings with adults carry legal and safeguarding duties MEST must choose to accept or not.

**Options.** (a) Members must be 18 or older; high school outreach stays at MEST events; (b) allow 16 and 17 year olds with a guardian's email on file and online-only mentorship; (c) allow with no special rules.

**Recommended default.** (a) for the first release, with the high-school audience kept in the vocabulary so mentors can say they are willing, and a note on the Network home page that students under 18 can meet mentors at events. (c) is not recommended.

**Decides.** Board, with legal advice if (b) is considered.

### A5. In-person meeting guidance and code of conduct

**Why it matters.** Mentors like Khalid Boudreaux (fictional) offer in-person meetings. MEST is introducing two people who may not know each other. A short conduct statement protects both and sets expectations.

**Options.** (a) Community guidelines page plus a one-line reminder in the accept sheet ("Meet in public places; MEST does not supervise meetings"); (b) a full code of conduct members sign; (c) nothing beyond the guidelines page.

**Recommended default.** (a).

**Decides.** Board.

### A6. Search engine indexing of public profiles

**Why it matters.** Indexing makes "Muslim coastal engineer New Orleans" find Layla Haddad's fictional counterpart and grows the directory. It also means a member's name and employer appear in search results under MEST's domain.

**Options.** (a) Index `public` profiles; (b) index the directory page but not individual profiles; (c) `noindex` everything.

**Recommended default.** (a), because `public` is a deliberate choice under A1 and the onboarding copy says plainly "may appear in search results".

**Decides.** Board.

### A7. Who the administrators are and how they are authorized

**Why it matters.** Administrators see the approval queue, reports and, when handling a report, contact details. The platform enforces a minimum of two.

**Options.** (a) Two or three board-authorized volunteers, reviewed yearly; (b) all board members; (c) a single administrator (not supported by the schema).

**Recommended default.** (a). Fewer people with access is better, and yearly review is a calendar entry.

**Decides.** Board.

### A8. Request expiry, pending cap and default capacity: confirm the numbers

**Why it matters.** 14 days, 3 pending and 3 active are defaults chosen by reasoning, not data. They live in the `config` table and can change without a release, but the board should own them.

**Options.** Keep; shorten expiry to 10 days; raise the pending cap to 5.

**Recommended default.** Keep for the first three months, then read the dashboard (expiry rate, answered-within-7-days) and adjust.

**Decides.** Board confirms; implementer makes the defaults configurable.

### A9. Data retention periods

**Why it matters.** The architecture proposes emptying the free text of expired and declined requests after 24 months and keeping the audit log indefinitely. Retention is a promise made in the privacy notice.

**Options.** 12, 24 or 36 months for request text; audit log 5 years or indefinite.

**Recommended default.** 24 months for request text; audit log indefinite (it holds no contact values).

**Decides.** Board, since it appears in the privacy notice.

### A10. Where the platform lives

**Why it matters.** A subdomain (for example a `network.` prefix on MEST's domain) separates the app from the landing page and simplifies hosting rules; a path (`/network`, `/app`) keeps one domain and one header. The sitemap in [03-ux-information-architecture.md](03-ux-information-architecture.md) assumes paths.

**Options.** (a) Paths on the main domain; (b) a subdomain.

**Recommended default.** (a), because the landing page header should lead straight into the directory with no visible seam. This is partly technical (A10 interacts with T2).

**Decides.** Board, since it involves the domain; the implementer advises.

### A11. Budget for paid tiers

**Why it matters.** Supabase's free tier pauses idle projects and has no daily backups; the paid tier is a fixed monthly cost. Resend and Sentry free tiers are enough for the expected volume. A domain and a Google Cloud project are free or near free.

**Options.** (a) Approve the Supabase paid tier from soft launch; (b) free tier with a keep-alive job and weekly dumps; (c) free tier, accept the pause risk.

**Recommended default.** (a). A directory that is asleep when a student opens it costs more than the subscription.

**Decides.** Board.

### A12. Legal documents and responsibility

**Why it matters.** The privacy notice must name who is responsible for the data (MEST as an organization), what is collected, who sees it, retention and how to leave. The community guidelines set behaviour. Both need an owner.

**Options.** (a) Drafts written during Phase 1A, reviewed by the board and, if available, a volunteer with legal background; (b) adapt a template from a comparable nonprofit.

**Recommended default.** (a); the architecture document already contains the facts the notice must state.

**Decides.** Board.

### A13. Mentor recognition

**Why it matters.** Mentors are volunteers. Some organizations thank them publicly (a "mentor since 2026" mark, a yearly list); others keep it quiet. This affects what the profile shows.

**Options.** (a) No recognition features; (b) an optional "mentoring since" line the mentor can turn on; (c) public counts of mentees helped.

**Recommended default.** (a) in the first release; (b) is cheap later if mentors ask. (c) is not recommended; it turns mentoring into a score.

**Decides.** Board.

### A14. Name of the product

**Why it matters.** "Professional Directory, Networking and Mentorship Platform" is a description, not a name members will say. The header has one slot for it.

**Options.** "Directory"; "MEST Network"; "Members"; something else.

**Recommended default.** The header link says "Directory" (it is what visitors want) and the signed-in area says "MEST Network" in its title. Changeable in `site.ts`.

**Decides.** Board.

## Part B: Technical decisions the implementer can make

These do not change what members experience in a way the board needs to weigh. The implementer should record the decision in the architecture document when made.

### T1. Router: React Router 7 (library mode) or TanStack Router

**Why it matters.** Both work with Vite and static hosting. React Router is more widely known, which matters for volunteer turnover; TanStack Router has typed routes and search params, which the directory filters would use.

**Recommended default.** React Router 7 in library mode, for the larger pool of people who know it. Revisit only if filter state in the URL becomes painful.

### T2. Static hosting SPA fallback

**Why it matters.** Deep links such as `/network/directory/:id` must serve `index.html`. The current host's rewrite rules are not documented in the repository.

**Recommended default.** Confirm the host supports a catch-all rewrite; if not, move static hosting to one that does (several free options exist) before Phase 1A ends. Public profile pages also need either prerendering or server-side meta for A6 to work for social previews; runtime meta covers search engines that execute scripts.

### T3. Keyword search implementation

**Why it matters.** DIR-3 searches name, title, organization, expertise and bio. Options are `ILIKE`, Postgres full-text search with a generated `tsvector` column, or `pg_trgm` for typo tolerance.

**Recommended default.** Full-text search with a generated column and GIN index; add `pg_trgm` for names only if testers report misses on spelling variants (Touré, Yılmaz).

### T4. Expertise tags: curated with proposals, or free text

**Why it matters.** Free text produces "Hydraulic modeling", "hydraulic modelling" and "Hydraulics" as three filters. Curated-only frustrates specialists.

**Recommended default.** Curated with proposals, as in PRO-5: a proposed tag shows on the proposer's profile immediately and enters filters when approved. Merge tooling in Phase 2.

### T5. Participation and interests: array columns or join tables

**Why it matters.** Arrays are simpler to read and write; join tables are easier to filter and count.

**Recommended default.** Array columns (`participation participation[]`, `interests text[]`) with GIN indexes. They are small, fixed vocabularies and Postgres filters arrays well. Expertise stays a join table because it has its own lifecycle.

### T6. Scheduled jobs: `pg_cron` or an external scheduler

**Why it matters.** Expiry, reminders, resume-after-pause and the deletion sweep must run reliably.

**Recommended default.** `pg_cron` inside Supabase, calling SQL functions; the Edge Function for email is invoked by the database webhook, not by the scheduler. Jobs write an audit row on each run so a silent failure is visible on the dashboard.

### T7. Realtime or polling for notifications

**Why it matters.** Supabase Realtime can push new notifications; polling every minute is simpler.

**Recommended default.** Polling with TanStack Query's refetch interval while the tab is active. Realtime adds a connection per client for little gain at this scale.

### T8. Local development: Supabase CLI stack or a shared development project

**Why it matters.** A local stack (Docker) means every developer has their own database and the pgTAP suite runs offline; a shared project is easier to set up but developers collide.

**Recommended default.** Supabase CLI local stack with `seed.sql` generated from `mock.ts`; the shared staging project is for administrators and testers, not for development.

### T9. Testing strategy

**Why it matters.** The privacy promises are only as good as the tests that guard them.

**Recommended default.** pgTAP for every policy and every state transition (run in CI against the local stack); Vitest for zod schemas, email template privacy assertions and pure functions; Playwright for the smoke paths at two viewports. Every regression test is shown failing against the bug before it is kept.

### T10. Analytics

**Why it matters.** The requirements rule out tracking individuals. The board still wants to know whether the directory is used.

**Recommended default.** No third-party analytics. The dashboard's measures come from SQL. If page-level numbers are wanted later, a privacy-respecting, cookie-free counter can be added as a separate decision.

### T11. Deletion anonymization: tombstone row or hard delete with cascades

**Why it matters.** Hard deleting a profile would delete every request and relationship it touched, destroying the other party's history and the program statistics.

**Recommended default.** Tombstone, as in the architecture document: the `profiles` row survives with name replaced and `anonymized_at` set; dependent personal tables are deleted; request and relationship rows are kept with free text emptied; the `auth.users` row is deleted.

### T12. Rate limiting implementation

**Why it matters.** Limits on request creation, reports and tag proposals must be hard to bypass.

**Recommended default.** Counting the caller's rows in the last 24 hours inside the SQL function, with limits read from `config`. Supabase's built-in limits cover authentication endpoints.

### T13. Where the platform code lives in the repository

**Why it matters.** The landing page and the platform share tokens and components but have different lifecycles.

**Recommended default.** Same repository, `src/network/` beside the landing page code, as proposed in the architecture document. Splitting into two packages is a later refactor if the build time or the team grows.

### T14. Mentorship settings: a separate table or columns on `professional_details`

**Why it matters.** A separate table makes the "three independent settings" visible in the schema and keeps its own `updated_at`; columns are fewer joins.

**Recommended default.** Separate `mentorship_settings` and `contact_preferences` tables, because their read policies differ sharply (settings are visible with the profile; contact values are owner-only).

### T15. Email provider: Resend or Postmark

**Why it matters.** Both are transactional-only with good deliverability. Resend has a simpler API and a free tier that covers the expected volume; Postmark has longer-standing deliverability reporting.

**Recommended default.** Resend, also as the custom SMTP provider for Supabase Auth so every email comes from one verified domain. Switch to Postmark only if deliverability problems appear and cannot be fixed with DNS.

### T16. Introduction requests: same table as mentorship requests or separate

**Why it matters.** Networking requests ("Request an introduction") reuse the request flow. A single table keeps the caps and privacy rules in one place; a separate table keeps the mentorship statistics clean.

**Recommended default.** Same table with a nullable `topic_id` and a `kind` column (`mentorship`, `introduction`); the dashboard filters by kind. This is a small addition to the schema in the architecture document and should be made before Phase 1C.

## Part C: Questions answered by the prototype

For completeness, these were open before the prototype and are now settled by it:

- Whether students appear in the directory: no (DIR-7).
- Whether a professional can also be a mentee: yes; Leen Saleh (fictional) is early career and a mentee.
- Whether contact details appear on profile pages: never; only inside an accepted request.
- Whether administrators see request text: masked unless a report references it.
- Whether mentorship, contactability and visibility imply each other: they do not; Fatima Noor (fictional) is listed and paused, Tariq Mansour (fictional) is members-only and mentoring, Ibrahim Okafor (fictional) is listed, open to networking and not mentoring.
