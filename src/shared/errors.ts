// src/shared/errors.ts
//
// The transport for the error catalogue, shared by the main process and the
// renderer.
//
// The one rule everything here serves: never render a message that came from an
// exception, an IPC channel, or an HTTP body. Those strings belong in the log.
// The app decides what a person sees, and it decides from a code.
//
// Why the envelope exists: Electron serialises a rejected `ipcMain.handle` into
// a plain string — "Error invoking remote method 'orders:complete': Error:
// Table must be assigned for dine-in". That string was reaching cashiers
// verbatim. So handlers throw an `AppError` carrying a stable code plus its
// parameters, and the code travels inside the message (the only field Electron
// preserves), wrapped in delimiters that survive the stack text Electron
// appends. The renderer decodes it and looks the code up in the catalogue.

import { ERROR_CATALOG } from './errorCatalog';

export const ERR_OPEN = '@@POSERR@@';
export const ERR_CLOSE = '@@ENDPOSERR@@';

/** Values a message placeholder can take. Kept primitive so JSON round-trips. */
export type ErrorParams = Record<string, string | number | boolean | null>;

export type PosErrorPayload = {
  /** Stable machine code, e.g. 'POS_VAL_TABLE_REQUIRED'. */
  code: string;
  /** Interpolation values for the translated message, e.g. { name: 'Pepsi' }. */
  params?: ErrorParams;
  /** English sentence, kept for the log and for codes the renderer lacks. */
  fallback: string;
  /** Form field this error belongs to, so a modal can highlight the input. */
  field?: string;
};

/**
 * Thrown by main-process handlers. `message` is the encoded envelope so the
 * code survives the IPC boundary; `code`/`params`/`field` stay available
 * in-process for logging and for handlers that catch and re-wrap.
 */
export class AppError extends Error {
  readonly code: string;
  readonly params?: ErrorParams;
  readonly field?: string;
  readonly fallback: string;

  constructor(
    code: string,
    fallback: string,
    opts: { params?: ErrorParams; field?: string; cause?: unknown } = {}
  ) {
    super(encodePosError({ code, fallback, params: opts.params, field: opts.field }));
    this.name = 'AppError';
    this.code = code;
    this.fallback = fallback;
    this.params = opts.params;
    this.field = opts.field;
    if (opts.cause !== undefined) (this as any).cause = opts.cause;
  }
}

export function encodePosError(payload: PosErrorPayload): string {
  return `${ERR_OPEN}${JSON.stringify(payload)}${ERR_CLOSE}`;
}

/**
 * Pull the envelope back out of whatever Electron handed the renderer.
 *
 * Returns null when the error did not come from an `AppError` — the caller then
 * falls back to classifying it, so a handler that still throws a plain Error
 * degrades to "readable" rather than "broken".
 */
export function decodePosError(raw: string): PosErrorPayload | null {
  const start = raw.indexOf(ERR_OPEN);
  if (start === -1) return null;
  const from = start + ERR_OPEN.length;
  const end = raw.indexOf(ERR_CLOSE, from);
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(from, end));
    if (!parsed || typeof parsed.code !== 'string') return null;
    return {
      code: parsed.code,
      params: parsed.params ?? undefined,
      fallback: typeof parsed.fallback === 'string' ? parsed.fallback : parsed.code,
      field: typeof parsed.field === 'string' ? parsed.field : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Strip Electron's wrapper off a message that carries no envelope. Used only
 * for the log line and the "technical details" disclosure — never for the
 * sentence a cashier reads.
 */
export function stripIpcWrapper(raw: string): string {
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, '')
    .replace(/^Uncaught\s+/i, '')
    .replace(/^(Error|TypeError|RangeError|SyntaxError):\s*/i, '')
    .split('\n')[0]
    .trim();
}

/**
 * Normalise anything thrown anywhere — IPC rejection, axios failure, a bare
 * string — into the one shape the UI renders. Unmapped errors land on
 * POS_UNKNOWN, which is a bug to fix in the next build, never a string to put
 * in front of a cashier.
 */
export function toPosError(err: unknown): PosErrorPayload {
  if (err == null) return { code: 'POS_UNKNOWN', fallback: 'Something went wrong.' };

  // Already one of ours. `promoRejectionCode` and `pushWarningCode` classify
  // bodies that arrive with HTTP 200 and so were never thrown at all; without
  // this they would fall through to POS_UNKNOWN and lose their parameters.
  if (isPosErrorPayload(err)) return err;

  const raw =
    err instanceof Error
      ? err.message || String(err)
      : typeof err === 'string'
        ? err
        : (err as any)?.message
          ? String((err as any).message)
          : String(err);

  const decoded = decodePosError(raw);
  if (decoded) return decoded;

  const fromServer = classifyServerError(err, raw);
  if (fromServer) return fromServer;

  const cleaned = stripIpcWrapper(raw);
  return { code: 'POS_UNKNOWN', fallback: cleaned || 'Something went wrong.' };
}

