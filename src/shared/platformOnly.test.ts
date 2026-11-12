import { describe, expect, it } from 'vitest';
import {
  evaluatePlatformOnly,
  joinNames,
  localizeParams,
  normalizePlatformOnly,
  normalizePriceLists,
  platformRefusal,
  platformTag,
  refusalText,
} from './platformOnly';

// The dev.trebianco.com setup: Talabat (method 5) and Keeta (method 9).
const lists = normalizePriceLists([
  { id: 1, name: 'Talabat', name_ar: 'طلبات', payment_method_ids: [5] },
  { id: 2, name: 'Keeta', name_ar: 'كيتا', payment_method_ids: ['9'] },
]);
const methods = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => ({ id: String(id) }));
const po = normalizePlatformOnly({
  enabled: true,
  items: [
    { item_id: '212', price_list_ids: ['2'] },
    { item_id: '230', price_list_ids: ['1', '2'] },
    { item_id: '240', price_list_ids: ['1'] },
    { item_id: '250', price_list_ids: ['3'] },
  ],
});
const box = { item_id: 212, name: 'Keeta Box', name_ar: 'صندوق كيتا' };
const burger = { item_id: '1', name: 'Burger', name_ar: 'برغر' };
const both = { item_id: '230', name: 'Combo', name_ar: 'كومبو' };
const talabatOnly = { item_id: '240', name: 'Talabat Deal', name_ar: 'عرض طلبات' };
const offOnly = { item_id: '250', name: 'Old Deal', name_ar: 'عرض قديم' };

const verdict = (lines: any[], p = po) =>
  evaluatePlatformOnly({ lines, platformOnly: p, priceLists: lists, methods });

describe('platform-only items', () => {
  it('changes nothing when switched off or absent', () => {
    expect(normalizePlatformOnly({ enabled: false, items: [{ item_id: '212', price_list_ids: ['2'] }] }))
      .toEqual({ enabled: false, items: [] });
    expect(normalizePlatformOnly(undefined)).toBeNull();
    expect(verdict([box], normalizePlatformOnly({ enabled: false, items: [] }))).toEqual({ kind: 'none' });
    expect(platformRefusal({ kind: 'none' }, '1')).toBeNull();
  });

  it('leaves an order with no such dish alone', () => {
    expect(verdict([burger])).toEqual({ kind: 'none' });
  });

  it('offers only the platform methods, first one picked', () => {
    const v = verdict([burger, box]);
    expect(v.kind).toBe('ok');
    if (v.kind !== 'ok') return;
    expect(v.allowedMethodIds).toEqual(['9']);
    expect(platformRefusal(v, '9')).toBeNull();
    const r = platformRefusal(v, '1')!;
    expect(r.code).toBe('POS_VAL_PLATFORM_ONLY_ONE');
    expect(refusalText(r, 'en')).toBe('Keeta Box is only sold on Keeta. Remove it or choose Keeta.');
    expect(refusalText(r, 'ar')).toBe('صندوق كيتا يُباع فقط على كيتا. احذفه من الطلب أو اختر كيتا.');
  });

  it('a dish on two platforms allows both, "Talabat or Keeta"', () => {
    const v = verdict([both]);
    if (v.kind !== 'ok') throw new Error(v.kind);
    expect(v.allowedMethodIds).toEqual(['5', '9']);
    expect(refusalText(platformRefusal(v, '1')!, 'en')).toBe(
      'Combo is only sold on Talabat or Keeta. Remove it or choose Talabat or Keeta.'
    );
    expect(refusalText(platformRefusal(v, '1')!, 'ar')).toContain('طلبات أو كيتا');
  });

  it('several dishes share the common platform', () => {
    const v = verdict([box, both]);
    if (v.kind !== 'ok') throw new Error(v.kind);
    expect(v.allowedMethodIds).toEqual(['9']);
    const r = platformRefusal(v, '5')!;
    expect(r.code).toBe('POS_VAL_PLATFORM_ONLY_MANY');
    expect(refusalText(r, 'en')).toBe(
      'Keeta Box and Combo are only sold on Keeta. Remove them or choose Keeta.'
    );
    expect(refusalText(r, 'ar')).toBe(
      'صندوق كيتا و كومبو تُباع فقط على كيتا. احذفها من الطلب أو اختر كيتا.'
    );
  });

  it('refuses every method for dishes from different platforms', () => {
    const v = verdict([box, talabatOnly]);
    expect(v.kind).toBe('mixed');
    for (const m of ['1', '5', '9']) {
      expect(platformRefusal(v, m)?.code).toBe('POS_VAL_PLATFORM_ONLY_MIXED');
    }
    expect(refusalText(platformRefusal(v, '9')!, 'en')).toBe(
      "Keeta Box and Talabat Deal are sold on different platforms, so they can’t be in one order. Split them into two orders."
    );
  });

  it('a switched-off list refuses every method and still names the list', () => {
    const v = evaluatePlatformOnly({
      lines: [offOnly],
      platformOnly: po,
      priceLists: lists,
      methods,
      knownNames: new Map([['3', { name: 'Deliveroo', name_ar: 'دليفرو' }]]),
    });
    expect(v.kind).toBe('off');
    expect(refusalText(platformRefusal(v, '1')!, 'en')).toBe(
      'Old Deal is only sold on Deliveroo, and that price list is switched off. Switch it on under Price lists, or remove it.'
    );
  });

  it('a platform whose method is not active on this till is like switched off', () => {
    const v = evaluatePlatformOnly({
      lines: [box],
      platformOnly: po,
      priceLists: lists,
      methods: methods.filter((m) => m.id !== '9'),
    });
    expect(v.kind).toBe('off');
  });

  it('tags read "Talabat + Keeta"', () => {
    const names = new Map(lists.map((l) => [l.id, l]));
    expect(platformTag(['1', '2'], names)).toEqual({ en: 'Talabat + Keeta', ar: 'طلبات + كيتا' });
    expect(platformTag(['2'], names).en).toBe('Keeta');
  });

  it('joins names the web tills way', () => {
    expect(joinNames(['A', 'B', 'C'], 'en')).toBe('A, B and C');
    expect(joinNames(['أ', 'ب', 'ج'], 'ar')).toBe('أ، ب و ج');
  });

  it('localizes _ar params only for Arabic', () => {
    const p = { name: 'Box', name_ar: 'صندوق' };
    expect(localizeParams(p, 'en')).toBe(p);
    expect(localizeParams(p, 'ar')!.name).toBe('صندوق');
  });
});
