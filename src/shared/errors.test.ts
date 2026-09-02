import { describe, expect, it } from 'vitest';
import {
  AppError,
  decodePosError,
  paymentStatusCode,
  promoRejectionCode,
  pushPartialCode,
  pushWarningCode,
  stripIpcWrapper,
  toPosError,
} from './errors';
import { posError } from './errorCodes';
import {
  BACKEND_SENT_CODE_COUNT,
  ERROR_CATALOG,
  type PosErrorCode,
} from './errorCatalog';
import { describeError } from '../renderer/utils/posError';

const CODES = Object.keys(ERROR_CATALOG) as PosErrorCode[];

describe('the IPC error envelope', () => {
  it('survives the wrapper Electron puts around a rejected handler', () => {
    // Verbatim what reached the cashier before: the channel name, the doubled
    // "Error:", and a stack glued on the end.
    const thrown = posError('POS_VAL_TABLE_REQUIRED', { field: 'table' });
    const asElectronSendsIt =
      `Error invoking remote method 'orders:complete': Error: ${thrown.message}\n` +
      '    at IpcMainImpl.<anonymous> (main.js:1:1)';

    const decoded = decodePosError(asElectronSendsIt);
    expect(decoded?.code).toBe('POS_VAL_TABLE_REQUIRED');
    expect(decoded?.field).toBe('table');
  });

  it('carries interpolation values through', () => {
    const decoded = decodePosError(
      posError('POS_VAL_ADDON_GROUP_MAX', { params: { max: 2, group: 'Sauces' } }).message
    );
    expect(decoded?.params).toEqual({ max: 2, group: 'Sauces' });
    // The English fallback is already filled in, so the log line reads properly.
    expect(decoded?.fallback).toContain('up to 2');
    expect(decoded?.fallback).toContain('Sauces');
  });

  it('keeps the code available in-process for logging', () => {
    const err = posError('POS_TILL_LOCKED');
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('POS_TILL_LOCKED');
  });
});

describe('errors that carry no envelope', () => {
  it('strips the Electron wrapper off a plain handler error', () => {
    expect(
      stripIpcWrapper("Error invoking remote method 'x': Error: Something odd")
    ).toBe('Something odd');
  });

  it('falls back to POS_UNKNOWN but keeps the original text', () => {
    const got = toPosError(new Error('Some unmapped failure'));
    expect(got.code).toBe('POS_UNKNOWN');
    expect(got.fallback).toBe('Some unmapped failure');
  });
});