/**
 * Map a response from /api/pos/* onto a catalogue code.
 *
 * The backend does not send a machine code in the body yet (§7.1), so the
 * status alone is not enough: three different 401s and two different 423s mean
 * three and two different things to a cashier. Until `code` lands we
 * disambiguate on the server's English `message` — which is exactly the
 * brittleness §7.1 asks them to remove, hence the narrow matches and the safe
 * per-status fallback. The moment a `code` field appears it wins outright.
 */
function classifyServerError(err: unknown, raw: string): PosErrorPayload | null {
  const e = err as any;
  const status = Number(e?.response?.status ?? e?.status ?? 0);
  const data = e?.response?.data;
  const serverMsg = String(data?.message ?? data?.error ?? '').toLowerCase();
  const netCode = String(e?.code ?? '');

  const declared = typeof data?.code === 'string' ? data.code : null;
  if (declared && Object.prototype.hasOwnProperty.call(ERROR_CATALOG, declared)) {
    return { code: declared, fallback: String(data?.message ?? declared) };
  }

  if (status === 401) {
    if (serverMsg.includes('revoked')) {
      return { code: 'POS_DEVICE_REVOKED', fallback: 'Device revoked.' };
    }
    if (serverMsg.includes('invalid token')) {
      return { code: 'POS_TOKEN_INVALID', fallback: 'Invalid token.' };
    }
    return { code: 'POS_AUTH_MISSING', fallback: 'Unauthorized.' };
  }

  if (status === 423) {
    // A 423 stops the sync loop; it is not a glitch to retry through.
    if (serverMsg.includes('killswitch') || serverMsg.includes('auto-locked')) {
      return { code: 'POS_DEVICE_KILLSWITCH', fallback: 'Device auto-locked.' };
    }
    return {
      code: 'POS_DEVICE_LOCKED',
      fallback: 'Device is locked.',
      params: { locked_at: formatLockedAt(data?.locked_at) },
    };
  }

  if (status === 429) {
    const retryAfter =
      Number(e?.response?.headers?.['retry-after'] ?? data?.retry_after ?? 60) || 60;
    return {
      code: 'POS_RATE_LIMITED',
      fallback: `Too many attempts. Wait ${retryAfter}s.`,
      params: { retry_after: retryAfter },
    };
  }

  if (status === 409) {
    if (serverMsg.includes('already in progress')) {
      // Not a failure: a link is being minted right now, so the caller should
      // poll /payments/status rather than ask for a second one.
      return { code: 'POS_PAY_LINK_IN_PROGRESS', fallback: 'Link already in progress.' };
    }
    return {
      code: 'POS_PAY_EXTERNAL_ID_CONFLICT',
      fallback: 'That order number is already in use.',
    };
  }

  if (status === 404) {
    return { code: 'POS_PAY_INTENT_NOT_FOUND', fallback: 'Not found.' };
  }

  if (status === 403) {
    if (serverMsg.includes('pair code')) {
      return { code: 'POS_PAIR_CODE_INVALID', fallback: 'Invalid pair code.' };
    }
    if (serverMsg.includes('revoked')) {
      return { code: 'POS_PAIR_DEVICE_REVOKED', fallback: 'Device revoked.' };
    }
    if (serverMsg.includes('locked')) {
      return { code: 'POS_PAIR_DEVICE_LOCKED', fallback: 'Device locked.' };
    }
    return { code: 'POS_PUSH_DEVICE_UNAUTHORIZED', fallback: 'Unauthorized device.' };
  }

  if (status === 422) {
    const detail = firstValidationDetail(data);
    if (serverMsg.includes('not available for pos')) {
      return { code: 'POS_PAY_METHOD_UNAVAILABLE', fallback: detail ?? 'Method unavailable.' };
    }
    if (serverMsg.includes('payable total')) {
      return { code: 'POS_PAY_AMOUNT_UNKNOWN', fallback: detail ?? 'No payable total.' };
    }
    if (serverMsg.includes('branch_id')) {
      return { code: 'POS_PAIR_BRANCH_INVALID', fallback: detail ?? 'Branch required.' };
    }
    if (serverMsg.includes('client_msg_id')) {
      return { code: 'POS_PUSH_MSGID_MISSING', fallback: detail ?? 'client_msg_id required.' };
    }
    // Anything else: show the server's own sentence rather than inventing one.
    return {
      code: 'POS_SERVER_REJECTED',
      fallback: detail || 'The server rejected this request.',
      params: detail ? { detail } : undefined,
    };
  }

  if (status >= 500) {
    return {
      code: 'POS_SERVER_ERROR',
      fallback: 'The server had a problem.',
      params: { status },
    };
  }

  if (netCode === 'ECONNABORTED' || netCode === 'ETIMEDOUT' || /timeout/i.test(raw)) {
    return { code: 'POS_NET_TIMEOUT', fallback: 'The server took too long to answer.' };
  }
  if (
    netCode === 'ENOTFOUND' ||
    netCode === 'ECONNREFUSED' ||
    netCode === 'ENETUNREACH' ||
    netCode === 'EAI_AGAIN' ||
    /network error|failed to fetch/i.test(raw)
  ) {
    return { code: 'POS_NET_OFFLINE', fallback: 'No connection to the server.' };
  }
  return null;
}

