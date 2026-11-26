import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DirectoryResponse, ProfileView } from "@shared/types/directory";
import { createSession } from "../../src/auth/session";
import { wrapClient } from "../../src/db/tx";
import { createApp } from "../../src/index";
import { renderMeta } from "../../src/meta";
import { createDirectoryRoutes } from "../../src/routes/directory";
import { createProfileRoutes } from "../../src/routes/profiles";
import { asSystem, createTestDb, testApp, truncateAll, type TestDb } from "../harness";
import { FIXTURE_BIO, makePerson, type PersonOptions } from "../policies/fixtures";

/**
 * The directory and profile reads (Task 13), through the routes: who sees
 * which profile, search, filters, sort, paging, the paused platform, and the
 * meta tags the server injects for crawlers.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await truncateAll(db.pool);
  await db.pool.query("UPDATE config SET value = 'false' WHERE key = 'platform_paused'");
});

const app = testApp(new Hono().route("/directory", createDirectoryRoutes()).route("/profiles", createProfileRoutes()));

/** A session cookie for `userId`, created as the auth module does. */
async function cookieFor(userId: string): Promise<string> {
  const session = await asSystem(db.pool, (client) => createSession(wrapClient(client), userId, null));
  return `mest_session=${session.value}`;
}

async function get(path: string, viewer: string | null = null): Promise<Response> {
  return app.request(path, { headers: viewer ? { cookie: await cookieFor(viewer) } : {} });
}

async function directory(query = "", viewer: string | null = null): Promise<DirectoryResponse> {
  const res = await get(`/api/directory${query ? `?${query}` : ""}`, viewer);
  expect(res.status).toBe(200);
  return (await res.json()) as DirectoryResponse;
}

const ids = (response: DirectoryResponse) => response.items.map((item) => item.id).sort();
const sorted = (list: string[]) => [...list].sort();

/** A listed professional, with optional tags, mentorship and activity, arranged as the table owner. */
interface ProOptions extends Omit<PersonOptions, "verified"> {
  tags?: string[];
  /** An administrator verified the affiliation. */
  affiliationVerified?: boolean;
  location?: string;
  mentor?: { status: "active" | "paused" | "off"; topics?: string[]; audience?: string[] };
  lastActiveDaysAgo?: number;
}

async function pro(options: ProOptions = {}): Promise<string> {
  const { tags, location, mentor, lastActiveDaysAgo, affiliationVerified, ...person } = options;
  const id = await makePerson(db.pool, person);
  await asSystem(db.pool, async (client) => {
    if (location) await client.query("UPDATE profiles SET location = $2 WHERE id = $1", [id, location]);
    if (lastActiveDaysAgo !== undefined) {
      await client.query("UPDATE profiles SET last_active_at = now() - make_interval(days => $2) WHERE id = $1", [
        id,
        lastActiveDaysAgo,
      ]);
    }
    if (affiliationVerified) {
      await client.query(
        "UPDATE professional_details SET verified = true, verified_method = 'linkedin', verified_at = now() WHERE profile_id = $1",
        [id],
      );
    }
    for (const label of tags ?? []) {
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const tag = await client.query<{ id: string }>(
        `INSERT INTO expertise_tags (label, slug, status) VALUES ($1, $2, 'approved')
         ON CONFLICT (slug) DO UPDATE SET label = excluded.label RETURNING id`,
        [label, slug],
      );
      await client.query("INSERT INTO profile_expertise (profile_id, tag_id) VALUES ($1, $2)", [id, tag.rows[0].id]);
    }
    if (mentor) {
      await client.query(
        `INSERT INTO mentorship_settings (profile_id, status, audience, paused_until)
         VALUES ($1, $2, $3::audience[], $4)`,
        [id, mentor.status, mentor.audience ?? [], mentor.status === "paused" ? "2027-01-15" : null],
      );
      for (const topic of mentor.topics ?? []) {
        await client.query("INSERT INTO mentor_topics (profile_id, topic_id) VALUES ($1, $2)", [id, topic]);
      }
    }
  });
  return id;
}

