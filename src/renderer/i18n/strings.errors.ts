// src/renderer/i18n/strings.errors.ts
//
// Chrome around error reporting — the buttons and labels of the toast and the
// checkout error summary. The error *sentences* themselves live in
// errorCopy.ts, keyed by code.

export const errorUiStrings = {
  'error.details': { en: 'Technical details', ar: 'تفاصيل تقنية' },
  'error.hideDetails': { en: 'Hide details', ar: 'إخفاء التفاصيل' },
  'error.copy': { en: 'Copy', ar: 'نسخ' },
  'error.copied': { en: 'Copied', ar: 'تم النسخ' },
  'error.code': { en: 'Code', ar: 'الرمز' },
  'error.repeated': { en: '×{count}', ar: '×{count}' },

  /* checkout pre-flight summary */
  'error.fixToContinue': {
    en: 'Finish these before placing the order',
    ar: 'أكمل هذه الخطوات قبل إتمام الطلب',
  },
  'error.oneLeft': { en: '1 thing to fix', ar: 'خطوة واحدة متبقية' },
  'error.manyLeft': { en: '{count} things to fix', ar: '{count} خطوات متبقية' },
  'error.goToField': { en: 'Show me', ar: 'اذهب إليه' },

  /* crash boundary */
  'error.crashTitle': { en: 'This screen stopped responding', ar: 'توقفت هذه الشاشة عن الاستجابة' },
  'error.crashMsg': {
    en: 'Nothing was lost — open orders are saved on this till. Reload the screen to carry on.',
    ar: 'لم يُفقد شيء — الطلبات المفتوحة محفوظة على الجهاز. أعد تحميل الشاشة للمتابعة.',
  },
  'error.reload': { en: 'Reload screen', ar: 'إعادة تحميل الشاشة' },
} as const;
