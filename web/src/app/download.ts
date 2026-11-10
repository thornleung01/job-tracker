// Saving a file from the browser. Lives here, not in a page, so components and pages can both use it.

/** Offers `blob` to the browser as a download named `filename`. */
export function downloadBlob(filename: string, blob: Blob, revokeAfterMs = 1000): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
}

/** Saves several PDFs one after another with a short gap, which is what lets a browser allow more than one download from a click. */
export async function downloadPdfs(files: readonly { name: string; bytes: Uint8Array }[], gapMs = 300): Promise<void> {
  for (const [i, f] of files.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
    downloadBlob(f.name, new Blob([f.bytes as BlobPart], { type: "application/pdf" }));
  }
}

export function downloadText(filename: string, text: string, type = "application/json"): void {
  downloadBlob(filename, new Blob([text], { type }));
}
