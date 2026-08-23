// src/shared/errorCatalog.ts
//
// The one catalogue. Every failure a person can see is a row here, and nothing
// reaches a screen that is not.
//
// Codes, severities and Arabic copy for anything the server can say come from
// the backend's contract (docs/BACKEND-QUESTIONS.md §7 and their reply); the
// Arabic is lifted from resources/lang/ar so the till, the website and the
// customer app use one vocabulary. Rows marked `app` below exist only in this
// client — the backend cannot know about a missing Windows printer or an item
// with no price — and are the inventory we owe them back
// (docs/pos-app-error-inventory.json).
//
// `scripts/export-errors.mjs` writes this out as docs/pos-errors.json, so the
// two catalogues can be diffed rather than drifting.
//
// Copy rules:
//  - `title` says what happened, 2–4 words. Never "Error".
//  - `body` says what to do next, in the second person, ~60 characters a line.
//  - No jargon, no channel names, no "failed to" — a cashier does not care
//    which function threw.
//  - {placeholders} must exist in both languages or the test fails.

export type Severity =
  /** Centred modal, dimmed backdrop, explicit dismissal. Work stops. */
  | 'blocker'
  /** Bottom card, auto-dismiss. Something went wrong; the till carries on. */
  | 'toast'
  /** Under the control that is wrong. The cashier can fix it right now. */
  | 'inline'
  /** Quiet. Progress, queues, confirmations — not a failure. */
  | 'info';

export type CatalogEntry = {
  severity: Severity;
  /** Whether retrying the same action can help. Drives the "Try again" button. */
  retry: boolean;
  /** Endpoint or app surface it comes from. Carried into the exported JSON. */
  where: string;
  /** HTTP status, where the server is the one refusing. */
  http?: number;
  /** `server` = in the backend's catalogue. `app` = ours, owed back to them. */
  origin: 'server' | 'app';
  /**
   * True only for codes that actually arrive from the server as a `code` field
   * in the response body. The backend ships 27 of these; everything else —
   * every POS_VAL_*, POS_NET_*, POS_PUSH_PARTIAL and the two payment-status
   * codes — is ours to raise. Waiting for one of those as a server code waits
   * forever, which is the mistake this flag exists to prevent.
   */
  sent: boolean;
  en: { title: string; body: string };
  ar: { title: string; body: string };
};

