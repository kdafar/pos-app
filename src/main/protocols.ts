import { app, protocol, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

/**
 * MUST be called before app.whenReady()
 */
export function registerAppImgScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'appimg',
      privileges: {
        standard: true,
        secure: true,
        corsEnabled: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

/**
 * Call this AFTER app is ready (inside your boot / app.whenReady().then()).
 */
export function registerAppImgProtocol() {
  const imagesDir = path.join(app.getPath('userData'), 'images');

  // Register on the default session. If you use a custom partition, register on that instead.
  const s = session.defaultSession;

  s.protocol.registerFileProtocol(
    'appimg',
    (request, callback) => {
      try {
        // Log for debugging
        // console.log('[AppImg] Request:', request.url);

        const url = new URL(request.url); // appimg://by-abs/C:/...  OR  appimg://filename.jpg
        let targetPath: string;

        if (url.hostname === 'by-abs') {
          // Absolute path mode: /C:/Users/...
          let p = decodeURIComponent(url.pathname);
          if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // drop leading slash on Windows drives
          p = path.normalize(p);

          // Safety: keep inside imagesDir (fallback to basename inside imagesDir)
          // Note: You might want to relax this check if you intend to serve files from anywhere on disk
          if (!p.toLowerCase().startsWith(imagesDir.toLowerCase())) {
            // For safety/fallback, just look in images dir if path is outside
            targetPath = path.join(imagesDir, path.basename(p));
          } else {
            targetPath = p;
          }
        } else {
          // Relative filename mode:
          // 1. appimg://filename.jpg  -> hostname="filename.jpg", pathname=""
          // 2. appimg:///filename.jpg -> hostname="", pathname="/filename.jpg"

          let fname = url.hostname;
          if (!fname) {
            // If no hostname, strip leading slashes from pathname
            fname = url.pathname.replace(/^\/+/, '');
          }

          fname = decodeURIComponent(fname);
          targetPath = path.join(imagesDir, fname);
        }

        // Debug log the resolved path
        // console.log(`[AppImg] Resolved: ${targetPath} (Exists: ${fs.existsSync(targetPath)})`);

        if (!fs.existsSync(targetPath)) {
          // console.warn(`[AppImg] 404 Not Found: ${targetPath}`);
          return callback({ error: -6 }); // FILE_NOT_FOUND
        }

        callback({ path: targetPath });
      } catch (e) {
        console.error('appimg error:', e);
        callback({ error: -2 }); // FAILED
      }
    },
    (err) => {
      //   console.log(
      //     'appimg protocol registration',
      //     err ? `FAILED: ${err}` : 'OK'
      //   );
    }
  );
}
