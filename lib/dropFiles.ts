"use client";

/**
 * Turn a drop into a flat File[] — including whole folders.
 *
 * Chromium, Safari and Firefox all expose dropped directories through the
 * non-standard `webkitGetAsEntry()` API, so dragging a folder in works even
 * though <input webkitdirectory> is the only way to *browse* for one.
 */

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  file: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader: () => {
    readEntries: (cb: (entries: FsEntry[]) => void, err?: (e: unknown) => void) => void;
  };
};

/** True when the drag carries files (so we only highlight for real drops). */
export function dragHasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

function readEntryFile(entry: FsEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (f) => resolve(f),
      () => resolve(null)
    );
  });
}

/** readEntries() returns at most 100 per call — keep going until it's empty. */
function readAllEntries(reader: ReturnType<FsEntry["createReader"]>): Promise<FsEntry[]> {
  return new Promise((resolve) => {
    const out: FsEntry[] = [];
    const pump = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) return resolve(out);
          out.push(...batch);
          pump();
        },
        () => resolve(out)
      );
    };
    pump();
  });
}

async function walk(entry: FsEntry, depth: number, out: File[]): Promise<void> {
  // Guard against pathological trees; asset folders are shallow in practice.
  if (depth > 6 || out.length > 5000) return;
  if (entry.isFile) {
    const f = await readEntryFile(entry);
    if (f) out.push(f);
    return;
  }
  if (entry.isDirectory) {
    const entries = await readAllEntries(entry.createReader());
    for (const child of entries) await walk(child, depth + 1, out);
  }
}

/** Extract every file from a drop, recursing into any dropped folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((it) => (it as any).webkitGetAsEntry?.() as FsEntry | null)
    .filter((e): e is FsEntry => !!e);

  if (entries.length === 0) {
    // No entry API (or a plain file list) — fall back to dt.files.
    return Array.from(dt.files ?? []);
  }

  const out: File[] = [];
  for (const entry of entries) await walk(entry, 0, out);
  return out;
}