export const ERROR_CATALOG = {
  /* ─────────────────────────── network ─────────────────────────── */
  // Offline is not an error. The cashier did nothing wrong and has nothing to
  // fix, so this is `info` and never a red dialog.
  POS_NET_OFFLINE: {
    severity: 'info',
    retry: true,
    where: '*',
    sent: false,
    origin: 'server',
    en: {
      title: 'No internet connection',
      body: 'The order is saved on this till and will be sent automatically when the connection is back.',
    },
    ar: {
      title: 'لا يوجد اتصال بالإنترنت',
      body: 'الطلب محفوظ على الجهاز وسيُرسل تلقائيًا عند عودة الاتصال.',
    },
  },
  POS_NET_TIMEOUT: {
    severity: 'info',
    retry: true,
    where: '*',
    sent: false,
    origin: 'server',
    en: {
      title: 'The server is slow to answer',
      body: 'We will try again automatically. You can carry on working.',
    },
    ar: {
      title: 'الخادم بطيء في الرد',
      body: 'سنعيد المحاولة تلقائيًا. يمكنك متابعة العمل.',
    },
  },

  /* ──────────────────────── device auth ────────────────────────── */
  POS_AUTH_MISSING: {
    severity: 'blocker',
    retry: false,
    where: '*',
    http: 401,
    sent: true,
    origin: 'server',
    en: {
      title: 'Device not paired',
      body: 'This device is not linked to the system. Pair it again with the code from the dashboard.',
    },
    ar: {
      title: 'الجهاز غير مرتبط',
      body: 'هذا الجهاز غير مربوط بالنظام. اربطه من جديد برمز الربط من لوحة التحكم.',
    },
  },
  POS_DEVICE_REVOKED: {
    severity: 'blocker',
    retry: false,
    where: '*',
    http: 401,
    sent: true,
    origin: 'server',
    en: {
      title: 'Device deactivated',
      body: 'The manager switched this device off from the dashboard. Contact them to enable it again.',
    },
    ar: {
      title: 'تم إلغاء تفعيل الجهاز',
      body: 'أوقف المدير هذا الجهاز من لوحة التحكم. تواصل معه لإعادة تفعيله.',
    },
  },
  POS_TOKEN_INVALID: {
    severity: 'blocker',
    retry: false,
    where: '*',
    http: 401,
    sent: true,
    origin: 'server',
    en: {
      title: 'Device pairing has expired',
      body: 'The device token is no longer valid — usually because it was paired again elsewhere. Pair it with a new code.',
    },
    ar: {
      title: 'انتهت صلاحية ربط الجهاز',
      body: 'رمز الجهاز لم يعد صالحًا — غالبًا لأن الجهاز أُعيد ربطه من مكان آخر. أعد الربط برمز جديد.',
    },
  },
  POS_DEVICE_LOCKED: {
    severity: 'blocker',
    retry: false,
    where: '*',
    http: 423,
    sent: true,
    origin: 'server',
    en: {
      title: 'Device is locked',
      body: 'This device was locked from the dashboard on {locked_at}. Contact the manager to unlock it.',
    },
    ar: {
      title: 'الجهاز مقفل',
      body: 'تم قفل هذا الجهاز من لوحة التحكم بتاريخ {locked_at}. تواصل مع المدير لفتحه.',
    },
  },
  POS_DEVICE_KILLSWITCH: {
    severity: 'blocker',
    retry: false,
    where: '*',
    http: 423,
    sent: true,
    origin: 'server',
    en: {
      title: 'Device locked automatically',
      body: 'This device went too long without reaching the server, so it locked itself to protect the data. Ask the manager to enable it again.',
    },
    ar: {
      title: 'قُفل الجهاز تلقائيًا',
      body: 'مضت مدة طويلة دون اتصال هذا الجهاز بالخادم، فقُفل تلقائيًا لحماية البيانات. اطلب من المدير إعادة تفعيله.',
    },
  },
  POS_RATE_LIMITED: {
    severity: 'toast',
    retry: true,
    where: '/register',
    http: 429,
    sent: true,
    origin: 'server',
    en: {
      title: 'Too many attempts',
      body: 'Wait {retry_after} seconds and try again.',
    },
    ar: {
      title: 'محاولات كثيرة',
      body: 'انتظر {retry_after} ثانية ثم حاول مرة أخرى.',
    },
  },
  POS_SERVER_ERROR: {
    severity: 'toast',
    retry: true,
    where: '*',
    http: 500,
    sent: true,
    origin: 'server',
    en: {
      title: 'Server error',
      body: 'We could not finish that just now. The order is saved and we will try again. Tell support if it keeps happening.',
    },
    ar: {
      title: 'خطأ في الخادم',
      body: 'لم نتمكن من إتمام العملية الآن. الطلب محفوظ وسنعيد المحاولة. إذا تكرر، أبلغ الدعم الفني.',
    },
  },
  // Anything the server refused with its own sentence and no code we know.
  POS_SERVER_REJECTED: {
    severity: 'toast',
    retry: false,
    where: '*',
    http: 422,
    sent: false,
    origin: 'server',
    en: { title: 'The server refused this', body: '{detail}' },
    ar: { title: 'الخادم رفض العملية', body: '{detail}' },
  },

  /* ───────────────────────── pairing ───────────────────────────── */
  POS_PAIR_CODE_INVALID: {
    severity: 'inline',
    retry: false,
    where: 'POST /register',
    http: 403,
    sent: true,
    origin: 'server',
    en: {
      title: 'Pairing code is wrong',
      body: 'Check the code in the dashboard and enter it again.',
    },
    ar: {
      title: 'رمز الربط غير صحيح',
      body: 'تأكد من الرمز في لوحة التحكم ثم أدخله مرة أخرى.',
    },
  },
  POS_PAIR_BRANCH_INVALID: {
    severity: 'inline',
    retry: false,
    where: 'POST /register',
    http: 422,
    sent: true,
    origin: 'server',
    en: {
      title: 'Choose a branch',
      body: 'An existing branch must be selected before the device can be paired.',
    },
    ar: {
      title: 'اختر الفرع',
      body: 'لا بد من اختيار فرع موجود قبل ربط الجهاز.',
    },
  },
  POS_PAIR_DEVICE_REVOKED: {
    severity: 'blocker',
    retry: false,
    where: 'POST /register',
    http: 403,
    sent: true,
    origin: 'server',
    en: {
      title: 'Device suspended',
      body: 'The manager switched this device off, and it cannot be paired again until they enable it from the dashboard.',
    },
    ar: {
      title: 'الجهاز موقوف',
      body: 'أوقف المدير هذا الجهاز، ولا يمكن ربطه من جديد قبل إعادة تفعيله من لوحة التحكم.',
    },
  },
  POS_PAIR_DEVICE_LOCKED: {
    severity: 'blocker',
    retry: false,
    where: 'POST /register',
    http: 403,
    sent: true,
    origin: 'server',
    en: {
      title: 'Device is locked',
      body: 'This device is locked from the dashboard. Ask the manager to unlock it, then pair again.',
    },
    ar: {
      title: 'الجهاز مقفل',
      body: 'هذا الجهاز مقفل من لوحة التحكم. اطلب من المدير فتحه ثم أعد الربط.',
    },
  },
  POS_PAIR_INPUT_MISSING: {
    severity: 'inline',
    retry: false,
    where: 'auth:pair (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'Pairing details missing',
      body: 'Enter both the server address and the pairing code.',
    },
    ar: {
      title: 'بيانات الربط ناقصة',
      body: 'أدخل عنوان الخادم ورمز الربط معًا.',
    },
  },
  POS_PAIR_RESPONSE_INVALID: {
    severity: 'blocker',
    retry: true,
    where: 'auth:pair (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'Pairing failed',
      body: 'The server sent back a reply we could not read. Check the address and the pairing code.',
    },
    ar: {
      title: 'تعذر ربط الجهاز',
      body: 'رد الخادم غير مفهوم. تأكد من العنوان ورمز الربط.',
    },
  },

  /* ────────────────────── push / the outbox ────────────────────── */
  POS_PUSH_DEVICE_UNAUTHORIZED: {
    severity: 'blocker',
    retry: false,
    where: 'POST /push',
    http: 403,
    sent: true,
    origin: 'server',
    en: {
      title: 'The server does not know this device',
      body: 'Pair the device again so the saved orders can be sent.',
    },
    ar: {
      title: 'الجهاز غير معروف للخادم',
      body: 'أعد ربط الجهاز حتى تُرسل الطلبات المحفوظة.',
    },
  },
  POS_PUSH_MSGID_MISSING: {
    severity: 'toast',
    retry: false,
    where: 'POST /push',
    http: 422,
    sent: true,
    origin: 'server',
    en: {
      title: 'The batch could not be sent',
      body: 'Something went wrong inside the till software. The orders are safe and nothing was lost. Tell support.',
    },
    ar: {
      title: 'تعذر إرسال الدفعة',
      body: 'حدث خلل في برنامج نقطة البيع. الطلبات محفوظة ولم يُفقد شيء. أبلغ الدعم الفني.',
    },
  },
  POS_PUSH_ORDER_MALFORMED: {
    severity: 'toast',
    retry: false,
    where: 'POST /push',
    http: 200,
    sent: true,
    origin: 'server',
    en: {
      title: 'A damaged order was not sent',
      body: 'One order ({temp_id}) was refused because its data is broken. Re-enter it by hand and tell support.',
    },
    ar: {
      title: 'طلب تالف لم يُرسل',
      body: 'طلب واحد ({temp_id}) لم يُقبل بسبب خلل في بياناته. أعد إدخاله يدويًا وأبلغ الدعم الفني.',
    },
  },
  POS_PUSH_ORDER_FINALIZED: {
    severity: 'toast',
    retry: false,
    where: 'POST /push',
    http: 200,
    sent: true,
    origin: 'server',
    en: {
      title: 'The order is already closed',
      body: 'This order was finished on the server and the till cannot change it. Speak to the manager if it must be changed.',
    },
    ar: {
      title: 'الطلب مُغلق مسبقًا',
      body: 'هذا الطلب أُنهي على الخادم ولا يمكن تعديله من نقطة البيع. راجع المدير إذا كان التعديل ضروريًا.',
    },
  },
  POS_PUSH_ORDER_FAILED: {
    severity: 'info',
    retry: true,
    where: 'POST /push',
    http: 200,
    sent: true,
    origin: 'server',
    en: {
      title: 'Waiting to be sent',
      body: 'One order has not arrived yet. We will try again automatically — there is no need to re-enter it.',
    },
    ar: {
      title: 'في انتظار الإرسال',
      body: 'طلب واحد لم يصل بعد. سنعيد المحاولة تلقائيًا — لا حاجة لإعادة إدخاله.',
    },
  },
  POS_PUSH_PARTIAL: {
    severity: 'info',
    retry: true,
    where: 'POST /push',
    http: 200,
    sent: false,
    origin: 'server',
    en: {
      title: '{accepted} orders synced',
      body: '{failed} still queued and will be sent automatically.',
    },
    ar: {
      title: 'تمت مزامنة {accepted} من الطلبات',
      body: 'بقي {failed} في الانتظار وسيُرسل تلقائيًا.',
    },
  },

  /* ───────────────────────── promos ────────────────────────────── */
  POS_PROMO_INPUT_MISSING: {
    severity: 'inline',
    retry: false,
    where: 'POST /promos/validate',
    http: 422,
    sent: true,
    origin: 'server',
    en: {
      title: 'Enter the promo code',
      body: 'Type the code after adding items to the order.',
    },
    ar: {
      title: 'أدخل رمز الكوبون',
      body: 'اكتب الرمز بعد إضافة أصناف إلى الطلب.',
    },
  },
  POS_PROMO_UNAVAILABLE: {
    severity: 'inline',
    retry: false,
    where: 'POST /promos/validate',
    http: 200,
    sent: true,
    origin: 'server',
    en: {
      title: 'Promo code is not valid',
      body: 'The code does not exist or is switched off at the moment.',
    },
    ar: {
      title: 'كوبون الخصم غير صالح',
      body: 'الرمز غير موجود أو موقوف حاليًا.',
    },
  },
  POS_PROMO_MIN_NOT_REACHED: {
    severity: 'inline',
    retry: false,
    where: 'POST /promos/validate',
    http: 200,
    sent: true,
    origin: 'server',
    en: {
      title: 'The order is below the minimum',
      body: 'The order total must be at least {min_amount} KWD to use this code.',
    },
    ar: {
      title: 'لم يبلغ الطلب الحد الأدنى',
      body: 'يجب أن يكون إجمالي الطلب {min_amount} د.ك على الأقل لاستخدام هذا الكوبون.',
    },
  },
  POS_PROMO_WRONG_BRANCH: {
    severity: 'inline',
    retry: false,
    where: 'order submit',
    http: 200,
    sent: false,
    origin: 'server',
    en: {
      title: 'The code does not apply to this branch',
      body: 'Try another code, or place the order without a discount.',
    },
    ar: {
      title: 'الكوبون لا يصلح لهذا الفرع',
      body: 'جرّب كوبونًا آخر أو أكمل الطلب بدون خصم.',
    },
  },

  /* ───────────────────────── payments ──────────────────────────── */
  POS_PAY_INPUT_MISSING: {
    severity: 'toast',
    retry: false,
    where: 'POST /payments/link',
    http: 422,
    sent: true,
    origin: 'server',
    en: {
      title: 'The payment link could not be created',
      body: 'Something went wrong inside the software. Try another payment method or tell support.',
    },
    ar: {
      title: 'تعذر إنشاء رابط الدفع',
      body: 'حدث خلل في البرنامج. جرّب طريقة دفع أخرى أو أبلغ الدعم الفني.',
    },
  },
  POS_PAY_METHOD_UNAVAILABLE: {
    severity: 'inline',
    retry: false,
    where: 'POST /payments/link',
    http: 422,
    sent: true,
    origin: 'server',
    en: {
      title: 'Payment method is switched off',
      body: 'This method is not available for the till. Choose another one.',
    },
    ar: {
      title: 'طريقة الدفع غير مفعّلة',
      body: 'هذه الطريقة غير متاحة لنقطة البيع. اختر طريقة أخرى.',
    },
  },
  POS_PAY_AMOUNT_UNKNOWN: {
    severity: 'toast',
    retry: true,
    where: 'POST /payments/link',
    http: 422,
    sent: true,
    origin: 'server',
    en: {
      title: 'The amount is not set',
      body: 'The order has not synced yet. Try again in a moment, or enter the amount by hand.',
    },
    ar: {
      title: 'لم يُحدَّد المبلغ',
      body: 'الطلب لم تتم مزامنته بعد. أعد المحاولة بعد لحظات أو أدخل المبلغ يدويًا.',
    },
  },
  POS_PAY_EXTERNAL_ID_CONFLICT: {
    severity: 'toast',
    retry: false,
    where: 'POST /payments/link',
    http: 409,
    sent: true,
    origin: 'server',
    en: {
      title: 'That order number is in use at another branch',
      body: 'A payment link cannot be created with this number. Tell support.',
    },
    ar: {
      title: 'رقم الطلب مستخدم في فرع آخر',
      body: 'لا يمكن إنشاء رابط دفع بهذا الرقم. أبلغ الدعم الفني.',
    },
  },
  // Not a failure: a link is being minted right now. Poll /payments/status
  // rather than asking for a second one.
  POS_PAY_LINK_IN_PROGRESS: {
    severity: 'info',
    retry: true,
    where: 'POST /payments/link',
    http: 409,
    sent: true,
    origin: 'server',
    en: {
      title: 'Creating the payment link',
      body: 'The link is being created right now. Wait a moment.',
    },
    ar: {
      title: 'جارٍ إنشاء رابط الدفع',
      body: 'الرابط قيد الإنشاء الآن. انتظر لحظات.',
    },
  },
  POS_PAY_PROVIDER_FAILED: {
    severity: 'toast',
    retry: true,
    where: 'POST /payments/link',
    http: 500,
    sent: true,
    origin: 'server',
    en: {
      title: 'The payment link could not be created',
      body: 'The payment provider did not answer. Try again, or take the amount in cash.',
    },
    ar: {
      title: 'تعذر إنشاء رابط للدفع',
      body: 'لم يستجب مزود الدفع. أعد المحاولة أو حصّل المبلغ نقدًا.',
    },
  },
  POS_PAY_STATUS_INPUT_MISSING: {
    severity: 'toast',
    retry: false,
    where: 'GET /payments/status',
    http: 422,
    sent: true,
    origin: 'server',
    en: {
      title: 'The payment could not be checked',
      body: 'Something went wrong inside the software. Check the payment from the dashboard.',
    },
    ar: {
      title: 'تعذر التحقق من الدفع',
      body: 'حدث خلل في البرنامج. تحقق من حالة الدفع من لوحة التحكم.',
    },
  },
  POS_PAY_INTENT_NOT_FOUND: {
    severity: 'toast',
    retry: false,
    where: 'GET /payments/status',
    http: 404,
    sent: true,
    origin: 'server',
    en: {
      title: 'No payment link for this order',
      body: 'Create a new payment link, or take the amount in cash.',
    },
    ar: {
      title: 'لا يوجد رابط دفع لهذا الطلب',
      body: 'أنشئ رابط دفع جديدًا أو حصّل المبلغ نقدًا.',
    },
  },
  POS_PAY_STATUS_FAILED: {
    severity: 'toast',
    retry: false,
    where: 'GET /payments/status',
    http: 200,
    sent: false,
    origin: 'server',
    en: {
      title: 'Payment failed',
      body: 'The payment did not go through. Ask the customer to try again, or use another method.',
    },
    ar: {
      title: 'فشل الدفع',
      body: 'لم تتم عملية الدفع. اطلب من العميل المحاولة مرة أخرى أو استخدم طريقة أخرى.',
    },
  },
  POS_PAY_STATUS_EXPIRED: {
    severity: 'toast',
    retry: false,
    where: 'GET /payments/status',
    http: 200,
    sent: false,
    origin: 'server',
    en: {
      title: 'The payment link has expired',
      body: 'Create a new link for the customer.',
    },
    ar: {
      title: 'انتهت صلاحية رابط الدفع',
      body: 'أنشئ رابطًا جديدًا للعميل.',
    },
  },
  POS_PAY_NOT_CONFIGURED: {
    severity: 'toast',
    retry: false,
    where: 'payments:createLink (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'Online payment is not set up',
      body: 'This till cannot create payment links yet. Take the payment another way, or ask the office to finish setup.',
    },
    ar: {
      title: 'الدفع الإلكتروني غير مفعّل',
      body: 'لا يمكن إنشاء روابط الدفع من هذا الجهاز. استخدم طريقة دفع أخرى أو اطلب من الإدارة إكمال الإعداد.',
    },
  },

  /* ──────────── validation: the ticket, before it is sent ──────────── */
  POS_VAL_TABLE_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete (dine-in)',
    sent: false,
    origin: 'server',
    en: {
      title: 'Choose a table',
      body: 'Dine-in orders need a table. Pick the table, then finish the order.',
    },
    ar: {
      title: 'اختر الطاولة',
      body: 'طلبات الصالة تحتاج طاولة. اختر الطاولة ثم أكمل الطلب.',
    },
  },
  POS_VAL_CART_EMPTY: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete',
    sent: false,
    origin: 'server',
    en: { title: 'The cart is empty', body: 'Add some items to finish the order.' },
    ar: { title: 'السلة فارغة!', body: 'أضف بعض الأصناف لإتمام الطلبية.' },
  },
  POS_VAL_ORDER_TYPE_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete',
    sent: false,
    origin: 'server',
    en: { title: 'Order type is required', body: 'Choose delivery, pickup or dine-in.' },
    ar: { title: 'نوع الطلبية مطلوب', body: 'اختر: توصيل، استلام، أو صالة.' },
  },
  POS_VAL_MOBILE_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete (delivery)',
    sent: false,
    origin: 'server',
    en: {
      title: 'Mobile number is required',
      body: 'Enter an 8-digit number for delivery orders.',
    },
    ar: {
      title: 'رقم الموبايل مطلوب',
      body: 'أدخل رقمًا من 8 أرقام لطلبات التوصيل.',
    },
  },
  POS_VAL_CITY_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete (delivery)',
    sent: false,
    origin: 'server',
    en: {
      title: 'Please choose the area',
      body: 'The area sets the delivery charge and the minimum order.',
    },
    ar: {
      title: 'يرجى اختيار المنطقة',
      body: 'المنطقة تحدد رسوم التوصيل والحد الأدنى للطلب.',
    },
  },
  POS_VAL_BLOCK_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete (delivery)',
    sent: false,
    origin: 'server',
    en: { title: 'Please choose the block', body: 'Delivery needs the block number.' },
    ar: { title: 'يرجى تحديد القطعة', body: 'التوصيل يحتاج رقم القطعة.' },
  },
  POS_VAL_ADDRESS_TYPE_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete (delivery)',
    sent: false,
    origin: 'server',
    en: { title: 'Choose the address type', body: 'House, apartment or office.' },
    ar: { title: 'اختر نوع العنوان', body: 'منزل، شقة، أو مكتب.' },
  },
  POS_VAL_ADDRESS_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete (delivery)',
    sent: false,
    origin: 'app',
    en: { title: 'Address is required', body: 'A delivery order needs a delivery address.' },
    ar: { title: 'العنوان مطلوب', body: 'طلب التوصيل يحتاج إلى عنوان.' },
  },
  POS_VAL_BRANCH_REQUIRED: {
    severity: 'blocker',
    retry: false,
    where: 'orders.complete',
    sent: false,
    origin: 'server',
    en: {
      title: 'No branch is set',
      body: 'This user is not linked to a branch, and an order cannot be recorded without one. Speak to the manager.',
    },
    ar: {
      title: 'الفرع غير محدد',
      body: 'هذا المستخدم غير مرتبط بفرع، ولا يمكن تسجيل طلب بدون فرع. راجع المدير.',
    },
  },
  POS_VAL_MIN_ORDER: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete (delivery)',
    sent: false,
    origin: 'server',
    en: {
      title: 'Minimum order for this area is {amount} KWD',
      body: 'Add more items, or change the order type.',
    },
    ar: {
      title: 'أقل طلبية لهذه المنطقة {amount} د.ك',
      body: 'أضف أصنافًا أخرى أو غيّر نوع الطلب.',
    },
  },
  POS_VAL_TABLE_RESERVED: {
    severity: 'toast',
    retry: false,
    where: 'orders.complete / open table',
    sent: false,
    origin: 'server',
    en: {
      title: 'The table is taken',
      body: 'That table has an open order with another cashier. Choose a different table.',
    },
    ar: {
      title: 'الطاولة محجوزة',
      body: 'طاولة مشغولة بطلب مفتوح لكاشير آخر. اختر طاولة أخرى.',
    },
  },
  POS_VAL_TABLE_UNAUTHORIZED: {
    severity: 'toast',
    retry: false,
    where: 'open table',
    http: 403,
    sent: false,
    origin: 'server',
    en: {
      title: 'You cannot use this table',
      body: 'The table belongs to another branch.',
    },
    ar: {
      title: 'غير مسموح لك باستخدام هذه الطاولة',
      body: 'الطاولة تتبع فرعًا آخر.',
    },
  },
  POS_VAL_STOCK: {
    severity: 'inline',
    retry: false,
    where: 'add to cart',
    sent: false,
    origin: 'server',
    en: {
      title: 'Not enough of this item',
      body: 'Reduce the quantity, or choose another item.',
    },
    ar: {
      title: 'الصنف غير متوفر بهذه الكمية!',
      body: 'قلّل الكمية أو اختر صنفًا آخر.',
    },
  },
  POS_VAL_VARIATION: {
    severity: 'inline',
    retry: false,
    where: 'add to cart',
    sent: false,
    origin: 'server',
    en: {
      title: 'That option is not valid',
      body: 'Choose a size or option that is available for this item.',
    },
    ar: {
      title: 'الخيار المحدد غير صالح',
      body: 'اختر حجمًا أو خيارًا متاحًا للصنف.',
    },
  },
  POS_VAL_ORDER_LOCKED: {
    severity: 'blocker',
    retry: false,
    where: 'edit order',
    sent: false,
    origin: 'server',
    en: {
      title: 'The order is already finished',
      body: 'Only a manager can change it now.',
    },
    ar: {
      title: 'الطلب مكتمل بالفعل',
      body: 'لا يمكن تعديله إلا بواسطة المدير.',
    },
  },
  POS_VAL_ORDER_NOT_FOUND: {
    severity: 'toast',
    retry: false,
    where: 'edit order',
    sent: false,
    origin: 'server',
    en: {
      title: 'The order was not found',
      body: 'It may have been deleted or moved. Refresh the list and try again.',
    },
    ar: {
      title: 'لم يتم العثور على الطلب',
      body: 'ربما حُذف أو نُقل. حدّث القائمة وحاول مرة أخرى.',
    },
  },

  /* ─────────── validation the app owns (owed back to backend) ─────────── */
  POS_VAL_NAME_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete',
    sent: false,
    origin: 'app',
    en: { title: 'Customer name is required', body: 'Enter the customer’s name.' },
    ar: { title: 'اسم العميل مطلوب', body: 'أدخل اسم العميل.' },
  },
  POS_VAL_PAYMENT_METHOD_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders.complete',
    sent: false,
    origin: 'app',
    en: { title: 'Payment method is required', body: 'Choose how the customer is paying.' },
    ar: { title: 'طريقة الدفع مطلوبة', body: 'اختر طريقة دفع العميل.' },
  },
  POS_VAL_ORDER_ID_MISSING: {
    severity: 'toast',
    retry: false,
    where: 'payments (app)',
    sent: false,
    origin: 'app',
    en: { title: 'No order selected', body: 'Open an order first.' },
    ar: { title: 'لم يتم اختيار طلب', body: 'افتح طلبًا أولًا.' },
  },
  POS_VAL_TYPE_LOCKED_TABLE: {
    severity: 'toast',
    retry: false,
    where: 'orders:setType',
    sent: false,
    origin: 'app',
    en: {
      title: 'The table is still held',
      body: 'Release the table before changing this order to another type.',
    },
    ar: {
      title: 'الطاولة ما زالت محجوزة',
      body: 'حرّر الطاولة قبل تغيير نوع الطلب.',
    },
  },
  POS_VAL_TYPE_LOCKED_CLOSED: {
    severity: 'toast',
    retry: false,
    where: 'orders:setType',
    sent: false,
    origin: 'app',
    en: {
      title: 'The order is closed',
      body: 'The order type cannot change once the order is closed.',
    },
    ar: {
      title: 'الطلب مغلق',
      body: 'لا يمكن تغيير نوع الطلب بعد إغلاقه.',
    },
  },
  POS_VAL_STATUS_UNKNOWN: {
    severity: 'toast',
    retry: false,
    where: 'orders:setStatus',
    sent: false,
    origin: 'app',
    en: { title: 'Status not allowed', body: 'The till cannot set that status.' },
    ar: { title: 'حالة غير مسموحة', body: 'لا يمكن للجهاز تعيين هذه الحالة.' },
  },
  POS_VAL_STATUS_TRANSITION: {
    severity: 'toast',
    retry: false,
    where: 'orders:setStatus',
    sent: false,
    origin: 'app',
    en: {
      title: 'That step is not allowed',
      body: 'An order cannot go from {current} to {target}.',
    },
    ar: {
      title: 'خطوة غير مسموحة',
      body: 'لا يمكن نقل الطلب من {current} إلى {target}.',
    },
  },
  POS_VAL_CANCEL_EMPTY_DRAFT: {
    severity: 'toast',
    retry: false,
    where: 'orders:setStatus',
    sent: false,
    origin: 'app',
    en: {
      title: 'Nothing to cancel',
      body: 'An empty draft was never sent, so it cannot be cancelled. Delete it instead.',
    },
    ar: {
      title: 'لا يوجد ما يُلغى',
      body: 'المسودة الفارغة لم تُرسل أصلًا فلا يمكن إلغاؤها. احذفها بدلًا من ذلك.',
    },
  },
  POS_VAL_LINES_UNREADABLE: {
    severity: 'toast',
    retry: true,
    where: 'orders:close',
    sent: false,
    origin: 'app',
    en: {
      title: 'The order could not be read',
      body: 'The order’s items could not be read just now. Try again.',
    },
    ar: {
      title: 'تعذرت قراءة الطلب',
      body: 'تعذرت قراءة أصناف الطلب الآن. حاول مرة أخرى.',
    },
  },
  POS_VAL_NOT_DINE_IN: {
    severity: 'toast',
    retry: false,
    where: 'orders:setTable',
    sent: false,
    origin: 'app',
    en: { title: 'Not a dine-in order', body: 'Tables are only for dine-in orders.' },
    ar: { title: 'الطلب ليس داخل الصالة', body: 'الطاولات مخصصة لطلبات الصالة فقط.' },
  },
  POS_VAL_TABLE_NOT_FOUND: {
    severity: 'toast',
    retry: false,
    where: 'orders:setTable',
    sent: false,
    origin: 'app',
    en: {
      title: 'Table not found',
      body: 'That table is no longer set up on this till.',
    },
    ar: {
      title: 'الطاولة غير موجودة',
      body: 'هذه الطاولة لم تعد معرّفة على هذا الجهاز.',
    },
  },
  POS_VAL_TABLE_HAS_ITEMS: {
    severity: 'toast',
    retry: false,
    where: 'orders:clearTable',
    sent: false,
    origin: 'app',
    en: {
      title: 'The order has items',
      body: 'Use “Close & Release” to free this table.',
    },
    ar: {
      title: 'الطلب يحتوي أصنافًا',
      body: 'استخدم "إغلاق وتحرير" لتحرير الطاولة.',
    },
  },
  POS_VAL_TABLE_CLEAR_UNVERIFIED: {
    severity: 'toast',
    retry: true,
    where: 'orders:clearTable',
    sent: false,
    origin: 'app',
    en: {
      title: 'The table was left as it is',
      body: 'The order’s items could not be read, so nothing was changed.',
    },
    ar: {
      title: 'لم يتم تغيير الطاولة',
      body: 'تعذرت قراءة أصناف الطلب، فلم يتم تغيير شيء.',
    },
  },
  POS_VAL_ITEM_NOT_FOUND: {
    severity: 'toast',
    retry: false,
    where: 'orders:addLine',
    sent: false,
    origin: 'app',
    en: {
      title: 'Item not found',
      body: 'That item is no longer on the menu. Refresh the catalogue.',
    },
    ar: {
      title: 'الصنف غير موجود',
      body: 'هذا الصنف لم يعد ضمن القائمة. حدّث قائمة الأصناف.',
    },
  },
  POS_VAL_ITEM_NO_PRICE: {
    severity: 'inline',
    retry: false,
    where: 'orders:addLine',
    sent: false,
    origin: 'app',
    en: {
      title: 'No price is set',
      body: '“{name}” has no price, so it cannot be sold. Ask the office to set one.',
    },
    ar: {
      title: 'لا يوجد سعر',
      body: 'الصنف "{name}" بدون سعر ولا يمكن بيعه. اطلب من الإدارة تحديد سعر له.',
    },
  },
  POS_VAL_VARIATION_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders:addLine',
    sent: false,
    origin: 'app',
    en: { title: 'Choose an option', body: 'Pick a size or option for this item.' },
    ar: { title: 'اختر النوع', body: 'اختر الحجم أو النوع لهذا الصنف.' },
  },
  POS_VAL_VARIATION_NO_PRICE: {
    severity: 'inline',
    retry: false,
    where: 'orders:addLine',
    sent: false,
    origin: 'app',
    en: {
      title: 'No price is set',
      body: '“{name} — {variation}” has no price, so it cannot be sold.',
    },
    ar: {
      title: 'لا يوجد سعر',
      body: '"{name} — {variation}" بدون سعر ولا يمكن بيعه.',
    },
  },
  POS_VAL_ADDON_NOT_FOUND: {
    severity: 'inline',
    retry: false,
    where: 'orders:addLine',
    sent: false,
    origin: 'app',
    en: {
      title: 'Add-on not found',
      body: 'One of the selected add-ons no longer exists.',
    },
    ar: {
      title: 'الإضافة غير موجودة',
      body: 'إحدى الإضافات المختارة لم تعد موجودة.',
    },
  },
  POS_VAL_ADDON_UNAVAILABLE: {
    severity: 'inline',
    retry: false,
    where: 'orders:addLine',
    sent: false,
    origin: 'app',
    en: { title: 'Add-on unavailable', body: '“{name}” is not available for this item.' },
    ar: { title: 'الإضافة غير متاحة', body: 'الإضافة "{name}" غير متاحة لهذا الصنف.' },
  },
  POS_VAL_ADDON_GROUP_REQUIRED: {
    severity: 'inline',
    retry: false,
    where: 'orders:addLine',
    sent: false,
    origin: 'app',
    en: { title: 'A choice is needed', body: 'Choose an option for “{group}”.' },
    ar: { title: 'اختيار مطلوب', body: 'اختر خيارًا من "{group}".' },
  },
  POS_VAL_ADDON_GROUP_MAX: {
    severity: 'inline',
    retry: false,
    where: 'orders:addLine',
    sent: false,
    origin: 'app',
    en: { title: 'Too many options', body: 'You can choose up to {max} for “{group}”.' },
    ar: { title: 'خيارات أكثر من اللازم', body: 'يمكنك اختيار {max} كحد أقصى من "{group}".' },
  },
  POS_VAL_QTY: {
    severity: 'inline',
    retry: false,
    where: 'cart:setQty',
    sent: false,
    origin: 'app',
    en: { title: 'Check the quantity', body: 'Quantity must be at least 1.' },
    ar: { title: 'تأكد من الكمية', body: 'يجب أن تكون الكمية 1 على الأقل.' },
  },
  POS_VAL_LINE_NOT_FOUND: {
    severity: 'toast',
    retry: false,
    where: 'orders:updateLine',
    sent: false,
    origin: 'app',
    en: { title: 'Line not found', body: 'That line is no longer on the order.' },
    ar: { title: 'السطر غير موجود', body: 'هذا السطر لم يعد ضمن الطلب.' },
  },
  POS_VAL_LINE_SENT_MODIFY: {
    severity: 'toast',
    retry: false,
    where: 'orders:updateLine',
    sent: false,
    origin: 'app',
    en: {
      title: 'Already sent to the kitchen',
      body: 'This item is with the kitchen and cannot be changed.',
    },
    ar: {
      title: 'أُرسل إلى المطبخ',
      body: 'هذا الصنف أُرسل إلى المطبخ ولا يمكن تعديله.',
    },
  },
  POS_VAL_LINE_SENT_REMOVE: {
    severity: 'toast',
    retry: false,
    where: 'orders:removeLine',
    sent: false,
    origin: 'app',
    en: {
      title: 'Already sent to the kitchen',
      body: 'This item is with the kitchen and cannot be removed.',
    },
    ar: {
      title: 'أُرسل إلى المطبخ',
      body: 'هذا الصنف أُرسل إلى المطبخ ولا يمكن حذفه.',
    },
  },
  POS_VAL_DELIVERY_DISABLED: {
    severity: 'toast',
    retry: false,
    where: 'orders:setType',
    sent: false,
    origin: 'app',
    en: {
      title: 'Delivery is switched off',
      body: 'This branch is not taking delivery orders. Choose pickup or dine-in.',
    },
    ar: {
      title: 'التوصيل غير مفعّل',
      body: 'هذا الفرع لا يستقبل طلبات توصيل. اختر استلام أو صالة.',
    },
  },
  POS_VAL_DELIVERY_FEE_WRONG_TYPE: {
    severity: 'toast',
    retry: false,
    where: 'orders:setDeliveryFee',
    sent: false,
    origin: 'app',
    en: {
      title: 'Delivery orders only',
      body: 'Only a delivery order can carry a delivery charge.',
    },
    ar: {
      title: 'لطلبات التوصيل فقط',
      body: 'رسوم التوصيل تُضاف لطلبات التوصيل فقط.',
    },
  },
  POS_VAL_DELIVERY_FEE_NOT_POSITIVE: {
    severity: 'inline',
    retry: false,
    where: 'orders:setDeliveryFee',
    sent: false,
    origin: 'app',
    en: { title: 'Check the amount', body: 'Enter a delivery charge greater than zero.' },
    ar: { title: 'تأكد من المبلغ', body: 'أدخل رسوم توصيل أكبر من صفر.' },
  },
  POS_VAL_DELIVERY_FEE_TOO_LARGE: {
    severity: 'inline',
    retry: false,
    where: 'orders:setDeliveryFee',
    sent: false,
    origin: 'app',
    en: {
      title: 'The amount looks too large',
      body: 'Check the delivery charge before saving it.',
    },
    ar: {
      title: 'المبلغ يبدو كبيرًا',
      body: 'راجع رسوم التوصيل قبل الحفظ.',
    },
  },

  /* ───────────────────────── printing ──────────────────────────── */
  POS_PRINT_NO_PRINTER: {
    severity: 'toast',
    retry: true,
    where: 'orders:print',
    sent: false,
    origin: 'app',
    en: {
      title: 'No printer found',
      body: 'No printer is installed on this computer. Add one in Windows settings, then try again.',
    },
    ar: {
      title: 'لا توجد طابعة',
      body: 'لا توجد طابعة مثبتة على هذا الجهاز. أضف طابعة من إعدادات ويندوز ثم حاول مرة أخرى.',
    },
  },
  POS_PRINT_ORDER_NOT_LOCAL: {
    severity: 'toast',
    retry: false,
    where: 'orders:print',
    sent: false,
    origin: 'app',
    en: {
      title: 'Cannot reprint here',
      body: 'This order came from the server for lookup only, so its items are not stored on this till.',
    },
    ar: {
      title: 'تعذرت الطباعة هنا',
      body: 'هذا الطلب مسحوب من الخادم للاطلاع فقط، وأصنافه غير محفوظة على هذا الجهاز.',
    },
  },
  POS_PRINT_LOGO_URL_INVALID: {
    severity: 'toast',
    retry: false,
    where: 'print:logo',
    sent: false,
    origin: 'app',
    en: {
      title: 'Logo address is invalid',
      body: 'The logo address from the server is not a valid link or file.',
    },
    ar: {
      title: 'رابط الشعار غير صالح',
      body: 'رابط الشعار المرسل من الخادم غير صالح.',
    },
  },
  POS_PRINT_LOGO_DOWNLOAD_FAILED: {
    severity: 'toast',
    retry: true,
    where: 'print:logo',
    sent: false,
    origin: 'app',
    en: {
      title: 'The logo could not be downloaded',
      body: 'Check the connection and try again.',
    },
    ar: {
      title: 'تعذر تحميل الشعار',
      body: 'تأكد من الاتصال وحاول مرة أخرى.',
    },
  },
  POS_PRINT_LOGO_NOT_CONFIGURED: {
    severity: 'toast',
    retry: false,
    where: 'print:logo',
    sent: false,
    origin: 'app',
    en: {
      title: 'No logo is set',
      body: 'The office has not set a receipt logo yet.',
    },
    ar: {
      title: 'لا يوجد شعار',
      body: 'لم تقم الإدارة بتعيين شعار للفاتورة بعد.',
    },
  },

  /* ──────────────────── device / till state ────────────────────── */
  POS_TILL_LOCKED: {
    severity: 'blocker',
    retry: false,
    where: 'any write (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'The till is locked',
      body: 'Unlock the till before ringing up anything else.',
    },
    ar: {
      title: 'نقطة البيع مقفلة',
      body: 'افتح قفل نقطة البيع قبل متابعة البيع.',
    },
  },
  POS_LOGIN_INVALID: {
    severity: 'inline',
    retry: false,
    where: 'auth:login (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'Sign-in failed',
      body: 'That username or password is not correct.',
    },
    ar: {
      title: 'تعذر تسجيل الدخول',
      body: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
    },
  },
  POS_CFG_BASE_URL_MISSING: {
    severity: 'blocker',
    retry: false,
    where: 'sync (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'Server address is missing',
      body: 'No server address is saved on this till. Add it in Settings.',
    },
    ar: {
      title: 'عنوان الخادم غير موجود',
      body: 'لا يوجد عنوان خادم محفوظ على هذا الجهاز. أضفه من الإعدادات.',
    },
  },
  POS_CFG_API_NOT_READY: {
    severity: 'info',
    retry: true,
    where: 'sync (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'Not connected yet',
      body: 'The till is still connecting to the server. Try again in a moment.',
    },
    ar: {
      title: 'لم يكتمل الاتصال',
      body: 'الجهاز ما زال يتصل بالخادم. حاول بعد لحظات.',
    },
  },
  POS_CFG_SETTINGS_NOT_READY: {
    severity: 'info',
    retry: true,
    where: 'settings (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'Still loading',
      body: 'Settings are still loading. Try again in a moment.',
    },
    ar: {
      title: 'جارٍ التحميل',
      body: 'الإعدادات ما زالت قيد التحميل. حاول بعد لحظات.',
    },
  },
  POS_DB_WRITE_FAILED: {
    severity: 'toast',
    retry: true,
    where: 'local database (app)',
    sent: false,
    origin: 'app',
    en: {
      title: 'Could not save',
      body: 'This till could not save the change. Try again.',
    },
    ar: {
      title: 'تعذر الحفظ',
      body: 'تعذر حفظ التغيير على هذا الجهاز. حاول مرة أخرى.',
    },
  },
  // The catch-all. An unmapped error is a bug to fix in the next build, never
  // a raw string to put in front of a cashier — the original text goes to the
  // log and behind the "technical details" disclosure, nowhere else.
  POS_UNKNOWN: {
    severity: 'toast',
    retry: true,
    where: '*',
    sent: false,
    origin: 'app',
    en: {
      title: 'Something went wrong',
      body: 'The action did not go through. Try again.',
    },
    ar: {
      title: 'حدث خطأ ما',
      body: 'لم تكتمل العملية. حاول مرة أخرى.',
    },
  },

  /* ─────────────────────── confirmations ───────────────────────── */
  POS_OK_ORDER_PLACED: {
    severity: 'info',
    retry: false,
    where: 'orders.complete',
    http: 200,
    sent: false,
    origin: 'server',
    en: { title: 'Order recorded', body: 'Order number {reference}' },
    ar: { title: 'تم تسجيل الطلب', body: 'رقم الطلب {reference}' },
  },
  POS_OK_PROMO_APPLIED: {
    severity: 'info',
    retry: false,
    where: 'POST /promos/validate',
    http: 200,
    sent: false,
    origin: 'server',
    en: { title: 'Promo code applied', body: 'Discount {discount_total} KWD' },
    ar: { title: 'تم استخدام كوبون الخصم', body: 'الخصم {discount_total} د.ك' },
  },
} as const satisfies Record<string, CatalogEntry>;

export type PosErrorCode = keyof typeof ERROR_CATALOG;

/** Fill {placeholders}. Unknown keys are left alone rather than blanked. */
export function interpolate(
  template: string,
  params?: Record<string, unknown>
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key] ?? '') : whole
  );
}
