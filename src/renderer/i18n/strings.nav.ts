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
  'settings.invoiceLogo': { en: 'Invoice logo', ar: 'شعار الفاتورة' },
  'settings.invoiceLogoHint': {
    en: 'Download and cache the logo supplied by the server for offline invoices.',
    ar: 'تنزيل شعار الفاتورة من الخادم وحفظه للاستخدام دون اتصال.',
  },
  'settings.fetchLogo': { en: 'Fetch logo from server', ar: 'تنزيل الشعار من الخادم' },
  'settings.logoFetched': {
    en: 'Logo downloaded and ready for invoices.',
    ar: 'تم تنزيل الشعار وهو جاهز للفواتير.',
  },

  /* ---------- updates screen ----------
     Versions stay Latin and LTR, like every other identifier. */
  'nav.updates': { en: 'Updates', ar: 'التحديثات' },
  'update.title': { en: 'Software Update', ar: 'تحديث البرنامج' },
  'update.subtitle': {
    en: 'The till checks for a new version on its own. Use this screen to check now or to apply one that is waiting.',
    ar: 'يقوم الجهاز بالتحقق من وجود إصدار جديد تلقائياً. استخدم هذه الشاشة للتحقق الآن أو لتثبيت تحديث جاهز.',
  },
  'update.installedVersion': { en: 'Installed version', ar: 'الإصدار المثبت' },
  'update.lastChecked': { en: 'Last checked', ar: 'آخر تحقق' },
  'update.never': { en: 'Not yet', ar: 'لم يتم بعد' },
  'update.checkNow': { en: 'Check for updates', ar: 'التحقق من التحديثات' },

  'update.tryAgain': { en: 'Try again', ar: 'المحاولة مرة أخرى' },
  'update.safeBadge': { en: 'Safe automatic updates', ar: 'تحديثات تلقائية آمنة' },
  'update.howItWorks': { en: 'How updating works', ar: 'كيف يعمل التحديث' },
  'update.stepCheck': { en: '1. Check', ar: '١. التحقق' },
  'update.stepCheckHelp': {
    en: 'The POS looks securely for a newer version.',
    ar: 'يتحقق نظام نقاط البيع بأمان من وجود إصدار أحدث.',
  },
  'update.stepDownload': { en: '2. Download', ar: '٢. التنزيل' },
  'update.stepDownloadHelp': {
    en: 'Keep taking orders while it downloads in the background.',
    ar: 'يمكنك متابعة استقبال الطلبات أثناء التنزيل في الخلفية.',
  },
  'update.stepInstall': { en: '3. Restart', ar: '٣. إعادة التشغيل' },
  'update.stepInstallHelp': {
    en: 'Install when service is quiet and no order is open.',
    ar: 'ثبّت التحديث عندما يكون العمل هادئاً ولا توجد طلبات مفتوحة.',
  },
  'update.beforeRestart': { en: 'Before restarting', ar: 'قبل إعادة التشغيل' },
  'update.helpInternet': {
    en: 'Keep the internet connected until downloading finishes.',
    ar: 'أبقِ الاتصال بالإنترنت حتى يكتمل التنزيل.',
  },
  'update.helpOrders': {
    en: 'Finish or save every open order before installing.',
    ar: 'أكمل أو احفظ جميع الطلبات المفتوحة قبل التثبيت.',
  },
  'update.helpPower': {
    en: 'Do not turn off the computer during installation.',
    ar: 'لا تطفئ الكمبيوتر أثناء تثبيت التحديث.',
  },

  /* status headlines */
  'update.idleTitle': { en: 'Not checked yet', ar: 'لم يتم التحقق بعد' },
  'update.idleHint': {
    en: 'The first automatic check runs shortly after the till starts.',
    ar: 'يبدأ التحقق التلقائي بعد تشغيل الجهاز بوقت قصير.',
  },
  'update.checkingTitle': { en: 'Checking…', ar: '...جارٍ التحقق' },
  'update.noneTitle': {
    en: 'You are on the latest version',
    ar: 'لديك أحدث إصدار',
  },
  'update.noneHint': {
    en: 'Nothing to install.',
    ar: 'لا يوجد ما يتم تثبيته.',
  },
  'update.availableTitle': {
    en: 'Version {v} is available',
    ar: 'الإصدار {v} متاح',
  },
  'update.availableHint': {
    en: 'Downloading in the background. You can keep taking orders.',
    ar: 'يتم التنزيل في الخلفية. يمكنك متابعة استقبال الطلبات.',
  },
  'update.downloadingTitle': { en: 'Downloading update', ar: 'جارٍ تنزيل التحديث' },
  'update.downloadingHint': {
    en: '{done} of {total} • {speed}/s',
    ar: '{done} من {total} • {speed}/ث',
  },
  'update.readyTitle': {
    en: 'Version {v} is ready to install',
    ar: 'الإصدار {v} جاهز للتثبيت',
  },
  'update.readyHint': {
    en: 'It installs on its own the next time the till is closed. Restart now only when no order is open.',
    ar: 'سيتم التثبيت تلقائياً عند إغلاق الجهاز في المرة القادمة. لا تعد التشغيل الآن إلا إذا لم يكن هناك طلب مفتوح.',
  },
  'update.installNow': { en: 'Restart and install now', ar: 'إعادة التشغيل والتثبيت الآن' },
  'update.errorTitle': { en: 'Could not check for updates', ar: 'تعذر التحقق من التحديثات' },
  'update.errorHint': {
    en: 'The till keeps working normally. It will try again by itself.',
    ar: 'يواصل الجهاز العمل بشكل طبيعي وسيعيد المحاولة تلقائياً.',
  },
  'update.disabledTitle': {
    en: 'Automatic updates are off',
    ar: 'التحديث التلقائي غير مفعّل',
  },
  'update.disabled.dev': {
    en: 'This is a development build, so it never updates itself.',
    ar: 'هذه نسخة تطوير، ولا يتم تحديثها تلقائياً.',
  },
  'update.disabled.portable': {
    en: 'This is a portable build. It cannot replace itself — download the new version manually.',
    ar: 'هذه نسخة محمولة ولا يمكنها تحديث نفسها — قم بتنزيل الإصدار الجديد يدوياً.',
  },
  'update.disabled.unavailable': {
    en: 'The updater is not available on this device.',
    ar: 'خدمة التحديث غير متوفرة على هذا الجهاز.',
  },
  'update.releaseNotes': { en: "What's new", ar: 'الجديد في هذا الإصدار' },
  'update.autoNote': {
    en: 'The till checks every 6 hours and downloads in the background. It never restarts during service on its own — a waiting update is applied when the app is closed.',
    ar: 'يتحقق الجهاز كل 6 ساعات وينزّل التحديث في الخلفية. لا يعيد التشغيل أثناء العمل من تلقاء نفسه — يتم تثبيت التحديث المنتظر عند إغلاق التطبيق.',
  },
  'update.confirmInstallTitle': {
    en: 'Restart the till now?',
    ar: 'إعادة تشغيل الجهاز الآن؟',
  },
  'update.confirmInstallMessage': {
    en: 'The app closes and reopens on version {v}. Any order that is still open should be closed first.',
    ar: 'سيتم إغلاق التطبيق وفتحه على الإصدار {v}. يجب إغلاق أي طلب مفتوح قبل ذلك.',
  },
  'update.installRefused': {
    en: 'Nothing is ready to install yet.',
    ar: 'لا يوجد تحديث جاهز للتثبيت.',
  },
  'update.badgeReady': { en: 'Update ready', ar: 'تحديث جاهز' },

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
  'table.expandRow': { en: 'Show details', ar: 'عرض التفاصيل' },
  'table.pageOf': { en: 'Page {page} of {pages}', ar: 'صفحة {page} من {pages}' },
} as const;