describe('the backend contract', () => {
  it('tells the three 401s apart', () => {
    expect(toPosError({ response: { status: 401, data: { message: 'Unauthorized' } } }).code).toBe(
      'POS_AUTH_MISSING'
    );
    expect(
      toPosError({ response: { status: 401, data: { message: 'Device revoked' } } }).code
    ).toBe('POS_DEVICE_REVOKED');
    expect(
      toPosError({ response: { status: 401, data: { message: 'Invalid token' } } }).code
    ).toBe('POS_TOKEN_INVALID');
  });

  it('tells an admin lock apart from the killswitch, and dates the lock', () => {
    const locked = toPosError({
      response: {
        status: 423,
        data: { message: 'Device is locked', locked_at: '2026-08-01T09:00:00Z' },
      },
    });
    expect(locked.code).toBe('POS_DEVICE_LOCKED');
    expect(describeError(locked as any, 'ar').message).toContain('2026-08-01');

    expect(
      toPosError({
        response: { status: 423, data: { message: 'Device auto-locked by killswitch' } },
      }).code
    ).toBe('POS_DEVICE_KILLSWITCH');
  });

  it('reads Retry-After off a 429', () => {
    const got = toPosError({
      response: { status: 429, headers: { 'retry-after': '30' }, data: {} },
    });
    expect(got.code).toBe('POS_RATE_LIMITED');
    expect(got.params?.retry_after).toBe(30);
  });

  it('treats "already in progress" as progress, not as a conflict', () => {
    const inProgress = toPosError({
      response: { status: 409, data: { message: 'Payment link creation is already in progress' } },
    });
    expect(inProgress.code).toBe('POS_PAY_LINK_IN_PROGRESS');
    // info, not danger: a link is being minted, so the caller should poll.
    expect(ERROR_CATALOG.POS_PAY_LINK_IN_PROGRESS.severity).toBe('info');

    expect(
      toPosError({
        response: { status: 409, data: { message: 'external_order_id already in use by another branch' } },
      }).code
    ).toBe('POS_PAY_EXTERNAL_ID_CONFLICT');
  });

  it('prefers a machine code over message matching the moment one arrives', () => {
    // §7.1 — additive on their side, and it wins outright on ours.
    const got = toPosError({
      response: { status: 500, data: { code: 'POS_PAY_PROVIDER_FAILED', message: 'anything' } },
    });
    expect(got.code).toBe('POS_PAY_PROVIDER_FAILED');
  });

  it('surfaces the field Laravel rejected on an unrecognised 422', () => {
    const got = toPosError({
      response: { status: 422, data: { errors: { mobile: ['The mobile is invalid.'] } } },
    });
    expect(got.code).toBe('POS_SERVER_REJECTED');
    expect(got.fallback).toBe('The mobile is invalid.');
  });

  it('catches a promo rejection that arrives as HTTP 200', () => {
    // The trap: branching on the status would call this a success.
    expect(promoRejectionCode({ valid: true })).toBeNull();
    expect(promoRejectionCode({ valid: false, reason: 'Promo not available' })?.code).toBe(
      'POS_PROMO_UNAVAILABLE'
    );
    const min = promoRejectionCode({
      valid: false,
      reason: 'Minimum order not reached',
      min_amount: '5.000',
    });
    expect(min?.code).toBe('POS_PROMO_MIN_NOT_REACHED');
    expect(describeError(min as any, 'ar').message).toContain('5.000');
  });

  it('keeps a retryable push warning quiet and a permanent one loud', () => {
    const queued = pushWarningCode({ temp_id: 't1', error: 'timeout', retryable: true });
    expect(queued?.code).toBe('POS_PUSH_ORDER_FAILED');
    // info: a till on a bad connection is not an error worth a dialog.
    expect(ERROR_CATALOG.POS_PUSH_ORDER_FAILED.severity).toBe('info');

    expect(
      pushWarningCode({ temp_id: 't2', error: 'order already finalized', retryable: false })?.code
    ).toBe('POS_PUSH_ORDER_FINALIZED');
    expect(
      pushWarningCode({ temp_id: 't3', error: 'bad payload', retryable: false })?.code
    ).toBe('POS_PUSH_ORDER_MALFORMED');
  });

  it('does not treat being offline as a failure', () => {
    const offline = toPosError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' });
    expect(offline.code).toBe('POS_NET_OFFLINE');
    expect(ERROR_CATALOG.POS_NET_OFFLINE.severity).toBe('info');
    expect(toPosError({ code: 'ECONNABORTED', message: 'timeout of 15000ms' }).code).toBe(
      'POS_NET_TIMEOUT'
    );
  });
});

