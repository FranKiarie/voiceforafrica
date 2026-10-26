function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

/** Saves a file. On a phone, offers the share sheet so the clip can go to Files. */
export async function saveBlob(filename: string, blob: Blob): Promise<void> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  const share = navigator.canShare?.({ files: [file] });
  if (share) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  triggerDownload(blob, filename);
}

export async function saveText(filename: string, text: string): Promise<void> {
  await saveBlob(filename, new Blob([text], { type: "text/plain;charset=utf-8" }));
}

export async function saveFromUrl(filename: string, url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not download the file");
  await saveBlob(filename, await res.blob());
}

/** Turns a data URL into something <audio> can play without holding a huge string. */
export function objectUrl(url: string): string {
  if (!url.startsWith("data:")) return url;
  const comma = url.indexOf(",");
  const meta = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  const mime = /data:([^;,]+)/.exec(meta)?.[1] ?? "audio/mpeg";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
