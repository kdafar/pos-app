import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECOVER_DEVICE_ID_SQL,
  recoverDeviceIdFromOrders,
  type OrdersReader,
} from './deviceIdentity';

/**
 * The rescue path for tills the old sync interceptor already unpaired.
 *
 * It blanked meta.device_id, so those tills have nothing left to reclaim with
 * — which made silent re-pair useless for exactly the population it was built
 * for. Verified against a real damaged database as well: blanking device_id on
 * a copy of a live pos.db leaves this query returning the till's own id.
 */

function reader(get: () => unknown): OrdersReader {
  return { prepare: () => ({ pluck: () => ({ get }) }) };
}

beforeEach(() => void vi.spyOn(console, 'error').mockImplementation(() => {}));

describe('recovering a device id from local orders', () => {
  it('returns the id the till rang its own sales under', () => {
    expect(
      recoverDeviceIdFromOrders(reader(() => '01M04N3EAFAPRYZDR79F778ZH5'))
    ).toBe('01M04N3EAFAPRYZDR79F778ZH5');
  });

  it('answers empty when the till has never rung a sale', () => {
    expect(recoverDeviceIdFromOrders(reader(() => undefined))).toBe('');
  });

  /**
   * A row written while the till was unpaired carries ''. Sending that to
   * /reclaim earns POS_RECLAIM_INPUT_MISSING instead of falling through to the
   * pairing code, so it must read as "nothing to recover".
   */
  it.each([
    { label: 'an empty string', value: '' as unknown },
    { label: 'null', value: null as unknown },
    { label: 'a non-string', value: 0 as unknown },
  ])('treats $label as nothing to recover', ({ value }) => {
    expect(recoverDeviceIdFromOrders(reader(() => value))).toBe('');
  });

  it('trims what it finds rather than sending whitespace', () => {
    expect(recoverDeviceIdFromOrders(reader(() => '  dev-1  '))).toBe('dev-1');
  });

  /**
   * A till missing the orders table has nothing to recover — it is not a
   * reason to fail the whole reclaim and strand the cashier on an error.
   */
  it('contains a broken query instead of failing the reclaim', () => {
    const broken = reader(() => {
      throw new Error('no such table: orders');
    });
    expect(recoverDeviceIdFromOrders(broken)).toBe('');
  });
});

/**
 * The query carries two rules that are easy to drop in a refactor and silently
 * wrong afterwards, so they are pinned here rather than left to review.
 */
describe('the recovery query', () => {
  it('skips rows written while the till was unpaired', () => {
    expect(RECOVER_DEVICE_ID_SQL).toMatch(/device_id\s*<>\s*''/);
    expect(RECOVER_DEVICE_ID_SQL).toMatch(/device_id\s+IS\s+NOT\s+NULL/i);
  });

  it('takes the most recent id, not the oldest', () => {
    // A till re-paired onto a new device row must not reach back past that to
    // an id the server no longer knows.
    expect(RECOVER_DEVICE_ID_SQL).toMatch(/ORDER\s+BY\s+created_at\s+DESC/i);
    expect(RECOVER_DEVICE_ID_SQL).toMatch(/LIMIT\s+1/i);
  });

  it('reads only this till’s own orders table', () => {
    // Pulled orders never set device_id, so `orders` cannot leak a
    // neighbouring till's id. Any join added here would break that.
    expect(RECOVER_DEVICE_ID_SQL).toMatch(/FROM\s+orders\b/i);
    expect(RECOVER_DEVICE_ID_SQL).not.toMatch(/\bJOIN\b/i);
  });
});
