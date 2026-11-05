import { afterEach, describe, expect, it, vi } from "vitest";
import { API_HOSTS, enrichJobDraft, parseJobUrl } from "../../src/jobs";
import type { JobDraft } from "../../src/jobs";

const UUID = "5f8a1c2e-1234-4abc-9def-0123456789ab";

type Call = { url: string; init: RequestInit | undefined };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fetch that answers from a map of exact URLs and records every request. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return route();
  }) as typeof fetch;
  return { fn, calls };
}

const draftOf = (url: string): JobDraft => {
  const d = parseJobUrl(url);
  if (!d) throw new Error("fixture url did not parse");
  return d;
};

afterEach(() => {
  vi.restoreAllMocks();
});

const GH_JOB = "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345005";
const GH_BOARD = "https://boards-api.greenhouse.io/v1/boards/acme";
const LEVER_JOB = `https://api.lever.co/v0/postings/acme/${UUID}`;
const ASHBY_BOARD = "https://api.ashbyhq.com/posting-api/job-board/acme";
const SR_JOB = "https://api.smartrecruiters.com/v1/companies/Bosch/postings/743999876543210";
const ASHBY_GQL_JOB = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting";
const ASHBY_GQL_ORG = "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiOrganizationFromHostedJobsPageName";

// Real responses from the live services.
const ASHBY_REAL_ID = "7458d4e9-da2e-47bd-98cb-adfda43d42b2";
const ASHBY_REAL_JOB = { data: { jobPosting: { id: ASHBY_REAL_ID, title: "Engineering Manager - EU", locationName: "Remote - European Union", workplaceType: "Remote", employmentType: "FullTime" } } };
const ASHBY_REAL_ORG = { data: { organization: { name: "Ashby" } } };
const SR_REAL_JOB = "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings/744000159888121";
const SR_REAL = {
  id: "744000159888121", name: "Software Engineer", company: { name: "ServiceNow", identifier: "ServiceNow" },
  location: { city: "Hyderabad", country: "in", address: "Salarpuria Sattva Knowledge City", postalCode: "500081", remote: false, hybrid: true, fullLocation: "Hyderabad, , India" },
};

const bodyOf = (c: Call) => JSON.parse(String(c.init?.body)) as { operationName: string; variables: Record<string, unknown>; query: string };

