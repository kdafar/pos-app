// src/main/machineId.ts
import { machineId } from 'node-machine-id';
import crypto from 'node:crypto';
import db, { getMeta, setMeta } from './db'; // adjust import if these are elsewhere

export async function readOrCreateMachineId(): Promise<string> {
  let mid = getMeta('machine_id');
  if (mid) return mid;

  try {
    // stable per device; no PII; good enough for device registration
    mid = await machineId();           // or: await machineId({ original: true })
  } catch {
    mid = crypto.randomUUID();         // fallback
  }
  setMeta('machine_id', mid);
  return mid;
}