/**
 * A promo that comes back `valid:false` arrives with HTTP 200 — branching on
 * the status would call it a success. Callers hand the body here instead.
 */
export function promoRejectionCode(body: any): PosErrorPayload | null {
  if (!body || body.valid !== false) return null;
  const reason = String(body.reason ?? body.message ?? '').toLowerCase();
  if (reason.includes('minimum')) {
    return {
      code: 'POS_PROMO_MIN_NOT_REACHED',
      fallback: 'Minimum order not reached.',
      params: { min_amount: String(body.min_amount ?? body.minimum ?? '') },
    };
  }
  if (reason.includes('branch')) {
    return { code: 'POS_PROMO_WRONG_BRANCH', fallback: 'Not valid for this branch.' };
  }
  return { code: 'POS_PROMO_UNAVAILABLE', fallback: reason || 'Promo not available.' };
}

/**
 * Turn one entry from a /push `warnings[]` array into a catalogue code.
 * `retryable: true` is the normal state of a till on a bad connection and stays
 * quiet; only the two permanent failures are worth telling anyone about.
 */
export function pushWarningCode(warning: any): PosErrorPayload | null {
  if (!warning) return null;
  const tempId = String(warning.temp_id ?? warning.tempId ?? '');
  if (warning.retryable !== false) {
    return {
      code: 'POS_PUSH_ORDER_FAILED',
      fallback: 'Order still queued.',
      params: { temp_id: tempId },
    };
  }
  const reason = String(warning.error ?? '').toLowerCase();
  if (reason.includes('final') || reason.includes('closed') || reason.includes('done')) {
    return {
      code: 'POS_PUSH_ORDER_FINALIZED',
      fallback: 'Order already finished on the server.',
      params: { temp_id: tempId },
    };
  }
  return {
    code: 'POS_PUSH_ORDER_MALFORMED',
    fallback: `Order ${tempId} was refused.`,
    params: { temp_id: tempId },
  };
}

function isPosErrorPayload(v: unknown): v is PosErrorPayload {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as any).code === 'string' &&
    typeof (v as any).fallback === 'string' &&
    !(v instanceof Error)
  );
}

/**
 * /payments/status answers HTTP 200 whatever it says, so the payment outcome
 * lives in the body. These two codes are ours to raise — the backend never
 * sends them (catalogue: sent=false) — and until now a failed or expired
 * payment showed the cashier nothing at all.
 */
export function paymentStatusCode(status: unknown): PosErrorPayload | null {
  switch (String(status ?? '').trim().toLowerCase()) {
    case 'failed':
      return { code: 'POS_PAY_STATUS_FAILED', fallback: 'The payment failed.' };
    case 'expired':
      return { code: 'POS_PAY_STATUS_EXPIRED', fallback: 'The payment link expired.' };
    default:
      // paid / pending / anything unknown is not a failure to report.
      return null;
  }
}

/**
 * A push that landed some orders and not others. Also ours to raise — derived
 * from the counts in the /push body rather than waiting for a code that never
 * comes. `info`, not an error: the queued ones retry on their own.
 */
export function pushPartialCode(result: {
  acked?: number;
  retryable?: number;
  dropped?: number;
}): PosErrorPayload | null {
  const accepted = Number(result?.acked ?? 0);
  const failed = Number(result?.retryable ?? 0) + Number(result?.dropped ?? 0);
  if (failed <= 0) return null;
  return {
    code: 'POS_PUSH_PARTIAL',
    fallback: `${accepted} synced, ${failed} still queued.`,
    params: { accepted, failed },
  };
}

function formatLockedAt(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
}

/** Laravel returns { message, errors: { field: [msg] } } on a 422. */
function firstValidationDetail(data: any): string | null {
  if (!data) return null;
  const bag = data.errors;
  if (bag && typeof bag === 'object') {
    for (const key of Object.keys(bag)) {
      const v = bag[key];
      const msg = Array.isArray(v) ? v[0] : v;
      if (msg) return String(msg);
    }
  }
  if (typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  return null;
}
