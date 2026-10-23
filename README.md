# MEST — Muslim Engineers in Science & Tech

Landing page for Muslim Engineers in Science & Tech (MEST), a professional and community organization based in Greater New Orleans, Louisiana. React, TypeScript, Vite, Tailwind CSS 4, GSAP (ScrollTrigger + SplitText), Lucide icons.

## Run locally

```sh
npm ci
npm run dev
```

```sh
npm run build      # TypeScript check and production build to dist/
npm run preview    # Serve the production build
```

Node.js 22 or newer.

## Sitemap

One scrolling page, following `MEST_Website_Sitemap_and_Content_Plan` v1.0:

1. Hero: what MEST is, with Join MEST and Our mission
2. Mission & About: mission statement, who it is for, and what MEST offers
3. Events: confirmed events, or the plan's empty state while none are scheduled
4. Meet the Board: name, role, headshot and short bio for each member
5. Get Involved: invitation and contact route
6. Footer: email, social profiles and organization details

Navigation: Mission, Events, Board, Get Involved.

## Before launch

All replaceable content lives in [`src/content/site.ts`](src/content/site.ts). Copy comes from the content plan, which marks it as a draft for review.

1. **Events.** Add confirmed events to `events` (title, date, time, location, format, description, registration link). While the list is empty the section shows "Upcoming events will appear here."
2. **Board.** Add each member to `board` (name, official title, headshot path, one or two sentence bio, optional expertise and LinkedIn). Put headshots in `public/images/board/`. While the list is empty, four placeholder profiles are shown.
3. **Contact and social links.** Fill `contact.email` and the `socials` hrefs. Empty values render as "to be announced" rather than dead links.
4. **Membership form.** Built but hidden. Set `features.membershipForm` to `true` and `VITE_MEMBERSHIP_ENDPOINT` to a POST endpoint to show it; it sends `{ name, email, role }` as JSON.
5. **Photography.** The hero bridge and the steel lattice are licensed Unsplash images, not MEST or New Orleans; the bridge is in Dallas. The image-led Community section is not rendered; it is kept in `src/components/Community.tsx` for the past-event gallery and needs authentic photos before it returns.
6. **Regional copy.** The Greater New Orleans descriptions in `site.ts` (mission overview and region paragraph, pillar lines, Get Involved note) were written for Phase 1 and need the organizers' approval.
7. **Metadata.** Add a `<link rel="canonical">` once the domain is known.

## Structure

- `src/App.tsx` — page composition
- `src/components/Hero.tsx` — the hero: a full-bleed photograph opened through an eight-pointed star aperture under the oversized wordmark; GSAP runs the aperture, the letter masks, the drawn rule, the staggered copy and the scroll-scrubbed exit
- `src/components/` — `Header`, `Hero`, `Purpose` (Mission & About), `Pillars`, `Events`, `Board`, `Membership` (Get Involved), `Footer`, `Logo` (mark, lettering, full lockup and header wordmark from the supplied SVG)
- `src/hooks/useMotion.ts` — entrance sequence, masked line reveals, scroll reveals and parallax, with a reduced-motion bypass and failsafes so nothing stays hidden
- `src/content/site.ts` — navigation, plan copy, pillars, events, board, contact, credits and feature switches
- `src/styles.css` — design tokens (`@theme`), type roles, components and responsive compositions
- `public/fonts/` — Cormorant Garamond and Hanken Grotesk (variable, SIL OFL), self-hosted
- `public/images/` — WebP photography with mobile variants for the two full-bleed images

## Design system

- Palette, dark only: background `#100F13`, panels `#1D1A22`, main purple `#9B7DCE` for actions and rules, logo and accent purple `#B49AD8`, text `#F4F1F7`, secondary text `#B7AFBF`.
- Logo: the supplied artwork, recoloured from `#9362D3` to the palette's `#B49AD8`. Standalone files are in `public/logo/`; the favicon and touch icon use the mark alone.
- Type: Cormorant Garamond for display and headings, Hanken Grotesk for body, labels and controls.

## Photography credits

Unsplash license. Bridge at night: Koushik Beeram. Steel lattice: Nick Fewings.
