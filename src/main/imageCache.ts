import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import axios from 'axios';
import { app } from 'electron';
import db from './db';

const imagesDir = path.join(app.getPath('userData'), 'images');

async function ensureDir() {
  await fs.mkdir(imagesDir, { recursive: true });
}

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
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
  return Buffer.from(res.data);
}

type Row = { id: string; image: string | null; image_local: string | null; updated_at: string | null };

function toLocalPath(abs: string) {
  return abs;
}

async function downloadOne(r: Row) {
  if (!r.image) return;

  // only http(s) → we cache; if it’s already a file:// or local path, skip
  if (!/^https?:\/\//i.test(r.image)) return;

  const file = hashName(r.image, r.id);
  const dest = path.join(imagesDir, file);

  // If already pointing to same file name, assume cached
  if (r.image_local && path.basename(r.image_local) === file) return;

  try {
    const bin = await fetchBinary(r.image);
    await fs.writeFile(dest, bin);
    db.prepare('UPDATE items SET image_local = ?, image_mtime = ? WHERE id = ?')
      .run(toLocalPath(dest), Date.now(), r.id);
  } catch (e: any) {
    // Non-fatal: keep remote URL; UI will fallback
    console.warn('[img-cache] download failed', r.id, e?.message || e);
  }
}

export async function prefetchItemImages(concurrency = 5) {
  await ensureDir();
  const rows = db.prepare(`
    SELECT id, image, image_local, updated_at
    FROM items
    WHERE image IS NOT NULL AND image <> ''
  `).all() as Row[];

  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const idx = i++;
      await downloadOne(rows[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, () => worker());
  await Promise.all(workers);
}

export async function prefetchImagesFor(itemIds: string[], concurrency = 5) {
  if (!itemIds.length) return;
  await ensureDir();
  const ph = itemIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, image, image_local, updated_at
    FROM items
    WHERE id IN (${ph})
  `).all(...itemIds) as Row[];

  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const idx = i++;
      await downloadOne(rows[idx]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, rows.length) }, () => worker());
  await Promise.all(workers);
}
