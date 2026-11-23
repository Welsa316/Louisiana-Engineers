import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { withUser } from "../../src/db/tx";
import { AppError } from "../../src/http/errors";
import { validate } from "../../src/http/validate";
import { createTestDb, testApp, type TestDb } from "../harness";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

const bodySchema = z.object({ name: z.string().min(2), count: z.number().int().max(3) });
const querySchema = z.object({ size: z.coerce.number().int().max(50).default(20) });

const area = new Hono()
  .post("/echo", validate(bodySchema), (c) => {
    const body = c.req.valid("json");
    return c.json({ name: body.name, double: body.count * 2 });
  })
  .get("/page", validate(querySchema, "query"), (c) => c.json({ size: c.req.valid("query").size }))
  .get("/gone", () => {
    throw new AppError(403, "members_only", "profile 123 is members-only");
  })
  .get("/limited", () => {
    throw new AppError(429, "rate_limited", "too many", { retryAfter: 60 });
  })
  .get("/domain", (c) =>
    withUser(null, async (tx) => {
      await tx.query("DO $$ BEGIN RAISE EXCEPTION 'mest.pending_cap'; END $$");
      return c.json({ unreachable: true });
    }),
  )
  .get("/sql-bug", (c) =>
    withUser(null, async (tx) => {
      await tx.query("SELECT * FROM no_such_table");
      return c.json({ unreachable: true });
    }),
  )
  .get("/crash", () => {
    throw new Error("secret detail about user 42");
  });

const app = testApp(new Hono().route("/area", area));

function post(path: string, body: string, contentType = "application/json") {
  return app.request(path, { method: "POST", body, headers: { "Content-Type": contentType } });
}

describe("http errors and validation", () => {
  it("validate_passes_parsed_input_and_rejects_with_issues", async () => {
    const ok = await post("/api/area/echo", JSON.stringify({ name: "Layla", count: 2, extra: "dropped" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: "Layla", double: 4 });

    const bad = await post("/api/area/echo", JSON.stringify({ name: "L", count: 9 }));
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { code: string; issues: { path: (string | number)[] }[] };
    expect(body.code).toBe("validation");
    expect(body.issues.map((issue) => issue.path.join("."))).toEqual(["name", "count"]);

    const malformed = await post("/api/area/echo", "{not json");
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { code: string }).code).toBe("validation");

    // Without a JSON content type the body counts as empty.
    const wrongType = await post("/api/area/echo", JSON.stringify({ name: "Layla", count: 2 }), "text/plain");
    expect(wrongType.status).toBe(400);
    expect(((await wrongType.json()) as { code: string }).code).toBe("validation");

    const page = await app.request("/api/area/page?size=7");
    expect(await page.json()).toEqual({ size: 7 });
    const defaulted = await app.request("/api/area/page");
    expect(await defaulted.json()).toEqual({ size: 20 });
    const tooBig = await app.request("/api/area/page?size=500");
    expect(tooBig.status).toBe(400);
  });

  it("app_error_answers_its_status_and_code_without_the_message", async () => {
    const res = await app.request("/api/area/gone");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "members_only" });

    const limited = await app.request("/api/area/limited");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ code: "rate_limited", retryAfter: 60 });
  });

  it("mest_sql_exception_maps_to_409_with_its_code", async () => {
    const res = await app.request("/api/area/domain");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ code: "pending_cap" });
  });

  it("unexpected_errors_are_500_internal_without_detail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const path of ["/api/area/crash", "/api/area/sql-bug"]) {
        const res = await app.request(path);
        expect(res.status, path).toBe(500);
        const text = await res.text();
        expect(JSON.parse(text), path).toEqual({ code: "internal" });
        expect(text).not.toContain("42");
        expect(text).not.toContain("no_such_table");
      }
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("unknown_api_paths_are_json_404", async () => {
    for (const path of ["/api/nope", "/api/area/nope", "/api/area"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ code: "not_found" });
    }
    const wrongMethod = await app.request("/api/area/gone", { method: "DELETE" });
    expect(wrongMethod.status).toBe(404);
    expect(await wrongMethod.json()).toEqual({ code: "not_found" });
  });
});
