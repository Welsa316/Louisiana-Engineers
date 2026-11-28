import { expect, test } from "@playwright/test";
import { SCREENS, openScreen, screenLabel, screensFor, signInAs, type Viewer } from "./route-matrix";

/**
 * No screen scrolls sideways or has an element running past the right edge
 * (03 section 12), at 375 and 1280, for every kind of viewer. The page's
 * own scroll width is measured as well as every element's box, since an
 * element can run past the edge inside a clipping parent without widening
 * the page. Each viewer's screens run in one test so a failure lists them all.
 */

for (const viewer of Object.keys(SCREENS) as Viewer[]) {
  test(`nothing runs past the viewport for the ${viewer}`, async ({ page, baseURL }, testInfo) => {
    const cleanUp = await signInAs(page, viewer, baseURL ?? "", testInfo.project.name);
    try {
      const found: string[] = [];
      for (const screen of screensFor(viewer, testInfo.project.name)) {
        await openScreen(page, screen);
        const result = await page.evaluate(() => {
          const width = document.documentElement.clientWidth;
          const wide = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.right <= width + 1) return false;
            // Content a scrolling strip holds on purpose (a horizontal tab
            // list) or a clipping box cuts off (decorative art bleeding off
            // a band) ends at that box's edge: judge the box instead.
            for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
              if (getComputedStyle(up).overflowX === "visible") continue;
              if (up.getBoundingClientRect().right <= width + 1) return false;
            }
            return true;
          });
          return {
            width,
            scroll: document.documentElement.scrollWidth - width,
            wide: wide.slice(0, 4).map((el) => el.outerHTML.slice(0, 120)),
          };
        });
        // The viewport really is the project's (a classic scrollbar may take up to 20px).
        const viewport = testInfo.project.name === "mobile-375" ? 375 : 1280;
        expect(result.width).toBeGreaterThan(viewport - 20);
        expect(result.width).toBeLessThanOrEqual(viewport);
        if (result.scroll > 0 || result.wide.length) {
          found.push(`${screenLabel(screen)}: scrolls ${result.scroll}px sideways; ${result.wide.join(" | ")}`);
        }
      }
      expect(found, found.join("\n")).toEqual([]);
    } finally {
      await cleanUp();
    }
  });
}
