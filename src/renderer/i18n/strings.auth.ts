// src/renderer/i18n/strings.auth.ts
// Owned by the auth surface. Add keys here — NOT in strings.ts — so parallel
// work on other surfaces cannot clobber this file.
//
// Conventions:
//  - Arabic is Kuwaiti/Gulf business register, not literal MSA.
//  - Digits, URLs, pairing codes and device-name examples stay Latin/LTR.
//  - `*bold*` markers are rendered as <b> by the <Rich> helper in the screens,
//    which lets the translator control where the emphasis falls in RTL.
//  - Leading "…" in Arabic strings is intentional: it renders at the end of the
//    line under RTL, matching the existing convention in strings.ts.
export const authStrings = {
  /* ---------- brand ---------- */
  'auth.brandTagline': {
    en: 'Offline-first restaurant & retail point of sale',
    ar: 'نظام نقاط بيع للمطاعم والمحلات يعمل بدون إنترنت',
  },

  /* ---------- login: header ---------- */
  'auth.branchSubtitle': { en: 'Branch: {name}', ar: 'الفرع: {name}' },
  'auth.branchIdSuffix': { en: ' (ID {id})', ar: ' (رقم {id})' },
  'auth.modeLive': { en: 'Mode: Live', ar: 'الوضع: متصل' },
  'auth.modeOffline': { en: 'Mode: Offline', ar: 'الوضع: بدون اتصال' },
  'auth.paired': { en: 'Paired', ar: 'مربوط' },
  'auth.notPaired': { en: 'Not paired', ar: 'غير مربوط' },
  'auth.online': { en: 'Online', ar: 'متصل بالإنترنت' },
  'auth.deviceOffline': { en: 'Offline (device)', ar: 'الجهاز غير متصل' },

  /* ---------- login: form ---------- */
  'auth.signInHelp': {
    en: 'Staff tap their name below and enter password. Admins can type email manually.',
    ar: 'الموظف يضغط على اسمه بالأسفل ويدخل كلمة المرور، والمدير يقدر يكتب البريد يدوياً.',
  },
  'auth.email': { en: 'Email', ar: 'البريد الإلكتروني' },
  'auth.passwordPlaceholder': {
    en: 'Enter password',
    ar: 'أدخل كلمة المرور',
  },
  'auth.show': { en: 'Show', ar: 'إظهار' },
  'auth.hide': { en: 'Hide', ar: 'إخفاء' },
  'auth.capsLock': { en: 'Caps Lock is ON', ar: 'مفتاح Caps Lock مُفعّل' },
  'auth.rememberEmail': {
    en: 'Remember email on this device',
    ar: 'تذكّر البريد على هذا الجهاز',
  },
  'auth.signingIn': { en: 'Signing in…', ar: '...جارٍ تسجيل الدخول' },
  'auth.branchRuleNote': {
    en: 'Staff can only log into their own branch. Admins may log in from any paired branch.',
    ar: 'الموظف يدخل على فرعه فقط، والمدير يقدر يدخل من أي فرع مربوط.',
  },

  /* ---------- login: quick users ---------- */
  'auth.quickUsers': { en: 'Quick users', ar: 'دخول سريع' },
  'auth.quickUsersHint': {
    en: 'Tap your name → we fill email.',
    ar: 'اضغط على اسمك ونعبّي البريد لك.',
  },
  'auth.noUsers': {
    en: 'No users synced yet. Pair this device and run sync.',
    ar: 'لا يوجد مستخدمون بعد. اربط الجهاز وشغّل المزامنة.',
  },

  /* ---------- login: device status ---------- */
  'auth.deviceStatus': { en: 'Device status', ar: 'حالة الجهاز' },
  'auth.server': { en: 'Server', ar: 'السيرفر' },
  'auth.notConfigured': { en: 'Not configured', ar: 'غير مهيأ' },
  'auth.lastSync': { en: 'Last sync', ar: 'آخر مزامنة' },
  'auth.outbox': { en: 'Outbox', ar: 'صندوق الإرسال' },
  'auth.pendingCount': { en: '{n} pending', ar: '{n} بانتظار الإرسال' },
  'auth.upToDate': { en: 'Up to date', ar: 'كل شيء محدّث' },
  'auth.sync': { en: 'Sync', ar: 'المزامنة' },
  'auth.syncToggle': { en: 'Sync toggle', ar: 'مفتاح المزامنة' },
  'auth.mode': { en: 'Mode', ar: 'الوضع' },
  'auth.modeLiveOption': { en: 'Live (sync)', ar: 'متصل (مزامنة)' },
  'auth.modeOfflineOption': { en: 'Offline only', ar: 'بدون اتصال فقط' },
  'auth.unpairDevice': { en: 'Unpair device', ar: 'إلغاء ربط الجهاز' },

  /* ---------- login: shift tips ---------- */
  'auth.shiftTips': { en: 'Shift tips', ar: 'إرشادات الوردية' },
  'auth.tipOffline': {
    en: 'If internet or server is down, switch mode to *Offline* and continue.',
    ar: 'إذا انقطع الإنترنت أو وقف السيرفر، حوّل الوضع إلى *بدون اتصال* وكمّل شغلك.',
  },
  'auth.tipBackOnline': {
    en: 'When back online, set mode to *Live* and press *Sync now* until outbox is 0.',
    ar: 'عند رجوع الاتصال، حوّل الوضع إلى *متصل* واضغط *مزامنة الآن* لين يصير صندوق الإرسال 0.',
  },
  'auth.tipPair': {
    en: 'Use *Pair device* if this machine is moved to another restaurant/server.',
    ar: 'استخدم *ربط الجهاز* إذا انتقل هذا الجهاز إلى مطعم أو سيرفر ثاني.',
  },

  /* ---------- login: footer ---------- */
  'auth.back': { en: 'Back', ar: 'رجوع' },
  'auth.reload': { en: 'Reload', ar: 'إعادة تحميل' },

  /* ---------- login: unpair confirmation ---------- */
  'auth.unpairConfirmTitle': {
    en: 'Unpair this device?',
    ar: 'إلغاء ربط هذا الجهاز؟',
  },
  'auth.unpairConfirmBody': {
    en: 'This will disconnect this POS from the online server and clear the paired branch for this machine.',
    ar: 'راح ينفصل هذا الجهاز عن السيرفر ويتم إلغاء الفرع المربوط فيه.',
  },
  'auth.unpairConfirmNote': {
    en: 'You can pair again later using a new code from the admin panel.',
    ar: 'تقدر تربط الجهاز مرة ثانية برمز جديد من لوحة الإدارة.',
  },
  'auth.unpairConfirmYes': { en: 'Yes, unpair', ar: 'نعم، ألغِ الربط' },
  'auth.unpairConfirmNo': { en: 'Keep paired', ar: 'خلّه مربوط' },

  /* ---------- login: errors ---------- */
  'auth.errModeChange': {
    en: 'Failed to change mode',
    ar: 'تعذّر تغيير الوضع',
  },
  'auth.errSync': { en: 'Sync failed', ar: 'فشلت المزامنة' },
  'auth.errCredentials': {
    en: 'Invalid credentials',
    ar: 'بيانات الدخول غير صحيحة',
  },
  'auth.errUnpair': {
    en: 'Failed to unpair device',
    ar: 'تعذّر إلغاء ربط الجهاز',
  },

  /* ---------- logout ---------- */
  'auth.signingOut': { en: 'Signing you out…', ar: '...جارٍ تسجيل الخروج' },
  'auth.signingOutBody': {
    en: 'We’re closing your POS session and clearing local access. You’ll be back on the login screen in a moment.',
    ar: 'يتم إغلاق جلسة نقطة البيع وإنهاء الصلاحية على هذا الجهاز، وبترجع لشاشة تسجيل الدخول بعد لحظات.',
  },

  /* ---------- startup gate ---------- */
  'gate.preparing': {
    en: 'Getting your POS ready…',
    ar: '...جارٍ تجهيز نقطة البيع',
  },
  'gate.checking': {
    en: 'Checking device pairing, branch and active session.',
    ar: 'جارٍ التحقق من ربط الجهاز والفرع والجلسة الحالية.',
  },
  'gate.statusError': {
    en: 'We had trouble checking the device status. You can try again below.',
    ar: 'تعذّر التحقق من حالة الجهاز. تقدر تعيد المحاولة بالأسفل.',
  },
  'gate.statusFailed': {
    en: 'Unable to check device status',
    ar: 'تعذّر التحقق من حالة الجهاز',
  },
  'gate.currentBranch': { en: 'Current branch:', ar: 'الفرع الحالي:' },
  'gate.tip1': {
    en: 'Tip: You can switch to Offline mode and keep taking orders even if internet is down.',
    ar: 'ملاحظة: تقدر تحوّل للوضع بدون اتصال وتكمّل استقبال الطلبات حتى لو انقطع الإنترنت.',
  },
  'gate.tip2': {
    en: 'Tip: Use quick users on the login screen so staff don’t have to type emails.',
    ar: 'ملاحظة: استخدم الدخول السريع في شاشة تسجيل الدخول عشان الموظف ما يحتاج يكتب البريد.',
  },
  'gate.tip3': {
    en: 'Tip: Run “Sync now” before closing to push all pending orders to the server.',
    ar: 'ملاحظة: شغّل «مزامنة الآن» قبل الإغلاق عشان ترسل كل الطلبات المعلّقة للسيرفر.',
  },
  'gate.tip4': {
    en: 'Tip: Admins can log in from any paired branch. Staff can only log into their own branch.',
    ar: 'ملاحظة: المدير يقدر يدخل من أي فرع مربوط، والموظف يدخل على فرعه فقط.',
  },
  'gate.tip5': {
    en: 'Tip: If this device moves to another restaurant, use “Pair device” again.',
    ar: 'ملاحظة: إذا انتقل هذا الجهاز إلى مطعم ثاني، استخدم «ربط الجهاز» من جديد.',
  },

  /* ---------- pairing ---------- */
  'pair.subtitle': {
    en: 'Step 1 of 2 – Connect this device to your server',
    ar: 'الخطوة 1 من 2 – اربط هذا الجهاز بالسيرفر',
  },
  'pair.alreadyPaired': {
    en: 'Already paired?',
    ar: 'الجهاز مربوط من قبل؟',
  },
  'pair.serverLocked': {
    en: '*This device was locked by the server.* Its catalog and saved orders are safe. Ask your administrator to unlock it, then pair again.',
    ar: '*تم قفل هذا الجهاز من السيرفر.* الأصناف والطلبات المحفوظة بأمان. اطلب من الإدارة فك القفل ثم أعد الربط.',
  },
  'pair.offlineTooLong': {
    en: '*This device was offline for too long.* For security it was signed out and unpaired. Local data was kept — pair again to reconnect and sync.',
    ar: '*هذا الجهاز ظل بدون اتصال مدة طويلة.* ولأسباب أمنية تم تسجيل الخروج وإلغاء الربط. البيانات المحلية محفوظة — أعد الربط للاتصال والمزامنة.',
  },
  'pair.reclaiming': {
    en: 'Reconnecting this device…',
    ar: 'جارٍ إعادة توصيل الجهاز…',
  },
  'pair.reclaimHint': {
    en: 'It was paired here before, so it is asking the server for a new key. No code needed.',
    ar: 'الجهاز كان مربوطًا هنا من قبل، لذا يطلب مفتاحًا جديدًا من السيرفر. لا حاجة لرمز.',
  },
  'pair.baseUrl': { en: 'Server base URL', ar: 'رابط السيرفر' },
  'pair.deviceName': { en: 'Device name', ar: 'اسم الجهاز' },
  'pair.branchIdLabel': { en: 'Branch ID', ar: 'رقم الفرع' },
  'pair.branchIdPlaceholder': { en: 'e.g. 5', ar: 'مثال: 5' },
  'pair.code': { en: 'Pairing code', ar: 'رمز الربط' },
  'pair.codePlaceholder': {
    en: 'Code from server',
    ar: 'الرمز الصادر من السيرفر',
  },
  'pair.prefilled': {
    en: 'We pre-filled server and branch from a previous pairing. Confirm they look correct before pairing.',
    ar: 'عبّينا رابط السيرفر ورقم الفرع من ربط سابق. تأكد إنهما صحيحين قبل الربط.',
  },
  'pair.notMarkedPaired': {
    en: 'Device paired but status is not marked as paired yet.',
    ar: 'تم ربط الجهاز لكن الحالة ما تحدثت إلى «مربوط» بعد.',
  },
  'pair.failed': { en: 'Pairing failed', ar: 'فشل الربط' },
  'pair.unpairFailed': { en: 'Unpair failed', ar: 'فشل إلغاء الربط' },
  'pair.howTo': {
    en: 'How to pair this device',
    ar: 'طريقة ربط هذا الجهاز',
  },
  'pair.step1': {
    en: 'On the web admin, open *POS devices* and click *Pair new device*.',
    ar: 'من لوحة الإدارة، افتح *أجهزة نقاط البيع* واضغط *ربط جهاز جديد*.',
  },
  'pair.step2': {
    en: 'Copy the *Server base URL* and *Branch ID* shown there and paste them into the form.',
    ar: 'انسخ *رابط السيرفر* و*رقم الفرع* الظاهرين هناك والصقهما في الحقول المجاورة.',
  },
  'pair.step3': {
    en: 'Enter the *Pairing code* generated by the server.',
    ar: 'أدخل *رمز الربط* الصادر من السيرفر.',
  },
  'pair.step4': {
    en: 'Press *Pair device*. If successful, you’ll be taken to the login screen.',
    ar: 'اضغط *ربط الجهاز*، وعند نجاح العملية بتنتقل إلى شاشة تسجيل الدخول.',
  },
  'pair.tips': { en: 'Tips', ar: 'ملاحظات' },
  'pair.tip1': {
    en: 'Use a descriptive device name like *Counter #1* or *Kitchen screen*.',
    ar: 'اختر اسم واضح للجهاز مثل *Counter #1* أو *Kitchen screen*.',
  },
  'pair.tip2': {
    en: 'If you move this machine to another branch, use *Unpair / Reset* first, then pair again.',
    ar: 'إذا نقلت هذا الجهاز إلى فرع ثاني، استخدم *إلغاء الربط* أولاً ثم أعد الربط.',
  },
} as const;
