#!/usr/bin/env node
// Checks, against the real services, that a browser on the hosted site's origin may still call them. The unit tests prove
// the app behaves given a scripted answer; they cannot tell us that Google or a job board stopped sending CORS headers.
//
// Run it by hand now and then (and before a release): `node web/scripts/probe-cors.mjs [origin]`. It is not part of CI,
// because it needs the network and a third party's uptime. It needs no login: an invalid token or a made-up job id is
// enough, because an error answer with the right headers still proves a browser may read it. Exit code 1 if any probe fails.
//
// What it does not prove: that a real token is accepted (that needs credentials), or what happens behind a content blocker.
const ORIGIN = process.argv[2] ?? "https://thornleung01.github.io";
const TIMEOUT_MS = 15_000;

/** Same endpoints and shapes the app uses: src/auth/google.ts (tokeninfo) and src/jobs/enrich.ts (job boards). */
const probes = [
  {
    name: "Google tokeninfo, POST with a form body",
    url: "https://oauth2.googleapis.com/tokeninfo",
    init: { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ access_token: "invalid" }) },
    status: 400,
   
  },
  {
    name: "Google tokeninfo, preflight for that POST",
    url: "https://oauth2.googleapis.com/tokeninfo",
    init: { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } },
    statusIn: [200, 204],
   
    allowHeaders: "content-type",
  },
  {
    name: "Google tokeninfo, GET fallback",
    url: "https://oauth2.googleapis.com/tokeninfo?access_token=invalid",
    init: { method: "GET" },
    status: 400,
   
  },
  { name: "Greenhouse job", url: "https://boards-api.greenhouse.io/v1/boards/doesnotexist-probe/jobs/1", init: { method: "GET" }, statusIn: [404], },
  { name: "Lever job", url: "https://api.lever.co/v0/postings/doesnotexist-probe/00000000-0000-0000-0000-000000000000", init: { method: "GET" }, statusIn: [404], },
  { name: "Lever (EU) job", url: "https://api.eu.lever.co/v0/postings/doesnotexist-probe/00000000-0000-0000-0000-000000000000", init: { method: "GET" }, statusIn: [404], },
  { name: "Ashby job board", url: "https://api.ashbyhq.com/posting-api/job-board/doesnotexist-probe", init: { method: "GET" }, statusIn: [404], },
  { name: "SmartRecruiters posting", url: "https://api.smartrecruiters.com/v1/companies/doesnotexist-probe/postings/1", init: { method: "GET" }, statusIn: [404], },
  {
    name: "Ashby GraphQL, preflight",
    url: "https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting",
    init: { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } },
    statusIn: [200, 204],
   
    allowHeaders: "content-type",
  },
];

async function run(p) {
  const problems = [];
  let res;
  try {
    res = await fetch(p.url, { ...p.init, headers: { Origin: ORIGIN, ...p.init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
  } catch (e) {
    return { problems: [`no answer: ${e.cause?.code ?? e.message}`], status: "-" };
  }
  const wanted = p.statusIn ?? [p.status];
  if (!wanted.includes(res.status)) problems.push(`status ${res.status}, expected ${wanted.join(" or ")}`);
  const allow = res.headers.get("access-control-allow-origin");
  if (allow !== "*" && allow !== ORIGIN) problems.push(`access-control-allow-origin is ${allow === null ? "missing" : JSON.stringify(allow)}`);
  if (p.allowHeaders) {
    const headers = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    if (headers !== "*" && !headers.split(",").map((h) => h.trim()).includes(p.allowHeaders)) problems.push(`access-control-allow-headers lacks ${p.allowHeaders} (${headers || "missing"})`);
  }
  return { problems, status: res.status, allow };
}

console.log(`Probing from origin ${ORIGIN}\n`);
let failed = 0;
for (const p of probes) {
  const { problems, status, allow } = await run(p);
  if (problems.length) failed++;
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${p.name}  [${status}${allow ? `, allow-origin ${allow}` : ""}]${problems.map((m) => `\n        ${m}`).join("")}`);
}
console.log(failed ? `\n${failed} of ${probes.length} probes failed.` : `\nAll ${probes.length} probes passed.`);
process.exit(failed ? 1 : 0);
