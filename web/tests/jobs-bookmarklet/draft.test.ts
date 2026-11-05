import { describe, expect, it } from "vitest";
import { draftFromHash } from "../../src/jobs/bookmarklet";

const q = (s: string) => new URLSearchParams(s);

describe("draftFromHash", () => {
  it("returns null unless add=1", () => {
    expect(draftFromHash(q(""))).toBeNull();
    expect(draftFromHash(q("c=Acme&r=Dev"))).toBeNull();
    expect(draftFromHash(q("add=0&c=Acme"))).toBeNull();
    expect(draftFromHash(q("add=true&c=Acme"))).toBeNull();
    expect(draftFromHash(q("add=11"))).toBeNull();
  });

  it("builds a bookmarklet draft with reliable fields by default", () => {
    expect(draftFromHash(q("add=1&c=Acme&r=Designer&l=Toronto%2C+ON&u=https%3A%2F%2Facme.com%2Fjobs%2F1&s=bm"))).toEqual({
      company: "Acme",
      role: "Designer",
      location: "Toronto, ON",
      url: "https://acme.com/jobs/1",
      source: "bookmarklet",
      guessed: { company: false, role: false },
    });
  });

  it("reads the guess flags: 1 company, 2 role, 3 both, anything else none", () => {
    const g = (v: string) => draftFromHash(q(`add=1&c=A&r=B&g=${v}`))!.guessed;
    expect(g("1")).toEqual({ company: true, role: false });
    expect(g("2")).toEqual({ company: false, role: true });
    expect(g("3")).toEqual({ company: true, role: true });
    expect(g("0")).toEqual({ company: false, role: false });
    for (const bad of ["7", "-1", "x", "", "1.5", "3abc"]) expect(g(bad), bad).toEqual({ company: false, role: false });
  });

  it("does not flag a field that is empty", () => {
    expect(draftFromHash(q("add=1&g=3"))!.guessed).toEqual({ company: false, role: false });
  });

  it("caps oversize fields at 60, 90, 80 and 500", () => {
    const d = draftFromHash(q(`add=1&c=${"c".repeat(5000)}&r=${"r".repeat(5000)}&l=${"l".repeat(5000)}&u=https://a.com/${"u".repeat(5000)}`))!;
    expect(d.company).toHaveLength(60);
    expect(d.role).toHaveLength(90);
    expect(d.location).toHaveLength(80);
    expect(d.url).toBe(""); // too long even without a query string
    const ok = draftFromHash(q(`add=1&u=https://a.com/p?${"x".repeat(900)}`))!;
    expect(ok.url).toBe("https://a.com/p");
  });

  it("strips control and bidi characters and collapses whitespace", () => {
    const d = draftFromHash(new URLSearchParams({ add: "1", c: "Ac\u0000me\u0007  \n Corp‮", r: "\t Dev ​ ops \u0085", l: "To\u001fronto" }))!;
    expect(d.company).toBe("Acme Corp");
    expect(d.role).toBe("Dev ops");
    expect(d.location).toBe("Toronto");
  });

  it("keeps markup as inert text (callers render text only)", () => {
    const d = draftFromHash(q("add=1&c=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E"))!;
    expect(d.company).toBe("<img src=x onerror=alert(1)>");
  });

  it("accepts only http(s) URLs without credentials", () => {
    const u = (v: string) => draftFromHash(new URLSearchParams({ add: "1", u: v }))!.url;
    expect(u("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(u("http://example.com/a")).toBe("http://example.com/a");
    for (const bad of [
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd", "ftp://example.com/x",
      "https://user:pw@example.com/", "https://user@example.com/", "//example.com/x", "example.com/x", "not a url", "https://", "",
    ]) expect(u(bad), bad).toBe("");
  });

  it("ignores unknown parameters", () => {
    const d = draftFromHash(q("add=1&c=Acme&evil=<script>&__proto__=x&constructor=y&source=api&guessed=1"))!;
    expect(d).toEqual({ company: "Acme", role: "", location: "", url: "", source: "bookmarklet", guessed: { company: false, role: false } });
  });

  it("uses the first value when a parameter repeats", () => {
    expect(draftFromHash(q("add=1&c=First&c=Second"))!.company).toBe("First");
  });
});
