// src/main/handlers/businessDay.ts
//
// The business day on screen, and End day (contract: BUSINESS-DAY-WIRE-CONTRACT).
import type { IpcMain } from 'electron';
import type { MainServices } from '../types/common';
import { posError } from '../../shared/errorCodes';
import { assertPermission, getCurrentPosUser } from '../utils/permissions';
import { logAction } from '../utils/logging';
import {
  pendingEndDay,
  queueEndDay,
  resolveBusinessDay,
  sendEndDay,
  type BusinessDay,
} from '../businessDay';
import { businessDayDeps, toServerUserId } from './sync';

const wire = (d: BusinessDay | null) =>
  d ? { date: d.date, fromMs: d.fromMs, toMs: d.toMs, openMs: d.openMs, closeMs: d.closeMs, source: d.source } : null;

export function registerBusinessDayHandlers(ipcMain: IpcMain, services: MainServices) {
  const db = services.rawDb;

  /** The business day in progress, and an End day still waiting to be sent. */
  ipcMain.handle('business:today', async () => {
    const day = await resolveBusinessDay(businessDayDeps());
    return { day: wire(day), pendingEndDay: pendingEndDay(db) };
  });

  /**
   * End the business day now. Applies locally at once — the next sale goes to
   * the new day even offline — and is sent through the outbox, retried with
   * the same action_id until the server answers. The server decides which day
   * it closes and replies with closed_day / next_day, which replace ours.
   *
   * Gated like the closing report it follows: whoever may read the day's
   * takings may close the day.
   */
  ipcMain.handle('business:endDay', async () => {
    assertPermission(services, 'reports.view');
    const closedBy = toServerUserId(getCurrentPosUser(services).id);
    const queued = queueEndDay(db, { closedAt: Date.now(), closedBy });
    logAction(services, null, 'business.endDay', { action_id: queued.actionId });

    const out = await sendEndDay(businessDayDeps(), queued.actionId);
    if (out.kind === 'refused') throw posError(out.code as any);
    if (out.kind === 'done') {
      return {
        state: 'done' as const,
        closedDay: wire(out.closedDay ?? queued.closedDay),
        nextDay: wire(out.nextDay ?? queued.nextDay),
      };
    }
    return {
      state: 'queued' as const,
      closedDay: wire(queued.closedDay),
      nextDay: wire(queued.nextDay),
    };
  });
}
