import { describe, expect, it } from 'vitest';
import {
  DUTY_TIME_LABEL,
  buildBranchFooterLines,
  buildBranchHeaderLines,
  formatClockTime,
  formatDutyWindow,
  normalizeBranchProfile,
  parseBranchProfile,
  serializeBranchProfile,
  type BranchProfile,
} from './branchProfile';

/** The exact object the server documents on /bootstrap and re-sends on /pull. */
const WIRE = {
  id: 7,
  name: 'jahra-kazma',
  name_ar: 'حلويات حبيبه لجهراء الكاظمه',
  phone: '+96599716263',
  address: 'Saad Al-Abdulla, Block 6, Street 12, Jahra',
  address_ar: 'سعد العبد الله، المربع 6، الشارع 12، الجهرة',
  duty_time_from: '10:00',
  duty_time_to: '23:59',
  invoice_note: 'Kanafa Habiba Amman Company, No. 22274655',
  invoice_note_ar: 'شركة كنافة حبيبة عمان، رقم 22274655',
  updated_at: '2026-08-29T09:44:28.000000Z',
};

const profile = () => normalizeBranchProfile(WIRE) as BranchProfile;

describe('normalizeBranchProfile', () => {
  it('reads the documented bootstrap shape', () => {
    expect(profile()).toEqual({
      id: '7',
      name: 'jahra-kazma',
      name_ar: 'حلويات حبيبه لجهراء الكاظمه',
      phone: '+96599716263',
      address: 'Saad Al-Abdulla, Block 6, Street 12, Jahra',
      address_ar: 'سعد العبد الله، المربع 6، الشارع 12، الجهرة',
      duty_time_from: '10:00',
      duty_time_to: '23:59',
      invoice_note: 'Kanafa Habiba Amman Company, No. 22274655',
      invoice_note_ar: 'شركة كنافة حبيبة عمان، رقم 22274655',
      updated_at: '2026-08-29T09:44:28.000000Z',
    });
  });

  it('keeps the two duty times nullable and every other field a string', () => {
    const p = normalizeBranchProfile({
      id: 7,
      duty_time_from: null,
      duty_time_to: null,
    }) as BranchProfile;

    expect(p.duty_time_from).toBeNull();
    expect(p.duty_time_to).toBeNull();
    // An unset column arrives as '', so nothing else needs a null check at the
    // template — and nothing may arrive there as undefined.
    for (const key of [
      'name',
      'name_ar',
      'phone',
      'address',
      'address_ar',
      'invoice_note',
      'invoice_note_ar',
    ] as const) {
      expect(p[key], key).toBe('');
    }
  });

  it('refuses a row with no id rather than caching a nameless branch', () => {
    expect(normalizeBranchProfile({ name: 'x' })).toBeNull();
    expect(normalizeBranchProfile(null)).toBeNull();
    expect(normalizeBranchProfile('nope')).toBeNull();
  });
});

describe('cache round-trip', () => {
  it('survives serialize → parse unchanged', () => {
    expect(parseBranchProfile(serializeBranchProfile(profile()))).toEqual(
      profile()
    );
  });

  it('treats an empty or corrupt cache as "no branch yet", not a crash', () => {
    expect(parseBranchProfile(null)).toBeNull();
    expect(parseBranchProfile('')).toBeNull();
    expect(parseBranchProfile('{not json')).toBeNull();
    // Written by a build that stored something else under the same key.
    expect(parseBranchProfile('{"name":"x"}')).toBeNull();
  });
});

describe('formatClockTime', () => {
  it('converts the 24h wire value to the 12h form the office prints', () => {
    expect(formatClockTime('10:00')).toBe('10:00 AM');
    expect(formatClockTime('23:59')).toBe('11:59 PM');
  });

  it('gets both ends of the clock right', () => {
    // The two values a naive %12 gets wrong.
    expect(formatClockTime('00:00')).toBe('12:00 AM');
    expect(formatClockTime('12:00')).toBe('12:00 PM');
    expect(formatClockTime('00:30')).toBe('12:30 AM');
    expect(formatClockTime('12:30')).toBe('12:30 PM');
  });

  it('accepts the HH:MM:SS a MySQL TIME column can serialise to', () => {
    expect(formatClockTime('09:05:00')).toBe('9:05 AM');
  });

  it('prints nothing for a value it cannot read', () => {
    for (const bad of [null, '', 'evening', '25:00', '10:99', '1000']) {
      expect(formatClockTime(bad as any), String(bad)).toBe('');
    }
  });
});