describe("enrichJobDraft, the four boards", () => {
  it("Greenhouse: title, location and company_name", async () => {
    const { fn, calls } = fakeFetch({
      [GH_JOB]: () => json({ id: 4012345005, title: "Senior Software Engineer, Platform", location: { name: "Toronto, ON" }, company_name: "Acme Corp", absolute_url: "https://boards.greenhouse.io/acme/jobs/4012345005" }),
    });
    const input = draftOf("https://boards.greenhouse.io/acme/jobs/4012345005?gh_src=x");
    const out = await enrichJobDraft(input, { fetch: fn });
    expect(out).toEqual({
      company: "Acme Corp", role: "Senior Software Engineer, Platform", location: "Toronto, ON",
      url: "https://boards.greenhouse.io/acme/jobs/4012345005", source: "api", guessed: { company: false, role: false },
    });
    expect(calls.map((c) => c.url)).toEqual([GH_JOB]);
  });

  it("Greenhouse: falls back to the board name when company_name is missing", async () => {
    const { fn, calls } = fakeFetch({
      [GH_JOB]: () => json({ id: 4012345005, title: "Data Analyst", location: { name: "Remote" } }),
      [GH_BOARD]: () => json({ name: "Acme Inc", content: "<p>About</p>" }),
    });
    const out = await enrichJobDraft(draftOf("https://boards.greenhouse.io/acme/jobs/4012345005"), { fetch: fn });
    expect(out).toMatchObject({ company: "Acme Inc", role: "Data Analyst", location: "Remote", source: "api", guessed: { company: false, role: false } });
    expect(calls).toHaveLength(2);
  });

  it("Greenhouse: still enriches the role when the board name is unavailable, keeping the guessed company", async () => {
    const { fn } = fakeFetch({ [GH_JOB]: () => json({ id: 4012345005, title: "Data Analyst" }) });
    const input = draftOf("https://boards.greenhouse.io/acme/jobs/4012345005");
    const out = await enrichJobDraft(input, { fetch: fn });
    expect(out).toMatchObject({ company: "Acme", role: "Data Analyst", source: "api", guessed: { company: true, role: false } });
  });

  it("Greenhouse on a company career page with gh_jid", async () => {
    const { fn, calls } = fakeFetch({
      [GH_JOB]: () => json({ id: 4012345005, title: "Product Designer", location: { name: "Montreal" }, company_name: "Acme" }),
    });
    const out = await enrichJobDraft(draftOf("https://acme.com/careers/openings?gh_jid=4012345005"), { fetch: fn });
    expect(out).toMatchObject({ role: "Product Designer", location: "Montreal", url: "https://acme.com/careers/openings?gh_jid=4012345005" });
    expect(calls[0].url).toBe(GH_JOB);
  });

  it("Greenhouse: a job id that does not match means the wrong board, so nothing changes", async () => {
    const { fn } = fakeFetch({ [GH_JOB]: () => json({ id: 999, title: "Someone else", company_name: "Other" }) });
    const input = draftOf("https://acme.com/careers/openings?gh_jid=4012345005");
    expect(await enrichJobDraft(input, { fetch: fn })).toBe(input);
  });

  it("Lever: title and location, company stays the guessed slug", async () => {
    const { fn, calls } = fakeFetch({
      [LEVER_JOB]: () => json({ id: UUID, text: "Product Designer", categories: { location: "Remote - Canada", team: "Design" }, hostedUrl: "https://jobs.lever.co/acme/x" }),
    });
    const out = await enrichJobDraft(draftOf(`https://jobs.lever.co/acme/${UUID}/apply?lever-source=x`), { fetch: fn });
    expect(out).toMatchObject({ company: "Acme", role: "Product Designer", location: "Remote - Canada", source: "api", guessed: { company: true, role: false } });
    expect(calls[0].url).toBe(LEVER_JOB);
  });

  it("Lever EU uses the EU API host", async () => {
    const url = `https://api.eu.lever.co/v0/postings/acme/${UUID}`;
    const { fn, calls } = fakeFetch({ [url]: () => json({ text: "Backend Engineer", categories: { location: "Berlin" } }) });
    const out = await enrichJobDraft(draftOf(`https://jobs.eu.lever.co/acme/${UUID}`), { fetch: fn });
    expect(out).toMatchObject({ role: "Backend Engineer", location: "Berlin", source: "api" });
    expect(calls[0].url).toBe(url);
  });

  it("Ashby: fallback to the board listing finds the job by id when GraphQL is unavailable", async () => {
    const { fn, calls } = fakeFetch({
      [ASHBY_BOARD]: () =>
        json({
          apiVersion: "1",
          jobs: [
            { id: "11111111-1111-4111-8111-111111111111", title: "Other job", location: "Paris" },
            { id: UUID.toUpperCase(), title: "Staff Engineer", location: "New York, NY" },
          ],
        }),
    });
    const out = await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`), { fetch: fn });
    expect(out).toMatchObject({ company: "Acme", role: "Staff Engineer", location: "New York, NY", source: "api", guessed: { company: true, role: false } });
    expect(calls.map((c) => c.url).sort()).toEqual([ASHBY_BOARD, ASHBY_GQL_JOB, ASHBY_GQL_ORG].sort());
  });

  it("Ashby: the listing fallback uses the organization name when the API gives one", async () => {
    const { fn } = fakeFetch({ [ASHBY_BOARD]: () => json({ organizationName: "Acme Labs", jobs: [{ id: UUID, title: "Staff Engineer" }] }) });
    const out = await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`), { fetch: fn });
    expect(out).toMatchObject({ company: "Acme Labs", guessed: { company: false, role: false } });
  });

  it("Ashby: a job that is in neither GraphQL nor the listing leaves the draft alone", async () => {
    const { fn } = fakeFetch({ [ASHBY_BOARD]: () => json({ jobs: [{ id: "other", title: "x" }] }) });
    const input = draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`);
    expect(await enrichJobDraft(input, { fetch: fn })).toBe(input);
  });

  it("Ashby GraphQL: role and location from the job query, confirmed company from the org query", async () => {
    const { fn, calls } = fakeFetch({ [ASHBY_GQL_JOB]: () => json(ASHBY_REAL_JOB), [ASHBY_GQL_ORG]: () => json(ASHBY_REAL_ORG) });
    const out = await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/ashby/${ASHBY_REAL_ID}?utm_source=x`), { fetch: fn });
    expect(out).toEqual({
      company: "Ashby", role: "Engineering Manager - EU", location: "Remote - European Union",
      url: `https://jobs.ashbyhq.com/ashby/${ASHBY_REAL_ID}`, source: "api", guessed: { company: false, role: false },
    });
    // No REST listing request when GraphQL answers.
    expect(calls.map((c) => c.url).sort()).toEqual([ASHBY_GQL_JOB, ASHBY_GQL_ORG].sort());
  });

  it("Ashby GraphQL: both calls are hardened POSTs with the fixed query and JSON variables", async () => {
    const { fn, calls } = fakeFetch({ [ASHBY_GQL_JOB]: () => json(ASHBY_REAL_JOB), [ASHBY_GQL_ORG]: () => json(ASHBY_REAL_ORG) });
    await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/ashby/${ASHBY_REAL_ID}`), { fetch: fn });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const init = c.init as RequestInit;
      expect(init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", mode: "cors", redirect: "error", headers: { "content-type": "application/json" } });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    const job = bodyOf(calls.find((c) => c.url === ASHBY_GQL_JOB)!);
    expect(job.operationName).toBe("ApiJobPosting");
    expect(job.variables).toEqual({ organizationHostedJobsPageName: "ashby", jobPostingId: ASHBY_REAL_ID });
    expect(job.query).toContain("jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId)");
    expect(job.query).not.toContain(ASHBY_REAL_ID);
    const orgCall = bodyOf(calls.find((c) => c.url === ASHBY_GQL_ORG)!);
    expect(orgCall.operationName).toBe("ApiOrganizationFromHostedJobsPageName");
    expect(orgCall.variables).toEqual({ organizationHostedJobsPageName: "ashby", searchContext: "JobBoard" });
  });

  it("Ashby GraphQL: the query text is the same constant for every board and id", async () => {
    const queries = new Set<string>();
    for (const [slug, id] of [["acme", UUID], ["other-co", ASHBY_REAL_ID]]) {
      const { fn, calls } = fakeFetch({});
      await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/${slug}/${id}`), { fetch: fn });
      for (const c of calls.filter((x) => x.init?.method === "POST")) {
        const b = bodyOf(c);
        queries.add(`${b.operationName}:${b.query}`);
        expect(b.query).not.toContain(slug);
        expect(b.query).not.toContain(id);
      }
    }
    expect(queries.size).toBe(2);
  });

  it("Ashby GraphQL: a null job falls back to the REST listing, keeping the confirmed company", async () => {
    const { fn, calls } = fakeFetch({
      [ASHBY_GQL_JOB]: () => json({ data: { jobPosting: null } }),
      [ASHBY_GQL_ORG]: () => json(ASHBY_REAL_ORG),
      [`https://api.ashbyhq.com/posting-api/job-board/ashby`]: () => json({ jobs: [{ id: ASHBY_REAL_ID, title: "Engineering Manager - EU", location: "Remote" }] }),
    });
    const out = await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/ashby/${ASHBY_REAL_ID}`), { fetch: fn });
    expect(out).toMatchObject({ company: "Ashby", role: "Engineering Manager - EU", location: "Remote", guessed: { company: false, role: false } });
    expect(calls).toHaveLength(3);
  });

  it("Ashby GraphQL: a null job and a listing without it leaves the draft unchanged", async () => {
    const { fn } = fakeFetch({
      [ASHBY_GQL_JOB]: () => json({ data: { jobPosting: null } }),
      [ASHBY_GQL_ORG]: () => json(ASHBY_REAL_ORG),
      [ASHBY_BOARD]: () => json({ jobs: [] }),
    });
    const input = draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`);
    expect(await enrichJobDraft(input, { fetch: fn })).toBe(input);
  });

  it("Ashby GraphQL: a job whose id differs from the link is not used", async () => {
    const wrong = { data: { jobPosting: { ...ASHBY_REAL_JOB.data.jobPosting, id: "11111111-1111-4111-8111-111111111111" } } };
    const { fn } = fakeFetch({ [ASHBY_GQL_JOB]: () => json(wrong), [ASHBY_GQL_ORG]: () => json(ASHBY_REAL_ORG) });
    const input = draftOf(`https://jobs.ashbyhq.com/ashby/${ASHBY_REAL_ID}`);
    expect(await enrichJobDraft(input, { fetch: fn })).toBe(input);
  });

  it("Ashby GraphQL: org lookup fails but the job succeeds, so the company stays the guessed slug", async () => {
    const { fn, calls } = fakeFetch({ [ASHBY_GQL_JOB]: () => json(ASHBY_REAL_JOB), [ASHBY_GQL_ORG]: () => json({ data: { organization: null } }) });
    const out = await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/acme-labs/${ASHBY_REAL_ID}`), { fetch: fn });
    expect(out).toMatchObject({ company: "Acme Labs", role: "Engineering Manager - EU", location: "Remote - European Union", source: "api", guessed: { company: true, role: false } });
    expect(calls).toHaveLength(2);
  });

  it("Ashby GraphQL: an org lookup that errors out (HTTP 500) is the same", async () => {
    const { fn } = fakeFetch({ [ASHBY_GQL_JOB]: () => json(ASHBY_REAL_JOB), [ASHBY_GQL_ORG]: () => new Response("boom", { status: 500 }) });
    const out = await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/ashby/${ASHBY_REAL_ID}`), { fetch: fn });
    expect(out).toMatchObject({ company: "Ashby", role: "Engineering Manager - EU", guessed: { company: true, role: false } });
  });

  it("Ashby GraphQL: workplace type only adds information that the location lacks", async () => {
    const answer = (locationName: string, workplaceType: string) =>
      fakeFetch({ [ASHBY_GQL_JOB]: () => json({ data: { jobPosting: { id: UUID, title: "Designer", locationName, workplaceType } } }), [ASHBY_GQL_ORG]: () => json(ASHBY_REAL_ORG) }).fn;
    const run = async (loc: string, wt: string) => (await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`), { fetch: answer(loc, wt) })).location;
    expect(await run("Toronto", "Remote")).toBe("Toronto (Remote)");
    expect(await run("", "Remote")).toBe("Remote");
    expect(await run("Remote - Canada", "Remote")).toBe("Remote - Canada");
    expect(await run("London", "Hybrid")).toBe("London (Hybrid)");
    expect(await run("New York", "OnSite")).toBe("New York");
  });

  it("Ashby GraphQL: a 5 MB reply is refused and the listing fallback is tried", async () => {
    const huge = JSON.stringify({ data: { jobPosting: { id: UUID, title: "Designer", pad: "x".repeat(5 * 1024 * 1024) } } });
    const { fn, calls } = fakeFetch({ [ASHBY_GQL_JOB]: () => new Response(huge), [ASHBY_GQL_ORG]: () => json(ASHBY_REAL_ORG) });
    const input = draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`);
    expect(await enrichJobDraft(input, { fetch: fn })).toBe(input);
    expect(calls.map((c) => c.url)).toContain(ASHBY_BOARD);
  });

  it("Ashby GraphQL: strips markup and caps the strings it returns", async () => {
    const { fn } = fakeFetch({
      [ASHBY_GQL_JOB]: () => json({ data: { jobPosting: { id: UUID, title: "<b>Designer</b>\u0000 " + "R".repeat(300), locationName: "<i>Paris</i>\u0007" + "L".repeat(300) } } }),
      [ASHBY_GQL_ORG]: () => json({ data: { organization: { name: "<script>Acme</script> " + "C".repeat(300) } } }),
    });
    const out = await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`), { fetch: fn });
    expect(out.role).toHaveLength(90);
    expect(out.location).toHaveLength(80);
    expect(out.company).toHaveLength(60);
    for (const v of [out.role, out.location, out.company]) expect(v).not.toMatch(/[<>\u0000-\u001f]/);
  });

  it("Ashby listing fallback: reads up to 4 MB, where other boards stop at 1 MB", async () => {
    const jobs = [{ id: UUID, title: "Staff Engineer", location: "Berlin", descriptionHtml: "x".repeat(2 * 1024 * 1024) }];
    const { fn } = fakeFetch({ [ASHBY_BOARD]: () => new Response(JSON.stringify({ jobs })) });
    const out = await enrichJobDraft(draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`), { fetch: fn });
    expect(out).toMatchObject({ role: "Staff Engineer", location: "Berlin", source: "api" });
  });

  it("Ashby listing fallback: still bounded, a 5 MB listing is refused (declared or streamed)", async () => {
    const big = JSON.stringify({ jobs: [{ id: UUID, title: "Staff Engineer", pad: "x".repeat(5 * 1024 * 1024) }] });
    const input = draftOf(`https://jobs.ashbyhq.com/acme/${UUID}`);
    const streamed = fakeFetch({ [ASHBY_BOARD]: () => new Response(big) });
    expect(await enrichJobDraft(input, { fetch: streamed.fn })).toBe(input);
    const declared = fakeFetch({ [ASHBY_BOARD]: () => new Response(JSON.stringify({ jobs: [] }), { headers: { "content-length": String(5 * 1024 * 1024) } }) });
    expect(await enrichJobDraft(input, { fetch: declared.fn })).toBe(input);
  });

  it("the raised cap applies to Ashby's listing only", async () => {
    const mid = JSON.stringify({ text: "Designer", pad: "x".repeat(2 * 1024 * 1024) });
    const input = draftOf(`https://jobs.lever.co/acme/${UUID}`);
    const { fn } = fakeFetch({ [LEVER_JOB]: () => new Response(mid) });
    expect(await enrichJobDraft(input, { fetch: fn })).toBe(input);
  });

  it("Ashby: board slug and job id are JSON values, never part of the query text or URL", async () => {
    // Anything that is not a plain slug or uuid-like id never reaches the network.
    for (const url of [
      `https://jobs.ashbyhq.com/acme%22%7D/${UUID}`,
      `https://jobs.ashbyhq.com/acme/${UUID}%22%2C%22x%22%3A1`,
      `https://jobs.ashbyhq.com/acme%5C/${UUID}`,
      `https://jobs.ashbyhq.com/a%20b/${UUID}`,
      `https://jobs.ashbyhq.com/acme/${UUID}%7D%7D%20mutation`,
    ]) {
      const { fn, calls } = fakeFetch({});
      const draft: JobDraft = { company: "", role: "", location: "", url, source: "link", guessed: { company: false, role: false } };
      expect(await enrichJobDraft(draft, { fetch: fn })).toBe(draft);
      expect(calls).toHaveLength(0);
    }
    // The allowed characters cannot break out of a JSON string.
    const { fn, calls } = fakeFetch({});
    await enrichJobDraft(draftOf("https://jobs.ashbyhq.com/a.b_c-d/ABC-123-def"), { fetch: fn });
    const posts = calls.filter((c) => c.init?.method === "POST").map(bodyOf);
    expect(posts).toHaveLength(2);
    for (const b of posts) expect(b.variables.organizationHostedJobsPageName).toBe("a.b_c-d");
    expect(posts[0].variables.jobPostingId).toBe("ABC-123-def");
  });

  it("SmartRecruiters: name, city, country and company", async () => {
    const { fn, calls } = fakeFetch({
      [SR_JOB]: () => json({ id: "743999876543210", name: "Data Analyst", company: { identifier: "Bosch", name: "Bosch Group" }, location: { city: "Berlin", country: "de" } }),
    });
    const out = await enrichJobDraft(draftOf("https://jobs.smartrecruiters.com/Bosch/743999876543210-data-analyst"), { fetch: fn });
    expect(out).toMatchObject({ company: "Bosch Group", role: "Data Analyst", location: "Berlin, Germany", source: "api", guessed: { company: false, role: false } });
    expect(calls[0].url).toBe(SR_JOB);
  });

  it("SmartRecruiters: the live ServiceNow posting, with the empty segment in fullLocation cleaned", async () => {
    const { fn, calls } = fakeFetch({ [SR_REAL_JOB]: () => json(SR_REAL) });
    const out = await enrichJobDraft(draftOf("https://jobs.smartrecruiters.com/ServiceNow/744000159888121-software-engineer"), { fetch: fn });
    expect(out).toMatchObject({ company: "ServiceNow", role: "Software Engineer", location: "Hyderabad, India", source: "api", guessed: { company: false, role: false } });
    expect(out.location).not.toMatch(/Salarpuria|500081|\bin\b/);
    expect(calls[0].url).toBe(SR_REAL_JOB);
  });

  describe("SmartRecruiters location", () => {
    const where = async (location: unknown) => {
      const { fn } = fakeFetch({ [SR_REAL_JOB]: () => json({ ...SR_REAL, location }) });
      return (await enrichJobDraft(draftOf("https://jobs.smartrecruiters.com/ServiceNow/744000159888121"), { fetch: fn })).location;
    };
    it.each([
      ["empty segments dropped", { fullLocation: "Hyderabad, , India" }, "Hyderabad, India"],
      ["leading and trailing commas", { fullLocation: ", Toronto,  Ontario ,, Canada, " }, "Toronto, Ontario, Canada"],
      ["whitespace collapsed", { fullLocation: "New   York ,\n  United  States" }, "New York, United States"],
      ["city and country name when fullLocation is empty", { fullLocation: " , ", city: "Berlin", country: "de" }, "Berlin, Germany"],
      ["country only", { country: "ca" }, "Canada"],
      ["a code that has no name is upper-cased", { country: "zz" }, "ZZ"],
      ["a lowercase code part in fullLocation is not shown as is", { fullLocation: "Pune, in" }, "Pune, India"],
      ["a US state code is left alone", { fullLocation: "San Francisco, CA, United States" }, "San Francisco, CA, United States"],
      ["remote", { remote: true, fullLocation: "Hyderabad, , India" }, "Remote"],
      ["remote with a city", { remote: true, city: "Hyderabad", fullLocation: "Hyderabad, , India" }, "Remote (Hyderabad)"],
      ["never the street address or postal code", { address: "1 Main St", postalCode: "M5V 2T6", city: "Toronto", country: "ca" }, "Toronto, Canada"],
      ["nothing usable", { address: "1 Main St", postalCode: "123" }, ""],
      ["not an object", "Hyderabad", ""],
    ])("%s", async (_n, location, expected) => {
      expect(await where(location)).toBe(expected);
    });
  });

  it("Lever: a remote workplace type is added when the location does not say so", async () => {
    const run = async (body: Record<string, unknown>) => {
      const { fn } = fakeFetch({ [LEVER_JOB]: () => json({ text: "Designer", ...body }) });
      return (await enrichJobDraft(draftOf(`https://jobs.lever.co/acme/${UUID}`), { fetch: fn })).location;
    };
    expect(await run({ categories: { location: "Toronto" }, workplaceType: "remote" })).toBe("Toronto (Remote)");
    expect(await run({ categories: { location: "Remote - Canada" }, workplaceType: "remote" })).toBe("Remote - Canada");
    expect(await run({ categories: {}, workplaceType: "remote" })).toBe("Remote");
    expect(await run({ categories: { location: "Berlin" }, workplaceType: "on-site" })).toBe("Berlin");
    expect(await run({ categories: { location: "Berlin" }, workplaceType: "unspecified" })).toBe("Berlin");
  });

  it("Lever: with no location, up to two of allLocations are joined", async () => {
    const run = async (categories: Record<string, unknown>) => {
      const { fn } = fakeFetch({ [LEVER_JOB]: () => json({ text: "Designer", categories }) });
      return (await enrichJobDraft(draftOf(`https://jobs.lever.co/acme/${UUID}`), { fetch: fn })).location;
    };
    expect(await run({ location: "", allLocations: ["Toronto", "Montreal", "Vancouver"] })).toBe("Toronto, Montreal");
    expect(await run({ allLocations: ["Toronto"] })).toBe("Toronto");
    expect(await run({ location: "Berlin", allLocations: ["Toronto", "Montreal"] })).toBe("Berlin");
    expect(await run({ allLocations: [null, 4, "", "Paris"] })).toBe("Paris");
  });

  it("Lever: the company is still a guess from the slug and marked as one", async () => {
    const { fn } = fakeFetch({ [LEVER_JOB]: () => json({ text: "Designer" }) });
    const out = await enrichJobDraft(draftOf(`https://jobs.lever.co/acme_labs-2/${UUID}`), { fetch: fn });
    expect(out).toMatchObject({ company: "Acme Labs 2", guessed: { company: true, role: false } });
  });

  it("keeps an existing location when the API has none", async () => {
    const { fn } = fakeFetch({ [LEVER_JOB]: () => json({ text: "Designer", categories: {} }) });
    const input = { ...draftOf(`https://jobs.lever.co/acme/${UUID}`), location: "Toronto" };
    expect((await enrichJobDraft(input, { fetch: fn })).location).toBe("Toronto");
  });
});

