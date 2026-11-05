import { describe, it, expect } from 'vitest';
import { activeOrderSql, isActiveOrder } from './orderStatus';
import { resolveOwnOrderStatus, localWordForServerCode } from './serverStatus';
import { matchTableByName } from './pulledOrderTable';

describe('isActiveOrder', () => {
  it('counts own active words', () => {
    for (const s of ['open', 'pending', 'placed', 'prepared', 'ready', 'awaiting_pickup'])
      expect(isActiveOrder({ status: s })).toBe(true);
  });
  it('counts pulled orders by server code 1-3', () => {
    expect(isActiveOrder({ status: 'received', status_code: 1 })).toBe(true);
    expect(isActiveOrder({ status: 'preparing', status_code: 2 })).toBe(true);
    expect(isActiveOrder({ status: 'ready', status_code: 3 })).toBe(true);
    expect(isActiveOrder({ status: 'done', status_code: 4 })).toBe(false);
    expect(isActiveOrder({ status: 'cancelled by admin', status_code: 6 })).toBe(false);
    expect(isActiveOrder({ status: 'pending payment', status_code: 0 })).toBe(false);
  });
  it('a till-closed order with a stale code 1 is not active', () => {
    expect(isActiveOrder({ status: 'closed', status_code: 1 })).toBe(false);
  });
  it('sql fragment mentions both rules', () => {
    const sql = activeOrderSql('o');
    expect(sql).toContain("o.status IN ('open'");
    expect(sql).toContain('o.status_code IN (1, 2, 3)');
  });
});

describe('resolveOwnOrderStatus', () => {
  it('keeps the local word when the server is at or behind', () => {
    expect(resolveOwnOrderStatus('placed', 1, false)).toBe('placed');
    expect(resolveOwnOrderStatus('prepared', 1, false)).toBe('prepared');
    expect(resolveOwnOrderStatus('ready', 2, false)).toBe('ready');
  });
  it('follows the server when it moved on', () => {
    expect(resolveOwnOrderStatus('placed', 3, false)).toBe('ready');
    expect(resolveOwnOrderStatus('placed', 2, false)).toBe('prepared');
    expect(resolveOwnOrderStatus('ready', 4, false)).toBe('closed');
    expect(resolveOwnOrderStatus('placed', 5, false)).toBe('cancelled_client');
    expect(resolveOwnOrderStatus('placed', 6, false)).toBe('cancelled');
  });
  it('never regresses an unpushed local change', () => {
    expect(resolveOwnOrderStatus('prepared', 3, true)).toBe('prepared');
  });
  it('ignores pending-payment / missing codes', () => {
    expect(resolveOwnOrderStatus('placed', 0, false)).toBe('placed');
    expect(resolveOwnOrderStatus('placed', null, false)).toBe('placed');
    expect(localWordForServerCode(0)).toBeNull();
  });
});

describe('matchTableByName', () => {
  const tables = [
    { id: '10', label: 'Terrace 1', number: 1, label_ar: 'تراس' },
    { id: '11', label: null, number: 2, label_ar: null },
    { id: '12', label: 'Dup', number: 3 },
    { id: '13', label: ' dup ', number: 4 },
  ];
  it('matches label, Table N and label_ar case-insensitively', () => {
    expect(matchTableByName(tables, ' terrace 1 ')).toBe('10');
    expect(matchTableByName(tables, 'table 2')).toBe('11');
    expect(matchTableByName(tables, 'تراس')).toBe('10');
  });
  it('requires exactly one match', () => {
    expect(matchTableByName(tables, 'dup')).toBeNull();
    expect(matchTableByName(tables, 'nope')).toBeNull();
    expect(matchTableByName(tables, '')).toBeNull();
  });
});
