import { describe, expect, it } from "vitest";
import { htmlToText } from "../../src/providers/htmlToText";

describe("htmlToText", () => {
  it("keeps visible text and drops script, style and head", () => {
    const text = htmlToText("<html><head><title>T</title><style>p{}</style></head><body><p>Hello <b>there</b></p><script>x()</script></body></html>");
    expect(text).toContain("Hello");
    expect(text).toContain("there");
    expect(text).not.toContain("x()");
    expect(text).not.toContain("p{}");
    expect(text).not.toMatch(/\bT\b/);
  });

  it("collapses runs of three or more newlines and trims", () => {
    const text = htmlToText("<div>one</div>\n\n\n\n<div>two</div>");
    expect(text).not.toMatch(/\n{3,}/);
    expect(text.startsWith("one")).toBe(true);
    expect(text.endsWith("two")).toBe(true);
  });

  it("decodes entities and returns no markup", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3</p>")).toBe("Tom & Jerry <3");
  });
});