describe("enrichJobDraft, request rules", () => {
  it("sends only the fixed request options and never a header", async () => {
    const { fn, calls } = fakeFetch({ [LEVER_JOB]: () => json({ text: "Designer" }) });
    await enrichJobDraft(draftOf(`https://jobs.lever.co/acme/${UUID}`), { fetch: fn });
    const init = calls[0].init as RequestInit;
    expect(init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", mode: "cors", method: "GET" });
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("only ever talks to the six API hosts, including jobs.ashbyhq.com", async () => {
    const { fn, calls } = fakeFetch({});
    const urls = [
      "https://boards.greenhouse.io/acme/jobs/1",
      "https://boards.eu.greenhouse.io/acme/jobs/1",
      "https://acme.com/careers?gh_jid=77",
      `https://jobs.lever.co/acme/${UUID}`,
      `https://jobs.eu.lever.co/acme/${UUID}`,
      `https://jobs.ashbyhq.com/acme/${UUID}`,
      "https://jobs.smartrecruiters.com/Bosch/743999876543210-x-y",
    ];
    for (const u of urls) await enrichJobDraft(draftOf(u), { fetch: fn });
    expect(calls.length).toBeGreaterThanOrEqual(urls.length);
    for (const c of calls) expect(API_HOSTS).toContain(new URL(c.url).host);
    expect(API_HOSTS).toContain("jobs.ashbyhq.com");
    expect(new Set(calls.map((c) => new URL(c.url).host))).toEqual(new Set(API_HOSTS));
  });

  it("makes no request for unknown boards or other sites", async () => {
    const { fn, calls } = fakeFetch({});
    for (const u of [
      "https://www.linkedin.com/jobs/view/senior-engineer-at-acme-3812345678",
      "https://acme.wd5.myworkdayjobs.com/en/job/x/Y_R1",
      "https://ca.indeed.com/viewjob?jk=abc",
      "https://acme.com/careers/senior-engineer",
      "https://apply.workable.com/acme/j/ABC123DEF4/",
      "https://acme.bamboohr.com/careers/45",
    ]) {
      const d = draftOf(u);
      expect(await enrichJobDraft(d, { fetch: fn })).toBe(d);
    }
    expect(calls).toHaveLength(0);
  });

  const INJECTIONS = [
    "https://boards.greenhouse.io/ac%2Fme/jobs/1",
    "https://boards.greenhouse.io/acme%3Fx=1/jobs/1",
    "https://boards.greenhouse.io/acme%23/jobs/1",
    "https://boards.greenhouse.io/ac me/jobs/1",
    "https://boards.greenhouse.io/%2e%2e/jobs/1",
    "https://boards.greenhouse.io/acme/jobs/1%2F..%2F..%2Fx",
    "https://boards.greenhouse.io/../jobs/1",
    `https://jobs.lever.co/acme/..%2f..%2fsecrets`,
    `https://jobs.lever.co/acme%2f..%2fadmin/${UUID}`,
    `https://jobs.lever.co/acme/${UUID}%0d%0a`,
    "https://jobs.ashbyhq.com/acme%20corp/" + UUID,
    "https://jobs.ashbyhq.com/acme%00/" + UUID,
    "https://jobs.smartrecruiters.com/Acme/12345678%3Fx",
    "https://jobs.smartrecruiters.com/Acme%2f..%2fx/12345678",
    "https://acme.com/careers?gh_jid=1%2F..%2F",
    "https://acme.com/careers?gh_jid=abc",
    "https://evil.com/acme/jobs/1",
    "https://boards.greenhouse.io.evil.com/acme/jobs/1",
    "https://evil.com/?x=boards.greenhouse.io/acme/jobs/1",
    "https://user:pw@boards.greenhouse.io/acme/jobs/1",
    "https://boards.greenhouse.io/" + "a".repeat(81) + "/jobs/1",
    "https://boards.greenhouse.io/acme/jobs/" + "1".repeat(65),
    "javascript:alert(1)",
    "",
    "not a url",
  ];

  it.each(INJECTIONS)("no request for %j", async (url) => {
    const { fn, calls } = fakeFetch({});
    const draft: JobDraft = { company: "", role: "", location: "", url, source: "link", guessed: { company: false, role: false } };
    expect(await enrichJobDraft(draft, { fetch: fn })).toBe(draft);
    expect(calls).toHaveLength(0);
  });

  it("drops a hostile query string from the page url before building the request", async () => {
    const { fn, calls } = fakeFetch({});
    await enrichJobDraft(draftOf("https://boards.greenhouse.io/acme/jobs/1?x=/../..&y=%2f"), { fetch: fn });
    expect(calls.map((c) => c.url)).toEqual(["https://boards-api.greenhouse.io/v1/boards/acme/jobs/1"]);
  });

  it("does not follow a response that came from another host", async () => {
    const fake = { ok: true, status: 200, url: "https://evil.example/x", headers: new Headers(), text: async () => JSON.stringify({ text: "Pwned" }) } as unknown as Response;
    const input = draftOf(`https://jobs.lever.co/acme/${UUID}`);
    expect(await enrichJobDraft(input, { fetch: (async () => fake) as typeof fetch })).toBe(input);
  });

  it("clears its timer when the request finishes", async () => {
    const spy = vi.spyOn(globalThis, "clearTimeout");
    const { fn } = fakeFetch({ [LEVER_JOB]: () => json({ text: "Designer" }) });
    await enrichJobDraft(draftOf(`https://jobs.lever.co/acme/${UUID}`), { fetch: fn });
    expect(spy).toHaveBeenCalled();
  });
});

describe("enrichJobDraft, failures return the input unchanged", () => {
  const url = `https://jobs.lever.co/acme/${UUID}`;
  const expectUnchanged = async (fn: typeof fetch, opts: { timeoutMs?: number; signal?: AbortSignal } = {}) => {
    const input = draftOf(url);
    const copy = structuredClone(input);
    const out = await enrichJobDraft(input, { fetch: fn, ...opts });
    expect(out).toBe(input);
    expect(input).toEqual(copy);
  };

  it("404 and 500", async () => {
    await expectUnchanged((async () => new Response("nope", { status: 404 })) as typeof fetch);
    await expectUnchanged((async () => new Response("boom", { status: 500 })) as typeof fetch);
  });

  it("bad JSON", async () => {
    await expectUnchanged((async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch);
    await expectUnchanged((async () => new Response("", { status: 200 })) as typeof fetch);
  });

  it("a body over 1 MB", async () => {
    const big = JSON.stringify({ text: "Designer", pad: "x".repeat(2 * 1024 * 1024) });
    await expectUnchanged((async () => new Response(big, { status: 200 })) as typeof fetch);
  });

  it("a declared content length over 1 MB", async () => {
    const res = new Response(JSON.stringify({ text: "Designer" }), { status: 200, headers: { "content-length": String(5 * 1024 * 1024) } });
    await expectUnchanged((async () => res) as typeof fetch);
  });

  it("wrong shapes", async () => {
    for (const body of [null, [], "text", 42, {}, { text: 12 }, { text: "" }, { text: "   " }, { jobs: [] }, [{ text: "x" }]]) {
      await expectUnchanged((async () => json(body)) as typeof fetch);
    }
  });

  it("fetch that throws or rejects", async () => {
    await expectUnchanged((async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch);
    await expectUnchanged((() => {
      throw new Error("sync throw");
    }) as typeof fetch);
  });

  it("timeout, with a fetch that honors the signal", async () => {
    const hang = ((_: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    await expectUnchanged(hang, { timeoutMs: 25 });
  });

  it("timeout, with a fetch that ignores the signal", async () => {
    await expectUnchanged((() => new Promise<Response>(() => undefined)) as typeof fetch, { timeoutMs: 25 });
  });

  it("timeout while the body is still streaming", async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} });
    await expectUnchanged((async () => new Response(stream, { status: 200 })) as typeof fetch, { timeoutMs: 25 });
  });

  it("a caller signal that is already aborted, or aborts mid-flight", async () => {
    const pre = new AbortController();
    pre.abort();
    const { fn, calls } = fakeFetch({ [LEVER_JOB]: () => json({ text: "Designer" }) });
    await expectUnchanged(fn, { signal: pre.signal });
    expect(calls).toHaveLength(0);

    const mid = new AbortController();
    const slow = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    const p = expectUnchanged(slow, { signal: mid.signal });
    setTimeout(() => mid.abort(), 10);
    await p;
  });

  it("a draft that is not an object", async () => {
    const out = await enrichJobDraft(null as unknown as JobDraft, { fetch: (async () => json({})) as typeof fetch });
    expect(out).toBeNull();
  });
});

describe("enrichJobDraft, untrusted strings", () => {
  const url = `https://jobs.lever.co/acme/${UUID}`;

  it("strips tags and control characters and collapses whitespace", async () => {
    const { fn } = fakeFetch({
      [LEVER_JOB]: () =>
        json({
          text: "  <b>Senior</b>\u0000 Engineer\u0007\n\t<img src=x onerror=alert(1)>  (Remote) <script",
          categories: { location: "Toronto,\u200b ON\r\n<i>Canada</i>" },
        }),
    });
    const out = await enrichJobDraft(draftOf(url), { fetch: fn });
    expect(out.role).toBe("Senior Engineer (Remote)");
    expect(out.location).toBe("Toronto, ON Canada");
    for (const v of [out.role, out.location, out.company]) {
      expect(v).not.toMatch(/[<>\u0000-\u001f\u007f-\u009f]/);
    }
  });

  it("caps lengths: company 60, role 90, location 80", async () => {
    const { fn } = fakeFetch({
      [SR_JOB]: () =>
        json({ id: "743999876543210", name: "R".repeat(500), company: { name: "C".repeat(500) }, location: { fullLocation: "L".repeat(500) } }),
    });
    const out = await enrichJobDraft(draftOf("https://jobs.smartrecruiters.com/Bosch/743999876543210-x-y"), { fetch: fn });
    expect(out.role).toHaveLength(90);
    expect(out.company).toHaveLength(60);
    expect(out.location).toHaveLength(80);
  });

  it("decodes only harmless entities and never produces markup", async () => {
    const { fn } = fakeFetch({ [LEVER_JOB]: () => json({ text: "R&amp;D Engineer &lt;script&gt;" }) });
    const out = await enrichJobDraft(draftOf(url), { fetch: fn });
    expect(out.role).toBe("R&D Engineer &lt;script&gt");
  });

  it("a title that is only markup counts as missing", async () => {
    const { fn } = fakeFetch({ [LEVER_JOB]: () => json({ text: "<br><br>" }) });
    const input = draftOf(url);
    expect(await enrichJobDraft(input, { fetch: fn })).toBe(input);
  });

  it("does not use any other field of the response, such as links", async () => {
    const { fn } = fakeFetch({
      [LEVER_JOB]: () => json({ text: "Designer", hostedUrl: "https://evil.example/phish", applyUrl: "javascript:alert(1)" }),
    });
    const out = await enrichJobDraft(draftOf(url), { fetch: fn });
    expect(out.url).toBe(url);
  });
});
