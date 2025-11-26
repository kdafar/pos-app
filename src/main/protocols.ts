// src/main/protocols.ts
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
        const url = new URL(request.url); // appimg://by-abs/C:/...  OR  appimg:///filename.jpg
        let targetPath: string;

        if (url.hostname === 'by-abs') {
          // Absolute path mode: /C:/Users/...
          let p = decodeURIComponent(url.pathname);
          if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // drop leading slash on Windows drives
          p = path.normalize(p);

          // Safety: keep inside imagesDir (fallback to basename inside imagesDir)
          if (!p.toLowerCase().startsWith(imagesDir.toLowerCase())) {
            targetPath = path.join(imagesDir, path.basename(p));
          } else {
            targetPath = p;
          }
        } else {
          // Relative filename mode: appimg:///49-abc.jpg
          const fname = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
          targetPath = path.join(imagesDir, fname);
        }

        if (!fs.existsSync(targetPath)) return callback({ error: -6 }); // FILE_NOT_FOUND
        callback({ path: targetPath });
      } catch (e) {
        console.error('appimg error:', e);
        callback({ error: -2 }); // FAILED
      }
    },
    (err) => {
      console.log(
        'appimg protocol registration',
        err ? `FAILED: ${err}` : 'OK'
      );
    }
  );
}
