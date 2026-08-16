import { useEffect, useRef } from 'react';

/**
 * USB barcode scanners emulate a keyboard: they "type" the code far faster
 * than a human can and finish with Enter. We buffer keystrokes globally and
 * only treat a burst as a scan if it arrived fast enough, so ordinary typing
 * (and typing into a field) is never hijacked.
 */
type Options = {
  onScan: (code: string) => void;
  /** Max gap between keystrokes to still count as one scan. */
  maxGapMs?: number;
  /** Ignore bursts shorter than this — stray Enter presses are not scans. */
  minLength?: number;
  enabled?: boolean;
};

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    node.isContentEditable === true
  );
}

/**
 * Fields that must never be treated as scanner input — quantity boxes, where
 * "1234" is a quantity, not a barcode. Opt out with data-no-scan.
 */
function isScanExempt(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  return !!node?.closest?.('[data-no-scan]');
}

export function useBarcodeScanner({
  onScan,
  maxGapMs = 35,
  minLength = 4,
  enabled = true,
}: Options) {
  const buf = useRef('');
  const lastAt = useRef(0);
  // Keep the latest callback without re-binding the listener every render.
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      const gap = now - lastAt.current;
      lastAt.current = now;

      // A slow keystroke starts a fresh buffer — that's a human, not a scanner.
      if (gap > maxGapMs) buf.current = '';

      if (e.key === 'Enter') {
        const code = buf.current;
        buf.current = '';
        if (code.length >= minLength) {
          // Only now do we claim the event, so Enter still works everywhere else.
          e.preventDefault();
          e.stopPropagation();
          cb.current(code);
        }
        return;
      }

      // Printable single characters only; ignore modifiers/arrows/F-keys.
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        buf.current += e.key;
      }
    };

    // Capture phase so a focused input does not swallow the burst first,
    // but we still bail out if the operator is genuinely typing somewhere.
    const handler = (e: KeyboardEvent) => {
      // Quantity fields own their keystrokes entirely.
      if (isScanExempt(e.target)) {
        buf.current = '';
        return;
      }
      if (isTypingTarget(e.target)) {
        const now = Date.now();
        const fast = now - lastAt.current <= maxGapMs;
        // Let real typing through; only intercept if it looks like a scan burst.
        if (!fast && e.key !== 'Enter') {
          lastAt.current = now;
          buf.current = e.key.length === 1 ? e.key : '';
          return;
        }
      }
      onKeyDown(e);
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled, maxGapMs, minLength]);
}
