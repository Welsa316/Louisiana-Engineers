# MEST — Muslim Engineers in Science & Tech

Landing page for the Muslim Engineers in Science & Tech. React, TypeScript, Vite, Tailwind CSS 4, GSAP (ScrollTrigger + SplitText), Lucide icons.

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

## Before launch

All replaceable content lives in [`src/content/site.ts`](src/content/site.ts).

1. **Events.** The four listings are samples and render with a visible "Sample" tag. Replace them with confirmed dates, venues and descriptions. Set `placeholder: false` on real entries to remove the tag and the footnote.
2. **Membership form.** Set `VITE_MEMBERSHIP_ENDPOINT` to a POST endpoint (a form service URL works). The form sends `{ name, email, role }` as JSON. Until the variable is set, submitting shows an honest "enrollment opens soon" message and sends nothing.
3. **Contact and social links.** Fill `contact.email` and the `socials` hrefs. Empty values render as "to be announced" rather than dead links.
4. **Photography.** The photographs are licensed Unsplash images and are illustrative; they do not show MEST members or events. Replace the files in `public/images/` with organization photography when available and update `photoCredits`.
5. **Metadata.** `index.html` carries the title, description and Open Graph tags. Add a `<link rel="canonical">` once the domain is known. `public/og.jpg` is the share image.

## Structure

- `src/App.tsx` — page composition
- `src/components/Hero.tsx` — the hero: an oversized wordmark with a still photograph set into its baseline; GSAP runs the letter masks, the clip reveal, the drawn rule, the staggered copy and the scroll-scrubbed exit
- `src/components/` — `Header`, `Hero`, `Purpose`, `Pillars`, `Community`, `Events`, `Membership`, `Footer`, `Mark` (geometric mark and tiling pattern)
- `src/hooks/useMotion.ts` — entrance sequence, masked line reveals, scroll reveals and parallax, with a reduced-motion bypass and failsafes so nothing stays hidden
- `src/content/site.ts` — navigation, copy for the pillars, events, contact and credits
- `src/styles.css` — design tokens (`@theme`), type roles, components and responsive compositions
- `public/fonts/` — Hanken Grotesk (variable, SIL OFL), self-hosted
- `public/images/` — WebP photography with mobile variants for the two full-bleed images

## Design system

- Palette: charcoal `#1b1c1a`, warm off-white `#f3f0ea`, forest `#27433a`, bronze `#a9865a` (champagne `#d6c19a` on dark surfaces).
- Type: one family, Hanken Grotesk, from 300 (display) to 500 (labels). Every type role declares size, line height and tracking together.
- Geometry: an eight-pointed star drawn from alternating radii; the same function produces the brand mark and the star-and-cross tiling behind the membership section.

## Photography credits

Unsplash license. Bridge: Viktor Solomonik. Steel lattice: Nick Fewings. Conversation: Small Group Network. Engineers with drawings: Fiqih Alfarish. Reviewing plans and workshop: ThisisEngineering.