describe('what the cashier ends up reading', () => {
  it('translates the dine-in table refusal instead of echoing the handler', () => {
    const raw = `Error invoking remote method 'orders:complete': Error: ${
      posError('POS_VAL_TABLE_REQUIRED', { field: 'table' }).message
    }`;

    const en = describeError(raw, 'en');
    expect(en.title).toBe('Choose a table');
    expect(en.severity).toBe('inline');
    expect(en.field).toBe('table');
    expect(en.message).not.toContain('invoking remote method');

    const ar = describeError(raw, 'ar');
    expect(ar.title).toBe('اختر الطاولة');
    expect(ar.message).toBe('طلبات الصالة تحتاج طاولة. اختر الطاولة ثم أكمل الطلب.');
    // No Latin words leaking into the Arabic sentence.
    expect(ar.message).not.toMatch(/[A-Za-z]{4}/);
  });

  it('fills placeholders in both languages', () => {
    const err = posError('POS_VAL_ITEM_NO_PRICE', { params: { name: 'Pepsi' } });
    expect(describeError(err, 'en').message).toContain('Pepsi');
    expect(describeError(err, 'ar').message).toContain('Pepsi');
  });

  it('shows a placeholder-only body as the sentence the server sent', () => {
    // POS_SERVER_REJECTED's body is nothing but {detail}; with nothing to fill
    // in it must not render "{detail}" at a cashier.
    const got = describeError(
      { response: { status: 422, data: { message: 'Branch closed' } } },
      'en'
    );
    expect(got.message).toBe('Branch closed');
  });

  it('keeps an unmapped message out of the sentence but not out of the details', () => {
    const got = describeError(new Error('sqlite: disk I/O error'), 'ar');
    expect(got.message).toBe(ERROR_CATALOG.POS_UNKNOWN.ar.body);
    expect(got.detail).toBe('sqlite: disk I/O error');
  });
});

describe('the catalogue', () => {
  it('has Arabic and English copy for every code', () => {
    for (const code of CODES) {
      const entry = ERROR_CATALOG[code];
      for (const lang of ['en', 'ar'] as const) {
        expect(entry[lang].title.trim(), `no ${lang} title for ${String(code)}`).not.toBe('');
        expect(entry[lang].body.trim(), `no ${lang} body for ${String(code)}`).not.toBe('');
      }
      // Arabic copy that is still English is the failure this guards against.
      expect(entry.ar.title, `Arabic title for ${String(code)} is untranslated`).not.toBe(
        entry.en.title
      );
    }
  });

  it('leaves no placeholder unfillable — both languages take the same ones', () => {
    const holes = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    for (const code of CODES) {
      const entry = ERROR_CATALOG[code];
      expect(holes(entry.ar.body), `body placeholders differ for ${String(code)}`).toBe(
        holes(entry.en.body)
      );
      expect(holes(entry.ar.title), `title placeholders differ for ${String(code)}`).toBe(
        holes(entry.en.title)
      );
    }
  });

  it('never says just "Error"', () => {
    for (const code of CODES) {
      expect(ERROR_CATALOG[code].en.title.toLowerCase(), String(code)).not.toBe('error');
    }
  });

  it('only offers a retry where retrying can help', () => {
    // A locked device, a revoked pairing or a malformed order will refuse just
    // as hard the second time; offering a button is a lie.
    const neverRetryable: PosErrorCode[] = [
      'POS_DEVICE_LOCKED',
      'POS_DEVICE_KILLSWITCH',
      'POS_DEVICE_REVOKED',
      'POS_TOKEN_INVALID',
      'POS_PUSH_ORDER_MALFORMED',
      'POS_PUSH_ORDER_FINALIZED',
      'POS_VAL_ORDER_LOCKED',
    ];
    for (const code of neverRetryable) {
      expect(ERROR_CATALOG[code].retry, String(code)).toBe(false);
    }
  });
});