/** A verified, onboarded student: a member who is never listed. */
const member = () => makePerson(db.pool, { kind: "student", visibility: "hidden" });

describe("GET /api/directory: who is listed", () => {
  it("visitor_search_public_only", async () => {
    const pub = await pro({ visibility: "public" });
    await pro({ visibility: "members" });
    await pro({ visibility: "hidden" });
    await pro({ approval: "pending" });
    await pro({ approval: "declined" });
    await pro({ adminHidden: true });
    await pro({ participation: ["networking"] });
    await makePerson(db.pool, { kind: "student", visibility: "public", approval: "approved" });

    const res = await directory();
    expect(ids(res)).toEqual([pub]);
    expect(res.total).toBe(1);
    expect(res.items[0].visibility).toBe("public");
  });

  it("member_search_includes_members_visibility", async () => {
    const pub = await pro({ visibility: "public" });
    const members = await pro({ visibility: "members" });
    await pro({ visibility: "hidden" });
    await pro({ approval: "pending" });
    await pro({ adminHidden: true });
    const viewer = await member();

    const res = await directory("", viewer);
    expect(ids(res)).toEqual(sorted([pub, members]));
    expect(res.total).toBe(2);

    // An administrator's wider reach does not leak hidden or pending profiles into the list.
    const admin = await makePerson(db.pool, { kind: "student", visibility: "hidden", admin: true });
    expect(ids(await directory("", admin))).toEqual(sorted([pub, members]));

    // A signed-in but unverified account reads as a visitor.
    const unverified = await makePerson(db.pool, { kind: "student", visibility: "hidden", verified: false });
    expect(ids(await directory("", unverified))).toEqual([pub]);
  });

  it("never carries contact columns, the LinkedIn link, exact years or max_active", async () => {
    const id = await pro({ email: "layla.private@example.test", yearsExperience: 13 });
    await asSystem(db.pool, async (client) => {
      await client.query("UPDATE profiles SET linkedin_url = 'https://www.linkedin.com/in/layla-private' WHERE id = $1", [id]);
      await client.query(
        `INSERT INTO contact_preferences (profile_id, methods, share_with_members, phone)
         VALUES ($1, '{mest,email,phone}', '{email,phone}', '+15045550100')`,
        [id],
      );
    });
    const viewer = await member();
    const text = JSON.stringify(await directory("", viewer));
    expect(text).not.toContain("layla.private");
    expect(text).not.toContain("linkedin.com");
    expect(text).not.toContain("5045550100");
    expect(text).not.toMatch(/yearsExperience|maxActive|max_active/);
    expect(text).toContain('"experienceBand":"10-19"');
  });
});

