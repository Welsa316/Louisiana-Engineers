# Professional Directory, Networking and Mentorship Platform: planning documents

This folder holds the planning documents for a member platform for Muslim Engineers in Science & Tech (MEST), the volunteer-run professional and community organization based in Greater New Orleans, Louisiana. The platform adds three things the current single-page landing site does not have: a directory of professionals who choose to be listed, a way for students and early-career members to request mentorship from those professionals, and the administration tools a volunteer board needs to approve profiles, handle reports and keep personal data private. The documents cover product requirements, technical architecture (Supabase alongside the existing React and Vite frontend), information architecture and user experience, an implementation roadmap, and the questions that still need an answer. Nothing in this folder is built yet; a frontend-only prototype exists so the board can click through the proposed experience with fictional data.

## Documents

| File | What it answers |
| --- | --- |
| [01-product-requirements.md](01-product-requirements.md) | Who the platform is for, what it must do, who may do what, what is in the first release and how the board will know it is working |
| [02-technical-architecture.md](02-technical-architecture.md) | The recommended stack and why, the full database schema, authentication, Row Level Security, privacy, integrations, deletion and data ownership |
| [03-ux-information-architecture.md](03-ux-information-architecture.md) | Sitemap, navigation per role, user journeys, onboarding fields, mentee, mentor and admin workflows, notifications, empty states, mobile behaviour, accessibility |
| [04-implementation-roadmap.md](04-implementation-roadmap.md) | Phases, scope, dependencies, complexity estimates, risks, order of work and acceptance criteria |
| [05-open-questions.md](05-open-questions.md) | Unresolved choices, split into decisions that need the board and decisions the implementer can make |

Read them in order the first time. Each file is self-contained and links to the others where a topic continues.

## Source of truth for vocabularies

The prototype's data modules define the controlled vocabularies and entity shapes that these documents use, and the documents are written to match them:

- `src/preview/network/data/taxonomy.ts`: disciplines, mentorship topics, audiences, experience bands, contact methods, participation options
- `src/preview/network/data/types.ts`: visibility levels, mentorship status, approval state, request statuses, roles, entity fields
- `src/preview/network/data/mock.ts`: fictional people, organizations, requests, meetings and reports used as examples

Every person and organization named in these documents comes from `mock.ts` and is fictional.

## How to run the prototype

```sh
npm ci
npm run dev
```

Then open `http://127.0.0.1:5173/preview/professional-network/`.

The prototype is frontend-only. It uses fictional data and keeps state only for the browser session (a reload keeps your walkthrough; the Reset data button in the control bar restores the samples). It is gated off the production landing page by its URL prefix, is not linked from the public navigation, and should not be deployed. Role switching (visitor, student or mentee, mentor, administrator) is in the "Prototype" control bar fixed at the top of the page so reviewers can see each perspective without signing in.

## Status

Planning. No backend, authentication or database exists yet. The decisions recorded as fixed in these documents (Supabase, passwordless sign-in, approval queue, private-by-default contact details, platform-mediated requests) were made before writing; the open questions in [05-open-questions.md](05-open-questions.md) list what remains.
