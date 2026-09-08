// src/main/machineId.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getMeta, setMeta } from './db';
import {
  INSTALLATION_ID_FILE,
  resolveInstallationId,
} from './utils/installationId';

const idPath = () => path.join(app.getPath('userData'), INSTALLATION_ID_FILE);

/** 64 hex characters, the same shape as the sha256 this used to send. */
const newId = () => crypto.randomBytes(32).toString('hex');

/**
 * The value sent as `machine_id`.
 *
 * It is no longer derived from the hardware. See utils/installationId for why:
 * every till imaged from one master shared a MachineGuid, so they shared this.
 * The name is kept because the server field is called machine_id and a rename
 * would have to be agreed on both sides first.
 *
 * Both stores are written, and either one alone is enough to survive: the file
 * outlives a deleted database, and the meta row outlives a userData directory
 * the app cannot write to.
 */
export async function readOrCreateMachineId(): Promise<string> {
  const inherited = getMeta('machine_id') || null;

  const id = resolveInstallationId(
    {
      read: () => {
        try {
          return fs.readFileSync(idPath(), 'utf8');
        } catch {
          // Missing is the ordinary first-run case, not a failure.
          return null;
        }
      },
      write: (v) => {
        try {
          fs.writeFileSync(idPath(), v + '\n', 'utf8');
        } catch (err) {
          // Survivable: the meta row below still carries it, and the next boot
          // seeds the file from there once the directory is writable again.
          console.error('[pos] Could not store the installation id:', err);
        }
      },
      generate: newId,
    },
    inherited
  );

  if (id !== inherited) setMeta('machine_id', id);
  return id;
}
