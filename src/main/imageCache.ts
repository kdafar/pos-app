import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import axios from 'axios';
import { app } from 'electron';
import db from './db';

type Row = {
  id: string;
  image: string | null;
  image_local: string | null;
  updated_at: string | null;
};

/**
 * Resolve the folder where we cache images.
 * Called at runtime (after app is ready), not at module load.
 */
function getImagesDir(): string {
  return path.join(app.getPath('userData'), 'images');
}

async function ensureDir() {
  await fs.mkdir(getImagesDir(), { recursive: true });
}

/**
 * Stable hashed filename based on original URL + item id.
 * Example:  42-3F9A....jpg
 */
function hashName(url: string, id: string) {
  const h = crypto.createHash('md5').update(url).digest('hex');

  const extFromUrl = (() => {
    try {
      const u = new URL(url);
      const base = path.basename(u.pathname);
      const ext = path.extname(base);
      return ext || '.jpg';
    } catch {
      return '.jpg';
    }
  })();

  return `${id}-${h}${extFromUrl}`;
}

async function fetchBinary(url: string): Promise<Buffer> {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
  });
  return Buffer.from(res.data);
}

/**
 * Store only the basename in DB (so React can do appimg:///filename).
 */
function toLocalPath(absOrName: string): string {
  return path.basename(absOrName);
}

async function downloadOne(r: Row) {
  if (!r.image) return;

  // Only cache http(s). If field is already a local path or file://, ignore.
  if (!/^https?:\/\//i.test(r.image)) return;

  const imagesDir = getImagesDir();
  const file = hashName(r.image, r.id);
  const dest = path.join(imagesDir, file);

  // If already pointing at same filename, we're done.
  const current = r.image_local ? path.basename(r.image_local) : null;
  if (current === file) return;

  try {
    const bin = await fetchBinary(r.image);
    await fs.writeFile(dest, bin);

    db.prepare(
      'UPDATE items SET image_local = ?, image_mtime = ? WHERE id = ?'
    ).run(toLocalPath(dest), Date.now(), r.id);
  } catch (e: any) {
    // Non-fatal: keep remote URL; UI can still fallback.
    console.warn('[img-cache] download failed', r.id, e?.message || e);
  }
}

export async function prefetchItemImages(concurrency = 5) {
  await ensureDir();

  const rows = db
    .prepare(
      `
    SELECT id, image, image_local, updated_at
    FROM items
    WHERE image IS NOT NULL AND image <> ''
  `
    )
    .all() as Row[];
  console.log('[img-cache] rows to prefetch:', rows.length);
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const idx = i++;
      await downloadOne(rows[idx]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, rows.length) },
    () => worker()
  );
  await Promise.all(workers);
}

export async function prefetchImagesFor(itemIds: string[], concurrency = 5) {
  if (!itemIds.length) return;

  await ensureDir();
  const ph = itemIds.map(() => '?').join(',');

  const rows = db
    .prepare(
      `
    SELECT id, image, image_local, updated_at
    FROM items
    WHERE id IN (${ph})
  `
    )
    .all(...itemIds) as Row[];

  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const idx = i++;
      await downloadOne(rows[idx]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, rows.length) },
    () => worker()
  );
  await Promise.all(workers);
}
