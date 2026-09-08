// src/main/utils/installationId.ts
//
// Deciding which installation this is, independently of which PC it runs on.

/**
 * File under userData that holds the id.
 *
 * Deliberately a sibling of pos.db rather than a row inside it: a till whose
 * database is deleted — the reinstall case silent re-pair exists to rescue —
 * has to come back with the same identity, or the server cannot match it.
 */
export const INSTALLATION_ID_FILE = 'installation-id';

/** The side effects, injected so the rules below can be tested without a disk. */
export type InstallationIdIo = {
  /** File contents, or null when it does not exist / cannot be read. */
  read(): string | null;
  /** Best effort. A failure must not stop the app — see resolveInstallationId. */
  write(id: string): void;
  generate(): string;
};

/**
 * Anything outside this is a corrupt or truncated file, and trusting it would
 * hand the server an identity that never matches. Wide enough to accept both
 * the ids we generate now and the sha256 MachineGuid inherited from before.
 */
const WELL_FORMED = /^[A-Za-z0-9._:-]{8,128}$/;

function clean(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  return WELL_FORMED.test(v) ? v : '';
}

/**
 * The installation's own id, created once and kept.
 *
 * `machine_id` used to be the sha256 of the Windows MachineGuid, and PCs
 * imaged from one master all carry the same GUID — so a whole rollout of tills
 * introduced itself to the server under a single machine identity. Enrolment
 * no longer resolves a device by it, but reclaim still matches on it, and one
 * shared value there means a wiped till can be handed a neighbour's identity.
 *
 * `inherited` is the value a till already registered under — the meta row from
 * an earlier version. Adopting it rather than minting a new id is what keeps
 * an upgrade invisible to the server: only installations that have never had
 * an id get a fresh one. Cloning a disk *after* first run still copies the
 * file, which no client-side scheme can prevent; imaging a master that has
 * never been launched, which is the case that actually bit us, now gives every
 * PC its own id.
 */
export function resolveInstallationId(
  io: InstallationIdIo,
  inherited?: string | null
): string {
  const stored = clean(io.read());
  if (stored) return stored;

  const id = clean(inherited) || io.generate();
  io.write(id);
  return id;
}