describe("GET /api/directory: search, filters and sort", () => {
  it("search_matches_tag_organization_and_name", async () => {
    const layla = await pro({ firstName: "Layla", lastName: "Haddad", tags: ["Coastal restoration"], organization: "Gulf Works" });
    const omar = await pro({ firstName: "Omar", lastName: "Said", organization: "Crescent Coastal Group", tags: ["Bridges"] });
    const rudy = await pro({ firstName: "Rudy", lastName: "Bell", title: "Software engineer", tags: ["Embedded systems"] });
    const proposed = await pro({ firstName: "Nadia", lastName: "Karim" });
    // A proposed tag is not searchable: only approved tags enter the document.
    await asSystem(db.pool, async (client) => {
      const tag = await client.query<{ id: string }>(
        "INSERT INTO expertise_tags (label, slug, status) VALUES ('Coastal dunes', 'coastal-dunes', 'proposed') RETURNING id",
      );
      await client.query("INSERT INTO profile_expertise (profile_id, tag_id) VALUES ($1, $2)", [proposed, tag.rows[0].id]);
    });

    // Tag (Layla) and organization (Omar); stemming matches "coastal" in both.
    expect(ids(await directory("q=coastal"))).toEqual(sorted([layla, omar]));
    // Organization alone.
    expect(ids(await directory("q=crescent"))).toEqual([omar]);
    // Names, including one the English stemmer changes into something that is not
    // a prefix of the name ("rudy" -> "rudi"), which only the simple dictionary finds.
    expect(ids(await directory("q=layla"))).toEqual([layla]);
    expect(ids(await directory("q=Rudy"))).toEqual([rudy]);
    expect(ids(await directory("q=haddad%20coastal"))).toEqual([layla]);
    // Prefixes, as someone types.
    expect(ids(await directory("q=emb"))).toEqual([rudy]);
    // Search syntax is treated as text, not as a query language.
    expect(ids(await directory("q=%27%26%7C!%3A*()"))).toEqual(sorted([layla, omar, rudy, proposed]));
    expect((await directory("q=nothing-matches-this")).total).toBe(0);
  });

  it("experience_location_verified_filters", async () => {
    const junior = await pro({ yearsExperience: 1, location: "Metairie, LA" });
    const mid = await pro({ yearsExperience: 12, location: "New Orleans, LA", affiliationVerified: true });
    const senior = await pro({ yearsExperience: 25, location: "Baton Rouge, LA", affiliationVerified: true });

    expect(ids(await directory("experience=0-2"))).toEqual([junior]);
    expect(ids(await directory("experience[]=10-19&experience[]=20%2B"))).toEqual(sorted([mid, senior]));
    expect(ids(await directory("location=orleans"))).toEqual([mid]);
    expect(ids(await directory("location=%25"))).toEqual([]);
    expect(ids(await directory("verified=1"))).toEqual(sorted([mid, senior]));
    expect(ids(await directory("verified=1&experience=20%2B&location=rouge"))).toEqual([senior]);
    expect((await directory("experience=3-9")).total).toBe(0);
  });

  it("filters by discipline, tag, participation, mentoring, topic and audience", async () => {
    const civilMentor = await pro({
      disciplineId: "civil",
      participation: ["directory", "mentoring"],
      tags: ["Levee design"],
      mentor: { status: "active", topics: ["professional-licensure"], audience: ["undergrad"] },
    });
    const pausedMentor = await pro({
      disciplineId: "coastal",
      participation: ["directory", "mentoring", "speaking"],
      mentor: { status: "paused", topics: ["internships-and-first-jobs"], audience: ["grad"] },
    });
    const networker = await pro({ disciplineId: "coastal", participation: ["directory", "networking"], mentor: { status: "off" } });

    expect(ids(await directory("discipline=coastal"))).toEqual(sorted([pausedMentor, networker]));
    expect(ids(await directory("discipline=coastal&discipline=civil"))).toEqual(sorted([civilMentor, pausedMentor, networker]));
    expect(ids(await directory("tag=levee-design"))).toEqual([civilMentor]);
    expect(ids(await directory("participation=networking&participation=speaking"))).toEqual(sorted([pausedMentor, networker]));
    expect(ids(await directory("mentoring=available"))).toEqual([civilMentor]);
    expect(ids(await directory("mentoring=all"))).toEqual(sorted([civilMentor, pausedMentor]));
    expect(ids(await directory("mentoring=any"))).toHaveLength(3);
    expect(ids(await directory("topic=internships-and-first-jobs"))).toEqual([pausedMentor]);
    expect(ids(await directory("audience=undergrad"))).toEqual([civilMentor]);

    const res = await directory("mentoring=all");
    const paused = res.items.find((item) => item.id === pausedMentor);
    expect(paused).toMatchObject({ mentorStatus: "paused", hasCapacity: false, mentorTopics: ["internships-and-first-jobs"] });
  });

  it("discipline facets count every filter but the discipline itself", async () => {
    await pro({ disciplineId: "civil", affiliationVerified: true });
    await pro({ disciplineId: "civil" });
    await pro({ disciplineId: "coastal", affiliationVerified: true });
    await pro({ disciplineId: "coastal", visibility: "members" });

    const all = await directory();
    expect(all.facets.disciplines).toEqual([
      { id: "civil", count: 2 },
      { id: "coastal", count: 1 },
    ]);
    // The counts match the cards a visitor would get for each option.
    for (const facet of all.facets.disciplines) {
      expect((await directory(`discipline=${facet.id}`)).total).toBe(facet.count);
    }
    expect((await directory("discipline=civil")).facets.disciplines).toEqual(all.facets.disciplines);
    expect((await directory("verified=1")).facets.disciplines).toEqual([
      { id: "civil", count: 1 },
      { id: "coastal", count: 1 },
    ]);
  });

  it("sorts by name, experience, recent activity and default relevance", async () => {
    const a = await pro({ firstName: "Zed", lastName: "Abbas", yearsExperience: 4, lastActiveDaysAgo: 30 });
    const b = await pro({ firstName: "Amal", lastName: "Bakr", yearsExperience: 30, lastActiveDaysAgo: 1 });
    const c = await pro({
      firstName: "Hana",
      lastName: "Cole",
      yearsExperience: 10,
      lastActiveDaysAgo: 60,
      participation: ["directory", "mentoring"],
      mentor: { status: "active" },
    });

    const order = async (query: string) => (await directory(query)).items.map((item) => item.id);
    expect(await order("sort=name")).toEqual([a, b, c]);
    expect(await order("sort=experience")).toEqual([b, c, a]);
    expect(await order("sort=recent")).toEqual([b, a, c]);
    // Mentors with a free slot first, then the most recently active.
    expect(await order("")).toEqual([c, b, a]);
    expect(await order("sort=relevance")).toEqual([c, b, a]);
  });

  it("pages with page and size and reports the full total", async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) created.push(await pro({ lastName: `Person ${String.fromCharCode(65 + i)}` }));

    const first = await directory("sort=name&size=2");
    expect(first.total).toBe(5);
    expect(first.items.map((item) => item.id)).toEqual(created.slice(0, 2));
    const third = await directory("sort=name&size=2&page=3");
    expect(third.items.map((item) => item.id)).toEqual(created.slice(4));
    const beyond = await directory("sort=name&size=2&page=9");
    expect(beyond).toMatchObject({ items: [], total: 5 });
    expect((await directory()).items).toHaveLength(5);
  });

  it("rejects malformed queries with 400 validation", async () => {
    for (const query of ["size=51", "size=0", "page=0", "sort=random", "mentoring=yes", "experience=5-7", "participation=lurking", "q=" + "x".repeat(201)]) {
      const res = await get(`/api/directory?${query}`);
      expect(res.status, query).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("validation");
    }
  });

  it("paused_platform_returns_empty", async () => {
    await pro();
    const viewer = await member();
    await db.pool.query("UPDATE config SET value = 'true' WHERE key = 'platform_paused'");

    for (const who of [null, viewer]) {
      const res = await directory("", who);
      expect(res).toEqual({ items: [], total: 0, facets: { disciplines: [] }, paused: true });
    }
    await db.pool.query("UPDATE config SET value = 'false' WHERE key = 'platform_paused'");
    expect((await directory()).total).toBe(1);
  });
});