describe('formatDutyWindow', () => {
  it('prints the window when both ends are set', () => {
    expect(formatDutyWindow('10:00', '23:59')).toBe('10:00 AM - 11:59 PM');
  });

  it('prints nothing unless BOTH ends are set', () => {
    // A half-open window reads as a printing fault, which is why these two
    // fields are the only nullable ones on the row.
    expect(formatDutyWindow('10:00', null)).toBe('');
    expect(formatDutyWindow(null, '23:59')).toBe('');
    expect(formatDutyWindow(null, null)).toBe('');
  });

  it('distinguishes midnight from "not set"', () => {
    expect(formatDutyWindow('00:00', '00:00')).toBe('12:00 AM - 12:00 AM');
  });
});

describe('buildBranchHeaderLines', () => {
  it('prints name, then name_ar on its own RTL line, then phone', () => {
    expect(buildBranchHeaderLines(profile())).toEqual([
      { kind: 'text', text: 'jahra-kazma', rtl: false },
      { kind: 'text', text: 'حلويات حبيبه لجهراء الكاظمه', rtl: true },
      { kind: 'text', text: '+96599716263', rtl: false },
    ]);
  });

  it('does not stutter when the server falls name_ar back to name', () => {
    const p = normalizeBranchProfile({
      id: 7,
      name: 'jahra-kazma',
      name_ar: 'jahra-kazma',
    }) as BranchProfile;

    expect(buildBranchHeaderLines(p)).toEqual([
      { kind: 'text', text: 'jahra-kazma', rtl: false },
    ]);
  });

  it('omits whatever is empty', () => {
    const p = normalizeBranchProfile({ id: 7, name: 'Solo' }) as BranchProfile;
    expect(buildBranchHeaderLines(p)).toEqual([
      { kind: 'text', text: 'Solo', rtl: false },
    ]);
  });
});

describe('buildBranchFooterLines', () => {
  it('prints the back office order exactly', () => {
    expect(buildBranchFooterLines(profile())).toEqual([
      {
        kind: 'text',
        text: 'Saad Al-Abdulla, Block 6, Street 12, Jahra',
        rtl: false,
      },
      {
        kind: 'text',
        text: 'سعد العبد الله، المربع 6، الشارع 12، الجهرة',
        rtl: true,
      },
      { kind: 'phone', label: 'Phone / للطلبات', value: '+96599716263' },
      { kind: 'text', text: DUTY_TIME_LABEL, rtl: false },
      { kind: 'text', text: '10:00 AM - 11:59 PM', rtl: false },
      {
        kind: 'text',
        text: 'Kanafa Habiba Amman Company, No. 22274655',
        rtl: false,
      },
      { kind: 'text', text: 'شركة كنافة حبيبة عمان، رقم 22274655', rtl: true },
    ]);
  });

  it('drops the duty line but keeps the rest when hours are unset', () => {
    const p = normalizeBranchProfile({
      ...WIRE,
      duty_time_from: null,
      duty_time_to: null,
    }) as BranchProfile;

    const lines = buildBranchFooterLines(p);
    // Both the window AND its label go, not just the times.
    expect(
      lines.some((l) => l.kind === 'text' && l.text.includes('AM'))
    ).toBe(false);
    expect(
      lines.some((l) => l.kind === 'text' && l.text === DUTY_TIME_LABEL)
    ).toBe(false);
    expect(lines).toHaveLength(5);
  });

  it('renders nothing at all for a branch with only an id', () => {
    const p = normalizeBranchProfile({ id: 7 }) as BranchProfile;
    expect(buildBranchFooterLines(p)).toEqual([]);
  });
});