describe('codes the server never sends', () => {
  // The backend ships 27 codes; the rest are ours to raise. Waiting for one of
  // these as a server code waits forever, so each one needs a client trigger.
  it('raises the payment outcome from the body, since /status is always 200', () => {
    expect(paymentStatusCode('failed')?.code).toBe('POS_PAY_STATUS_FAILED');
    expect(paymentStatusCode('EXPIRED')?.code).toBe('POS_PAY_STATUS_EXPIRED');
    expect(paymentStatusCode('paid')).toBeNull();
    expect(paymentStatusCode('pending')).toBeNull();
    expect(paymentStatusCode(null)).toBeNull();
    expect(ERROR_CATALOG.POS_PAY_STATUS_FAILED.sent).toBe(false);
  });

  it('derives a partial push from the counts, not from a code', () => {
    expect(pushPartialCode({ acked: 4, retryable: 0, dropped: 0 })).toBeNull();
    const partial = pushPartialCode({ acked: 3, retryable: 1, dropped: 0 });
    expect(partial?.code).toBe('POS_PUSH_PARTIAL');
    expect(partial?.params).toEqual({ accepted: 3, failed: 1 });
    // info, not an error: the queued orders retry on their own.
    expect(ERROR_CATALOG.POS_PUSH_PARTIAL.severity).toBe('info');
    expect(ERROR_CATALOG.POS_PUSH_PARTIAL.sent).toBe(false);
  });

  it('mirrors 34 of the 44 codes the backend sends, with the gap pinned', () => {
    // Drift guard in both directions. The authority is the constants in
    // PosError.php, not this file — BACKEND_SENT_CODE_COUNT carries it.
    //
    // 27 → 33 on 2026-09-01 (POS_DEVICE_UNKNOWN, split out of
    // POS_DEVICE_REVOKED, plus the five POS_RECLAIM_* codes), then 34 on
    // 2026-09-02 with POS_RECLAIM_MACHINE_IN_USE, the liveness guard. The remaining
    // ten are a known, deliberate gap rather than drift, so they are asserted
    // rather than described: closing any of them has to move both numbers.
    //
    // What we believe the ten are — the six permission-write codes for
    // GET/PUT /users/{user}/permissions, which this client has no names for
    // and does not yet call, and four the backend sends in a 200 body rather
    // than an error response (POS_PROMO_WRONG_BRANCH, POS_PAY_STATUS_FAILED,
    // POS_PAY_STATUS_EXPIRED, POS_OK_PROMO_APPLIED). Promos and payments are
    // otherwise complete at 3 and 8, so the shape is not what it looked like
    // from the other side. Awaiting their per-endpoint list to close it.
    const sent = CODES.filter((c) => ERROR_CATALOG[c].sent);
    expect(sent).toHaveLength(34);
    expect(BACKEND_SENT_CODE_COUNT - sent.length).toBe(10);

    // Spot-check the classes that must never be marked as server-sent.
    for (const code of CODES) {
      if (code.startsWith('POS_VAL_') || code.startsWith('POS_NET_')) {
        expect(ERROR_CATALOG[code].sent, String(code)).toBe(false);
      }
    }
  });

  /**
   * The alias the backend nearly un-did. POS_ORDER_NOT_FOUND must stay absent:
   * this client renders that condition as POS_VAL_ORDER_NOT_FOUND, and two
   * codes opening the same dialog is worse than one.
   */
  it('keeps POS_ORDER_NOT_FOUND aliased rather than mirrored', () => {
    expect(CODES).not.toContain('POS_ORDER_NOT_FOUND' as PosErrorCode);
    expect(ERROR_CATALOG.POS_VAL_ORDER_NOT_FOUND).toBeDefined();
  });

  it('still prefers a real server code over message matching', () => {
    // POS_PAY_PROVIDER_FAILED used to be rewritten to POS_SERVER_ERROR before
    // it left the backend, so "the gateway is down" was indistinguishable from
    // "our code broke". It now arrives on its own, and must win.
    expect(
      toPosError({
        response: {
          status: 500,
          data: { code: 'POS_PAY_PROVIDER_FAILED', message: 'Could not create a payment link' },
        },
      }).code
    ).toBe('POS_PAY_PROVIDER_FAILED');
  });

  it('classifies the throttle by status, not by its wording', () => {
    // The documented fallback text was never what the server sends; anything
    // matching on it would have matched nothing.
    const got = toPosError({
      response: {
        status: 429,
        headers: { 'retry-after': '45' },
        data: { message: 'Too many requests. Please slow down.' },
      },
    });
    expect(got.code).toBe('POS_RATE_LIMITED');
    expect(got.params?.retry_after).toBe(45);
  });
});