describe("GET /api/profiles/:id", () => {
  it("members_only_profile_returns_403_to_visitor", async () => {
    const id = await pro({ visibility: "members", firstName: "Tariq", lastName: "Mansour" });

    const visitor = await get(`/api/profiles/${id}`);
    expect(visitor.status).toBe(403);
    const body = await visitor.json();
    expect(body).toEqual({ code: "members_only" });

    const viewer = await member();
    const res = await get(`/api/profiles/${id}`, viewer);
    expect(res.status).toBe(200);
    const profile = (await res.json()) as ProfileView;
    expect(profile).toMatchObject({ id, firstName: "Tariq", lastName: "Mansour", visibility: "members", isOwner: false });
    expect(profile.approvalState).toBeUndefined();
  });

  it("profile_pending_visible_to_owner_only", async () => {
    const owner = await pro({ approval: "pending", firstName: "Pending", lastName: "Owner" });
    const viewer = await member();

    const own = await get(`/api/profiles/${owner}`, owner);
    expect(own.status).toBe(200);
    const profile = (await own.json()) as ProfileView;
    expect(profile).toMatchObject({ id: owner, isOwner: true, approvalState: "pending", firstName: "Pending" });

    for (const who of [null, viewer]) {
      const res = await get(`/api/profiles/${owner}`, who);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: "not_found" });
    }
  });

  it("returns the public profile with education, tags and the mentorship offer, and nothing private", async () => {
    const id = await pro({
      email: "private.address@example.test",
      yearsExperience: 7,
      tags: ["Levee design", "Hydraulic modeling"],
      participation: ["directory", "mentoring"],
      mentor: { status: "paused", topics: ["professional-licensure"], audience: ["undergrad"] },
    });
    await asSystem(db.pool, async (client) => {
      await client.query("UPDATE profiles SET linkedin_url = 'https://www.linkedin.com/in/private-link' WHERE id = $1", [id]);
      await client.query(
        "INSERT INTO education (profile_id, degree, field, school, year) VALUES ($1, 'BS', 'Civil Engineering', 'A Louisiana university', 2015)",
        [id],
      );
      await client.query(
        `INSERT INTO contact_preferences (profile_id, methods, share_with_members, booking_url)
         VALUES ($1, '{mest,booking}', '{booking}', 'https://cal.example.test/private-booking')`,
        [id],
      );
    });

    const res = await get(`/api/profiles/${id}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    const profile = JSON.parse(text) as ProfileView;
    expect(profile).toMatchObject({
      id,
      isOwner: false,
      bio: FIXTURE_BIO,
      experienceBand: "3-9",
      tags: ["Hydraulic modeling", "Levee design"],
      education: [{ degree: "BS", field: "Civil Engineering", school: "A Louisiana university", year: 2015 }],
      mentorship: {
        status: "paused",
        topics: ["professional-licensure"],
        audience: ["undergrad"],
        pausedUntil: "2027-01-15",
        hasCapacity: false,
      },
      saved: false,
    });
    expect(text).not.toContain("private.address");
    expect(text).not.toContain("private-link");
    expect(text).not.toContain("private-booking");
    expect(text).not.toMatch(/yearsExperience|maxActive|linkedin/i);
  });

  it("answers 404 for unknown, malformed, student, hidden and administrator-hidden ids", async () => {
    const student = await makePerson(db.pool, { kind: "student", visibility: "hidden" });
    const hidden = await pro({ visibility: "hidden" });
    const adminHidden = await pro({ adminHidden: true });
    const viewer = await member();
    for (const path of ["00000000-0000-4000-8000-000000000000", "not-a-uuid", student, hidden, adminHidden]) {
      expect((await get(`/api/profiles/${path}`, viewer)).status, path).toBe(404);
    }
    // The owner still reads their own hidden profile.
    expect((await get(`/api/profiles/${hidden}`, hidden)).status).toBe(200);
  });
});

describe("meta injection for /network/directory/:id", () => {
  const indexPath = fileURLToPath(new URL("../../../index.html", import.meta.url));
  let webDist: string;

  beforeAll(async () => {
    webDist = await mkdtemp(join(tmpdir(), "mest-meta-"));
    await writeFile(join(webDist, "index.html"), await readFile(indexPath, "utf8"));
  });

  afterAll(async () => {
    await rm(webDist, { recursive: true, force: true });
  });

  it("index.html carries the placeholder the server fills", async () => {
    const html = await readFile(indexPath, "utf8");
    expect(html).toMatch(/<\/title>\s*<!--meta-->/);
  });

  it("meta_indexable_for_public_noindex_for_members", async () => {
    const bio =
      "Coastal engineer working on marsh creation & shoreline protection along the Louisiana coast, with <twenty> years of design and field work behind it all.";
    const layla = await pro({ firstName: "Layla", lastName: "Haddad", title: "Coastal Engineer", bio });
    const tariq = await pro({ firstName: "Tariq", lastName: "Mansour", visibility: "members" });
    const pending = await pro({ firstName: "Pending", lastName: "Person", approval: "pending" });
    const html = await readFile(join(webDist, "index.html"), "utf8");

    const pub = await renderMeta(layla, html, "https://mest.example.test");
    expect(pub).toContain("<title>Layla Haddad, Coastal Engineer · MEST Network</title>");
    expect(pub).not.toContain('name="robots"');
    expect(pub).toContain(`<link rel="canonical" href="https://mest.example.test/network/directory/${layla}" />`);
    expect(pub).toContain('<meta property="og:title" content="Layla Haddad, Coastal Engineer · MEST Network" />');
    expect(pub).toContain('<meta property="og:image" content="https://mest.example.test/og.jpg" />');
    const description = /<meta name="description" content="([^"]*)" \/>/.exec(pub)?.[1];
    expect(description).toBeDefined();
    // The first 150 characters of the bio, escaped.
    expect(description).toBe(
      bio.slice(0, 150).trimEnd().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    );
    expect(pub).toContain(`<meta property="og:description" content="${description}" />`);
    // The landing page's own tags are replaced, not duplicated.
    expect(pub.match(/<title>/g)).toHaveLength(1);
    expect(pub.match(/name="description"/g)).toHaveLength(1);
    expect(pub.match(/property="og:title"/g)).toHaveLength(1);
    expect(pub.match(/property="og:description"/g)).toHaveLength(1);
    expect(pub.match(/property="og:image"/g)).toHaveLength(1);
    expect(pub).not.toContain("<!--meta-->");

    // Members-only, pending and unknown profiles: the default tags, noindex,
    // and nothing that names the person to a crawler.
    for (const id of [tariq, pending, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const out = await renderMeta(id, html, "https://mest.example.test");
      expect(out).toContain('<meta name="robots" content="noindex" />');
      expect(out).not.toMatch(/Tariq|Mansour|Pending Person/);
      expect(out).toContain(html.match(/<title>.*<\/title>/)![0]);
      expect(out).not.toContain('rel="canonical"');
    }
  });

  it("the server serves the profile tags at /network/directory/:id and noindex on other app pages", async () => {
    const layla = await pro({ firstName: "Layla", lastName: "Haddad", title: "Coastal Engineer" });
    const tariq = await pro({ firstName: "Tariq", lastName: "Mansour", visibility: "members" });
    const server = createApp({ webDist, pool: db.pool, cacheIndex: false });

    const pub = await server.request(`/network/directory/${layla}`);
    expect(pub.status).toBe(200);
    expect(pub.headers.get("content-type")).toMatch(/text\/html/);
    const pubHtml = await pub.text();
    expect(pubHtml).toContain("<title>Layla Haddad, Coastal Engineer · MEST Network</title>");
    expect(pubHtml).not.toContain('name="robots"');

    const members = await (await server.request(`/network/directory/${tariq}`)).text();
    expect(members).toContain('<meta name="robots" content="noindex" />');
    expect(members).not.toContain("Tariq");

    for (const path of ["/network", "/network/directory", "/network/me", `/network/directory/${layla}/extra`]) {
      const res = await server.request(path);
      expect(res.status, path).toBe(200);
      const text = await res.text();
      expect(text, path).toContain('<meta name="robots" content="noindex" />');
      expect(text, path).not.toContain("Layla");
    }

    // The landing page stays indexable and carries no placeholder.
    const landing = await (await server.request("/")).text();
    expect(landing).not.toContain('name="robots"');
    expect(landing).not.toContain("<!--meta-->");
  });
});
