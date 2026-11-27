# MEST — Muslim Engineers in Science & Tech

Landing page and MEST Network for Muslim Engineers in Science & Tech (MEST), a professional and community organization based in Greater New Orleans, Louisiana.

- **Landing page** (`/`): React, TypeScript, Vite, Tailwind CSS 4, GSAP (ScrollTrigger + SplitText), Lucide icons.
- **MEST Network** (`/network`): the professional directory, mentorship requests and administration, served with the landing page by one Node service (Hono) with Postgres, deployed on Railway. Planning documents, the build plan and the production runbook are in [`docs/professional-network/`](docs/professional-network/README.md).

## Run locally

Node.js 22 or newer. The landing page alone needs only the web app:

```sh
npm ci
npm run dev        # Vite on http://127.0.0.1:5173
```

The network app also needs the API and Postgres 16 (Docker, or any local Postgres with `DATABASE_URL` and `DATABASE_URL_TEST` pointed at it in `.env`):

```sh
cp .env.example .env
docker compose up -d   # Postgres on 54329 with the mest and mest_test databases
npm run migrate        # apply server/migrations
npm run seed           # fictional people, requests and reports for development
npm run dev:all        # the API on 8787 and Vite on 5173, which proxies /api
```

Open `http://127.0.0.1:5173/network`. Sign-in links are not emailed locally: the server prints each one in its log. The seeded administrators are `admin@example.test` and `admin2@example.test`.

```sh
npm run typecheck      # web and server types
npm run test:server    # server and policy tests against a real Postgres
npm run build          # web production build to dist/
npm run build -w server
npm run e2e            # browser tests at 375 and 1280 (build and migrate first)
npm run admin:grant -- <email>   # grant the administrator role (see the runbook)
```

Production setup, backups and incident steps are in [`docs/professional-network/runbook.md`](docs/professional-network/runbook.md).

## Sitemap

One scrolling page, following `MEST_Website_Sitemap_and_Content_Plan` v1.0:

1. Hero: what MEST is, with Join MEST and Our mission
2. Mission & About: mission statement, who it is for, and what MEST offers
3. Events: confirmed events, or the plan's empty state while none are scheduled
4. Get Involved: invitation and contact route
5. Footer: email, social profiles and organization details

Navigation: Mission, Events, Get Involved. The content plan's Meet the Board section is intentionally left out; board member information is not published on the site.

## Before launch

All replaceable content lives in [`src/content/site.ts`](src/content/site.ts). Copy comes from the content plan, which marks it as a draft for review.

1. **Events.** Add confirmed events to `events` (title, date, time, location, format, description, registration link). While the list is empty the section shows "Upcoming events will appear here."
2. **Contact and social links.** Fill `contact.email` and the `socials` hrefs. Empty values render as "to be announced" rather than dead links.
3. **Membership form.** Built but hidden. Set `features.membershipForm` to `true` and `VITE_MEMBERSHIP_ENDPOINT` to a POST endpoint to show it; it sends `{ name, email, role }` as JSON.
4. **Photography.** Licensed Unsplash images, not MEST's own. The hero is the Crescent City Connection in New Orleans; the steel lattice in the offers band is not a New Orleans structure. The image-led Community section is not rendered; it is kept in `src/components/Community.tsx` for the past-event gallery and needs authentic photos before it returns.
5. **Regional copy.** The Greater New Orleans descriptions in `site.ts` (mission overview and region paragraph, pillar lines, Get Involved note) were written for Phase 1 and need the organizers' approval.
6. **Metadata.** Add a `<link rel="canonical">` once the domain is known.

## Structure

- `src/network/`: the MEST Network app (React Router, TanStack Query), split into its own chunk
- `server/`: the API, migrations, background jobs, seed and tests; `shared/` holds the types, limits and schemas both sides use
- `src/App.tsx` — page composition
- `src/components/Hero.tsx` — the hero: a full-bleed photograph opened through an eight-pointed star aperture under the oversized wordmark; GSAP runs the aperture, the letter masks, the drawn rule, the staggered copy and the scroll-scrubbed exit
- `src/components/` — `Header`, `Hero`, `Purpose` (Mission & About), `Pillars`, `Events`, `Membership` (Get Involved), `Footer`, `Logo` (mark, lettering, full lockup and header wordmark from the supplied SVG)
- `src/hooks/useMotion.ts` — entrance sequence, masked line reveals, scroll reveals and parallax, with a reduced-motion bypass and failsafes so nothing stays hidden
- `src/content/site.ts` — navigation, plan copy, pillars, events, contact, credits and feature switches
- `src/styles.css` — design tokens (`@theme`), type roles, components and responsive compositions
- `public/fonts/` — Cormorant Garamond and Hanken Grotesk (variable, SIL OFL), self-hosted
- `public/images/` — WebP photography with mobile variants for the two full-bleed images

## Design system

- Palette, dark only: background `#100F13`, panels `#1D1A22`, main purple `#9B7DCE` for actions and rules, logo and accent purple `#B49AD8`, text `#F4F1F7`, secondary text `#B7AFBF`.
- Logo: the supplied artwork, recoloured from `#9362D3` to the palette's `#B49AD8`. Standalone files are in `public/logo/`; the favicon and touch icon use the mark alone.
- Type: Cormorant Garamond for display and headings, Hanken Grotesk for body, labels and controls.

## Photography credits

Unsplash license. Crescent City Connection at night: iSawRed. Steel lattice: Nick Fewings.
