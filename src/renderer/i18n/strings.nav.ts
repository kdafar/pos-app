// src/renderer/i18n/strings.nav.ts
// Owned by the nav surface. Add keys here — NOT in strings.ts — so parallel
// work on other surfaces cannot clobber this file.
//
// Covers: the app shell (sidebar, sync card, footer), the Settings page,
// and the shared toast / confirm-dialog chrome.
//
// Arabic is Kuwaiti retail/business register, not literal MSA. Numbers,
// versions, URLs and device IDs stay Latin — see strings.ts header.
export const navStrings = {
  /* ---------- sidebar section labels ---------- */
  'nav.section.catalog': { en: 'Catalog', ar: 'القائمة' },
  'nav.section.system': { en: 'System', ar: 'النظام' },

  /* ---------- sidebar destinations ---------- */
  'nav.orderProcess': { en: 'Order Process', ar: 'شاشة الطلب' },
  'nav.recentOrders': { en: 'Recent Orders', ar: 'آخر الطلبات' },
  'nav.closingReport': { en: 'Closing Report', ar: 'تقرير الإغلاق' },
  'nav.promocodes': { en: 'Promocodes', ar: 'أكواد الخصم' },
  'nav.paymentMethods': { en: 'Payment Methods', ar: 'طرق الدفع' },
  'nav.locations': { en: 'Locations', ar: 'المناطق' },

  /* ---------- sidebar controls ---------- */
  'nav.toggleTheme': { en: 'Toggle theme', ar: 'تغيير المظهر' },
  'nav.expandSidebar': { en: 'Expand sidebar', ar: 'توسيع القائمة الجانبية' },
  'nav.collapseSidebar': { en: 'Collapse sidebar', ar: 'طي القائمة الجانبية' },

  /* ---------- who is signed in ---------- */
  'nav.role.admin': { en: 'Admin', ar: 'مدير' },
  'nav.role.staff': { en: 'Staff', ar: 'موظف' },

  /* ---------- sync card ---------- */
  'sync.title': { en: 'Sync', ar: 'المزامنة' },
  'sync.noBranch': { en: 'No branch', ar: 'لا يوجد فرع' },
  'sync.online': { en: 'Online', ar: 'متصل' },
  'sync.offline': { en: 'Offline', ar: 'غير متصل' },
  'sync.onlineHint': {
    en: 'Online – syncing is enabled',
    ar: 'متصل — المزامنة مفعّلة',
  },
  'sync.offlineHint': {
    en: 'Offline – syncing is paused',
    ar: 'غير متصل — المزامنة متوقفة',
  },
  'sync.cannotSync': {
    en: 'Cannot sync while offline',
    ar: 'لا يمكن المزامنة بدون اتصال',
  },
  'sync.justNow': { en: 'just now', ar: 'الآن' },
  'sync.secondsAgo': { en: '{n}s ago', ar: 'قبل {n} ثانية' },
  'sync.minutesAgo': { en: '{n}m ago', ar: 'قبل {n} دقيقة' },
  'sync.notPaired': {
    en: 'Device not paired – open Settings',
    ar: 'الجهاز غير مربوط — افتح الإعدادات',
  },
  'sync.failed': { en: 'Sync failed', ar: 'فشلت المزامنة' },
  'sync.failedHint': {
    en: 'Check connection/base URL/pairing.',
    ar: 'تأكد من الاتصال ورابط الخادم وربط الجهاز.',
  },

  /* ---------- settings page ---------- */
  'settings.title': { en: 'Settings (Read-only)', ar: 'الإعدادات (عرض فقط)' },
  'settings.subtitle': {
    en: 'Meta (local) + Server settings. Sensitive values are masked. Pairing codes are hidden.',
    ar: 'إعدادات الجهاز المحلية وإعدادات الخادم. القيم الحساسة مخفية، وأكواد الربط لا تظهر.',
  },
  'settings.searchPlaceholder': {
    en: 'Search key/value/source…',
    ar: '...ابحث بالمفتاح أو القيمة أو المصدر',
  },
  'settings.filterBySource': { en: 'Filter by source', ar: 'تصفية حسب المصدر' },
  'settings.allSources': { en: 'All sources', ar: 'كل المصادر' },
  'settings.sourceMeta': { en: 'Meta (Local)', ar: 'محلي (الجهاز)' },
  'settings.sourceServer': { en: 'Server', ar: 'الخادم' },
  'settings.refresh': { en: 'Refresh', ar: 'تحديث' },
  'settings.colSource': { en: 'Source', ar: 'المصدر' },
  'settings.colKey': { en: 'Key', ar: 'المفتاح' },
  'settings.colValue': { en: 'Value', ar: 'القيمة' },
  'settings.sort': { en: 'Sort', ar: 'ترتيب' },
  'settings.copy': { en: 'Copy', ar: 'نسخ' },
  'settings.noRowsFiltered': {
    en: 'No rows match your filters.',
    ar: 'لا توجد نتائج مطابقة للتصفية.',
  },
  'settings.noRowsFound': { en: 'No rows found.', ar: 'لا توجد بيانات.' },
  'settings.page': { en: 'Page', ar: 'صفحة' },
  'settings.pageOf': { en: 'of', ar: 'من' },
  'settings.rowCount': { en: '{n} rows', ar: '{n} سطر' },
  'settings.rowsPerPage': { en: 'Rows', ar: 'عدد الأسطر' },
  'settings.first': { en: 'First', ar: 'الأول' },
  'settings.prev': { en: 'Prev', ar: 'السابق' },
  'settings.next': { en: 'Next', ar: 'التالي' },
  'settings.last': { en: 'Last', ar: 'الأخير' },
  'settings.readOnlyNotice': {
    en: 'This page is read-only for security. To change a value, update it in the appropriate layer (server admin or local device provisioning) and then refresh.',
    ar: 'هذه الصفحة للعرض فقط لأسباب أمنية. لتغيير أي قيمة، عدّلها من لوحة تحكم الخادم أو من إعداد الجهاز، ثم اضغط تحديث.',
  },
  'settings.languageHint': {
    en: 'Choose the till language. The choice is saved on this device and the screen direction changes with it.',
    ar: 'اختر لغة الواجهة. يتم حفظ الاختيار على هذا الجهاز ويتغير اتجاه الشاشة معه.',
  },

  /* ---------- confirm dialog defaults ---------- */
  'confirm.title': { en: 'Are you sure?', ar: 'هل أنت متأكد؟' },
  'confirm.message': {
    en: 'Please confirm this action.',
    ar: 'الرجاء تأكيد هذا الإجراء.',
  },
  'confirm.ok': { en: 'Confirm', ar: 'تأكيد' },

  /* ---------- toast chrome ---------- */
  'toast.dismiss': { en: 'Dismiss', ar: 'إخفاء' },
  'table.rows': { en: 'Rows', ar: 'صفوف' },
  'table.pageOf': { en: 'Page {page} of {pages}', ar: 'صفحة {page} من {pages}' },
} as const;
