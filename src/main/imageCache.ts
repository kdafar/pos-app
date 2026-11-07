import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import axios from 'axios';
import { app } from 'electron';
import db, { getMeta } from './db';

type Row = {
  id: string;
  image: string | null;
  image_local: string | null;
  updated_at: string | null;
};

/**
 * Resolve the folder where we cache images.
 */
function getImagesDir(): string {
  return path.join(app.getPath('userData'), 'images');
}

async function ensureDir() {
  const dir = getImagesDir();
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, '');

/**
 * Item photos are only ever served by the shop's own server, so nothing else is
 * fetched: a bad URL must not make the till call a device on its own network.
 * `www.` is ignored so a shop's redirect between the two forms keeps working.
 */
export function isShopPhotoUrl(url: string, baseUrl: string | null | undefined): boolean {
  try {
    const u = new URL(url);
    const base = new URL(String(baseUrl));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    // No downgrade from an https shop, and the same port: another port on the
    // same host can be a different service.
    if (base.protocol === 'https:' && u.protocol !== 'https:') return false;
    if (u.port !== base.port) return false;
    return bareHost(u.hostname) === bareHost(base.hostname);
  } catch {
    return false;
  }
}

/**
 * What may be stored as an item's photo address. Applied before it is saved,
 * because the item card also loads this address directly when no local copy
 * exists. A path on the shop's server is kept. An address elsewhere is dropped;
 * the card then shows no photo. With no known shop address nothing can be judged.
 */
export function shopPhotoOrNull(
  raw: string | null,
  baseUrl: string | null | undefined
): string | null {
  if (!raw) return raw;
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//');
  if (!absolute || !baseUrl) return raw;
  return isShopPhotoUrl(raw, baseUrl) ? raw : null;
}

/**
 * Helper: Fix URLs.
 * If backend sends "/uploads/foo.jpg", prepend the base_url.
 */
function resolveUrl(rawUrl: string): string | null {
  if (!rawUrl) return null;

  // If it's already absolute (http/https), return it
  if (/^https?:\/\//i.test(rawUrl)) {
    if (isShopPhotoUrl(rawUrl, getMeta('server.base_url'))) return rawUrl;
    console.warn('[img-cache] Skipping photo from another host:', rawUrl);
    return null;
  }

  // If relative, prepend base_url
  const baseUrl = getMeta('server.base_url'); // Retrieve from DB meta
  if (!baseUrl) {
    console.warn(
      '[img-cache] Skipping relative URL (no base_url set):',
      rawUrl
    );
    return null;
  }

  // Handle slash logic to avoid double slashes //
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = rawUrl.replace(/^\/+/, '');
  return `${cleanBase}/${cleanPath}`;
}

/**
 * Stable hashed filename.
 */
export function hashName(originalUrl: string, id: string) {
  const h = crypto.createHash('md5').update(originalUrl).digest('hex');

  // Try to keep extension
  let ext = '.jpg';
  try {
    const u = new URL(originalUrl);
    const p = path.extname(u.pathname);
    if (/^\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(p)) ext = p;
  } catch {
    // fallback if URL parse fails
  }

  // The id comes from the server and becomes part of a path: `../` in it would
  // write outside the images folder. Normal ids pass through unchanged, so
  // photos already saved keep their names and are not downloaded again.
  const safeId = String(id).replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safeId}-${h}${ext}`;
}

async function fetchBinary(url: string): Promise<Buffer> {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 10 * 1024 * 1024, // far above any item photo
    maxRedirects: 3,
    // The check above covers the first address only; a redirect must stay home too.
    beforeRedirect: (options: { href?: string }) => {
      if (!isShopPhotoUrl(String(options.href), getMeta('server.base_url'))) {
        throw new Error('photo redirected to another host');
      }
    },
    headers: {
      // IMPORTANT: Some servers block requests without a User-Agent
      'User-Agent': 'Electron-POS-Client/1.0',
    },
  });
  return Buffer.from(res.data);
}

/**
 * Store only the basename in DB.
 */
function toLocalPath(absPath: string): string {
  return path.basename(absPath);
}

async function downloadOne(r: Row) {
  if (!r.image) return;

  const fullUrl = resolveUrl(r.image);
  if (!fullUrl) return; // logged inside resolveUrl

  const imagesDir = getImagesDir();
  const file = hashName(fullUrl, r.id);
  const dest = path.join(imagesDir, file);

  // Check if we already have this exact file mapped in DB
  const current = r.image_local ? path.basename(r.image_local) : null;

  // Check if file physically exists
  let fileExists = false;
  try {
    await fs.access(dest);
    fileExists = true;
  } catch {}

  // Optimization: If DB says we have it, AND file exists, skip.
  if (current === file && fileExists) {
    // console.log('[img-cache] Skip (cached):', r.id);
    return;
  }

  try {
    console.log(`[img-cache] Downloading: ${r.id} -> ${fullUrl}`);
    const bin = await fetchBinary(fullUrl);
    await fs.writeFile(dest, bin);

    db.prepare(
      'UPDATE items SET image_local = ?, image_mtime = ? WHERE id = ?'
    ).run(toLocalPath(dest), Date.now(), r.id);

    console.log(`[img-cache] Saved: ${file}`);
  } catch (e: any) {
    console.warn(`[img-cache] Failed ${r.id}: ${e.message}`);
  }
}

export async function prefetchItemImages(concurrency = 5) {
  await ensureDir();

  // Select items that have a remote image URL
  const rows = db
    .prepare(
      `
    SELECT id, image, image_local, updated_at
    FROM items
    WHERE image IS NOT NULL AND image <> ''
  `
    )
    .all() as Row[];

  console.log(
    `[img-cache] Found ${rows.length} items with images. Starting prefetch...`
  );

  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const idx = i++;
      if (rows[idx]) await downloadOne(rows[idx]);
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
    WHERE id IN (${ph}) AND image IS NOT NULL AND image <> ''
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
