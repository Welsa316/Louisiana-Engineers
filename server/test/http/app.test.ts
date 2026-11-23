import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/index";
import { createTestDb, type TestDb } from "../harness";

let db: TestDb;
let webDist: string;
let app: ReturnType<typeof createApp>;
const INDEX = '<!doctype html><html><head><title>MEST</title></head><body><div id="root"></div></body></html>';

beforeAll(async () => {
  db = await createTestDb();
  webDist = await mkdtemp(join(tmpdir(), "mest-dist-"));
  await mkdir(join(webDist, "assets"));
  await mkdir(join(webDist, "images"));
  await writeFile(join(webDist, "index.html"), INDEX);
  await writeFile(join(webDist, "assets", "app-abc123.js"), "console.log(1)");
  await writeFile(join(webDist, "images", "hero.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
  await writeFile(join(webDist, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  await writeFile(join(webDist, "secret.txt"), "not served");
  app = createApp({ webDist, pool: db.pool, cacheIndex: false });
});

afterAll(async () => {
  await db.close();
  await rm(webDist, { recursive: true, force: true });
});

describe("http skeleton", () => {
  it("health_reports_migration_count", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const count = await db.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM schema_migrations");
    expect(await res.json()).toEqual({ ok: true, migrations: Number(count.rows[0].count) });
  });

  it("root_and_network_paths_serve_index_html", async () => {
    for (const path of ["/", "/network", "/network/directory", "/network/directory/some-id", "/network/me/requests"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain("text/html");
      expect(await res.text(), path).toBe(INDEX);
    }
  });

  it("static_prefixes_serve_files_with_types_and_caching", async () => {
    const js = await app.request("/assets/app-abc123.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await js.text()).toBe("console.log(1)");

    const image = await app.request("/images/hero.webp");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");
    expect(image.headers.get("cache-control")).toBe("public, max-age=3600");

    const icon = await app.request("/favicon.svg");
    expect(icon.status).toBe(200);
    expect(icon.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("everything_else_is_a_plain_404", async () => {
    for (const path of [
      "/nothing-here",
      "/preview/professional-network",
      "/networking",
      "/secret.txt",
      "/index.html",
      "/assets/missing.js",
      "/assets/",
      "/images/../secret.txt",
      "/assets/%2e%2e/secret.txt",
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type"), path).toContain("text/plain");
      expect(await res.text(), path).toBe("Not found");
    }
  });

  it("unknown_api_paths_are_json_404", async () => {
    for (const path of ["/api", "/api/nope", "/api/health/extra", "/api/auth/whatever"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type"), path).toContain("application/json");
      expect(await res.json(), path).toEqual({ code: "not_found" });
    }
    const post = await app.request("/api/nope", { method: "POST" });
    expect(post.status).toBe(404);
    expect(await post.json()).toEqual({ code: "not_found" });
  });

  it("encoded_slashes_cannot_leave_a_static_prefix", async () => {
    // A percent-encoded slash survives URL normalisation, so after decoding
    // it would walk out of /assets/ to any file in the build root.
    for (const path of ["/assets/..%2fsecret.txt", "/images/..%2F..%2Fsecret.txt", "/assets/..%5csecret.txt"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe("Not found");
    }
  });

  it("malformed_escapes_are_a_404_not_a_500", async () => {
    for (const path of ["/assets/%zz", "/images/%E0%A4%A"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
    }
  });
});

describe("mounted areas", () => {
  it("auth_and_config_routes_are_mounted_under_api", async () => {
    const me = await app.request("/api/auth/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ user: null });
    const config = await app.request("/api/config/public");
    expect(config.status).toBe(200);
    expect(await config.json()).toMatchObject({ googleEnabled: expect.any(Boolean), platformPaused: false });
  });
});
