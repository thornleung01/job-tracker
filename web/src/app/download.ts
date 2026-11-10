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

export function downloadText(filename: string, text: string, type = "application/json"): void {
  downloadBlob(filename, new Blob([text], { type }));
}
