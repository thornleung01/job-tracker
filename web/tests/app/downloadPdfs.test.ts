import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadPdfs } from "../../src/app/download";

afterEach(() => vi.restoreAllMocks());

describe("downloadPdfs", () => {
  it("saves each file as a PDF under its own name, one after another with a gap", async () => {
    const names: string[] = [];
    const types: string[] = [];
    const create = vi.fn((b: Blob) => (types.push(b.type), "blob:x"));
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const seen: number[] = [];
    const t0 = Date.now();
    const done = downloadPdfs(
      [{ name: "Resume.pdf", bytes: new Uint8Array([1]) }, { name: "Cover letter.pdf", bytes: new Uint8Array([2]) }],
      40,
    ).then(() => seen.push(Date.now() - t0));
    expect(names).toEqual(["Resume.pdf"]);
    await done;
    expect(names).toEqual(["Resume.pdf", "Cover letter.pdf"]);
    expect(types).toEqual(["application/pdf", "application/pdf"]);
    expect(seen[0]).toBeGreaterThanOrEqual(35);
    vi.unstubAllGlobals();
  });

  it("does nothing for no files", async () => {
    await expect(downloadPdfs([])).resolves.toBeUndefined();
  });
});
