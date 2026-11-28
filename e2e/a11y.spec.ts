import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SCREENS, openScreen, screenLabel, screensFor, signInAs, type Viewer } from "./route-matrix";

/**
 * axe on every screen of the network app (Tasks 28 and 39), at 375 and 1280 (the
 * two projects), for every kind of viewer: no serious or critical
 * violation of WCAG 2.1 A and AA anywhere. Each viewer's screens run in one
 * test so a failure lists every page and rule at once.
 */

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const viewer of Object.keys(SCREENS) as Viewer[]) {
  test(`no serious or critical axe violations for the ${viewer}`, async ({ page, baseURL }, testInfo) => {
    const cleanUp = await signInAs(page, viewer, baseURL ?? "", testInfo.project.name);
    try {
      const found: string[] = [];
      for (const screen of screensFor(viewer, testInfo.project.name)) {
        await openScreen(page, screen);
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        for (const v of results.violations) {
          if (v.impact !== "serious" && v.impact !== "critical") continue;
          const targets = v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join(" | ");
          found.push(`${screenLabel(screen)}: ${v.id} (${v.impact}) ${v.help} -> ${targets}`);
        }
      }
      expect(found, found.join("\n")).toEqual([]);
    } finally {
      await cleanUp();
    }
  });
}
