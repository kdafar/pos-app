/** Pure print-outcome rules, shared by both print paths and unit tested. */

/**
 * Electron reports "the user closed the print dialog" exactly the way it
 * reports a real fault: success=false plus a reason string. The string is
 * Chromium's own ('cancelled'), not the printer driver's, so matching it is
 * sound — but a driver that hands back an empty reason after the dialog was
 * dismissed would otherwise be announced to the cashier as a printer failure.
 *
 * An empty reason counts as a cancellation only when a dialog was actually on
 * screen. With silent printing there was nobody there to cancel, so swallowing
 * an empty failure would hide the exact fault this file exists to surface.
 */
export function isPrintCancellation(
  reason: string | null | undefined,
  dialogShown: boolean
): boolean {
  const text = String(reason ?? '').trim();
  if (!text) return dialogShown;
  return /cancel|abort|dismiss|user\s*(?:closed|declined)/i.test(text);
}
