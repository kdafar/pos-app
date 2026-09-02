// src/renderer/i18n/strings.cart.ts
// Owned by the cart surface. Add keys here — NOT in strings.ts — so parallel
// work on other surfaces cannot clobber this file.
//
// Arabic is Kuwaiti restaurant floor vocabulary, not literal MSA: a cashier
// says "تفريغ السلة" and "تحرير الطاولة", never "إخلاء عربة التسوق".
// Order-type words (توصيل / استلام / داخل المطعم) live in strings.ts and are
// reached through useOrderTypeLabel(), never re-spelled here.
export const cartStrings = {
  /* ---------- shared toast tails ---------- */
  'common.checkLogs': {
    en: 'Please check the logs for details or contact support.',
    ar: 'الرجاء مراجعة السجلات أو التواصل مع الدعم الفني.',
  },
  'common.checkConn': {
    en: 'Please check connection/logs or contact support.',
    ar: 'الرجاء التحقق من الاتصال أو مراجعة السجلات أو التواصل مع الدعم الفني.',
  },

  /* ---------- order side header ---------- */
  'cart.orderNumber': { en: 'Order Number', ar: 'رقم الطلب' },
  'cart.noActiveOrder': { en: 'No active order', ar: 'لا يوجد طلب مفتوح' },
  'cart.createOrder': { en: 'Create New Order', ar: 'إنشاء طلب جديد' },
  'cart.emptyHint': {
    en: 'Add items to get started',
    ar: 'أضف أصناف للبدء',
  },
  'cart.lockedBadge': {
    en: 'Main order locked (printed)',
    ar: 'الطلب الرئيسي مقفل (تمت طباعته)',
  },
  'cart.pendingOne': {
    en: '1 new item pending',
    ar: 'صنف جديد بانتظار الطباعة',
  },
  'cart.pendingMany': {
    en: '{n} new items pending',
    ar: '{n} أصناف جديدة بانتظار الطباعة',
  },

  /* ---------- clear cart ---------- */
  'cart.clearCart': { en: 'Clear cart', ar: 'تفريغ السلة' },
  'cart.clearTitle': { en: 'Clear entire cart?', ar: 'تفريغ السلة بالكامل؟' },
  'cart.clearBodyBefore': { en: 'This will remove', ar: 'سيتم حذف' },
  'cart.clearBodyAllItems': { en: 'all items', ar: 'جميع الأصناف' },
  'cart.clearBodyAfter': { en: 'from this order.', ar: 'من هذا الطلب.' },
  'cart.clearUndo': {
    en: 'This action cannot be undone.',
    ar: 'لا يمكن التراجع عن هذه العملية.',
  },
  'cart.cleared': { en: 'Cart cleared', ar: 'تم تفريغ السلة' },
  'cart.clearedMsg': {
    en: 'All items have been removed from this order.',
    ar: 'تم حذف جميع الأصناف من هذا الطلب.',
  },
  'cart.clearFailed': { en: 'Could not clear cart', ar: 'تعذر تفريغ السلة' },

  /* ---------- close / release ---------- */
  'cart.updatePay': { en: 'Update / Pay', ar: 'تحديث / دفع' },
  'cart.closeRelease': {
    en: 'Close & Release',
    ar: 'إغلاق وتحرير الطاولة',
  },
  'cart.tipRelease': {
    en: 'Finish and release table',
    ar: 'إنهاء الطلب وتحرير الطاولة',
  },
  'cart.tipCancel': { en: 'Cancel this order', ar: 'إلغاء هذا الطلب' },
  'cart.tipDeleteEmpty': {
    en: 'Delete this empty order',
    ar: 'حذف هذا الطلب الفارغ',
  },
  'cart.releaseConfirm': {
    en: 'Are you sure you want to release this table and finish the order?',
    ar: 'هل تريد تحرير الطاولة وإنهاء الطلب؟',
  },
  'cart.releaseFailed': {
    en: 'Failed to release table',
    ar: 'تعذر تحرير الطاولة',
  },
  'cart.needAddress': {
    en: 'Please enter the delivery address (State, City, Block) from "Place Order" before closing this delivery order.',
    ar: 'الرجاء إدخال عنوان التوصيل (المحافظة، المنطقة، القطعة) من شاشة "تأكيد الطلب" قبل إغلاق طلب التوصيل.',
  },
  'cart.needTable': {
    en: 'Please assign a table before closing this dine-in order.',
    ar: 'الرجاء تحديد الطاولة قبل إغلاق طلب داخل المطعم.',
  },

  /* ---------- checkout modal ---------- */
  'checkout.title': { en: 'Complete Order', ar: 'إتمام الطلب' },
  'checkout.quickMode': { en: 'Quick Mode', ar: 'الوضع السريع' },
  'checkout.quickModeOn': {
    en: 'Quick Mode ON',
    ar: 'الوضع السريع مفعّل',
  },
  'checkout.mobileLookup': {
    en: 'Mobile Number (Customer Lookup)',
    ar: 'رقم الموبايل (البحث عن العميل)',
  },
  'checkout.mobilePlaceholder': {
    en: 'Enter mobile to find customer',
    ar: 'أدخل رقم الموبايل للبحث عن العميل',
  },
  'checkout.searching': { en: 'Searching...', ar: '...جارٍ البحث' },
  'checkout.found': { en: 'Found:', ar: 'تم العثور على:' },
  'checkout.customerName': { en: 'Customer Name', ar: 'اسم العميل' },
  'checkout.fullNamePlaceholder': { en: 'Full name', ar: 'الاسم الكامل' },
  'checkout.email': { en: 'Email', ar: 'البريد الإلكتروني' },
  'checkout.state': { en: 'State', ar: 'المحافظة' },
  'checkout.city': { en: 'City', ar: 'المنطقة' },
  'checkout.streetPlaceholder': { en: 'Street name', ar: 'اسم الشارع' },
  'checkout.buildingPlaceholder': { en: 'Building no.', ar: 'رقم المبنى' },
  'checkout.floorPlaceholder': { en: 'Floor number', ar: 'رقم الدور' },
  'checkout.fullAddress': { en: 'Full Address', ar: 'العنوان بالتفصيل' },
  'checkout.addressPlaceholder': {
    en: 'Complete address (optional)',
    ar: 'العنوان بالتفصيل (اختياري)',
  },
  'checkout.notes': { en: 'Order Notes', ar: 'ملاحظات الطلب' },
  'checkout.notesPlaceholder': {
    en: 'Special instructions…',
    ar: '...تعليمات خاصة',
  },
  'checkout.minOrder': {
    en: 'Min order for {city}:',
    ar: 'الحد الأدنى للطلب في {city}:',
  },
  'checkout.errGeo': {
    en: 'Please select state, city and block for delivery.',
    ar: 'الرجاء اختيار المحافظة والمنطقة والقطعة للتوصيل.',
  },
  'checkout.errAddress': {
    en: 'Delivery address is required.',
    ar: 'عنوان التوصيل مطلوب.',
  },
  'checkout.errPayment': {
    en: 'Please select a payment method.',
    ar: 'الرجاء اختيار طريقة الدفع.',
  },
  /* ---------- cash received / change (branch.show_change_on_receipt) ---------- */
  'checkout.cashReceived': {
    en: 'Cash received',
    ar: 'المبلغ المدفوع',
  },
  'checkout.change': { en: 'Change', ar: 'الباقي' },
  'checkout.rounding': { en: 'Rounding', ar: 'التقريب' },
  // Shown under the field when the cashier types less than the bill. Not an
  // error: the sale is fine, the tender simply is not recorded.
  'checkout.cashShort': {
    en: 'Less than the total — will not be printed',
    ar: 'أقل من الإجمالي — لن يتم طباعته',
  },
  // Kuwait has no 1 or 2 fils coin, so a tender must land on 5 fils.
  'checkout.cashNotCoin': {
    en: 'Round to the nearest 5 fils',
    ar: 'يجب أن يكون من مضاعفات 5 فلوس',
  },
  'checkout.cashExact': { en: 'Exact', ar: 'المبلغ بالضبط' },
  'checkout.payLinkNoUrl': {
    en: 'Payment link created but no URL returned from server',
    ar: 'تم إنشاء رابط الدفع لكن لم يصل أي رابط من الخادم',
  },
  'checkout.payLinkFailed': {
    en: 'Could not create payment link',
    ar: 'تعذر إنشاء رابط الدفع',
  },
  'checkout.completeFailed': {
    en: 'Failed to complete order',
    ar: 'تعذر إتمام الطلب',
  },
  'checkout.completeFailedMsg': {
    en: 'Failed to complete order. Please try again.',
    ar: 'تعذر إتمام الطلب. الرجاء المحاولة مرة أخرى.',
  },

  /* ---------- promo ---------- */
  'promo.short': { en: 'Promo', ar: 'خصم' },
  'promo.title': { en: 'Apply Promo Code', ar: 'تطبيق كود الخصم' },
  'promo.placeholder': { en: 'Enter promo code', ar: 'أدخل كود الخصم' },
  'promo.applyCode': { en: 'Apply Code', ar: 'تطبيق الكود' },
  'promo.invalid': {
    en: 'Invalid or inactive promo code.',
    ar: 'كود الخصم غير صحيح أو غير مفعّل.',
  },
  'promo.applyFailed': {
    en: 'Could not apply this code.',
    ar: 'تعذر تطبيق هذا الكود.',
  },
  'promo.available': {
    en: 'Available Promo Codes:',
    ar: 'أكواد الخصم المتاحة:',
  },
  'promo.percentOff': { en: '{value}% off', ar: 'خصم {value}%' },
  'promo.amountOff': { en: '{value} KWD off', ar: 'خصم {value} د.ك' },
  'promo.min': { en: 'Min', ar: 'الحد الأدنى' },

  /* ---------- tables ---------- */
  'tables.assign': { en: 'Assign Table', ar: 'تحديد الطاولة' },
  'tables.assignFailed': {
    en: 'Could not assign table',
    ar: 'تعذر تحديد الطاولة',
  },
  'tables.available': { en: 'Available', ar: 'متاحة' },
  'tables.reserved': { en: 'Reserved', ar: 'محجوزة' },
  'tables.occupied': { en: 'Occupied', ar: 'مشغولة' },
  'tables.covers': { en: 'Covers', ar: 'عدد الأشخاص' },
  'tables.refresh': { en: 'Refresh', ar: 'تحديث' },
  'tables.none': { en: 'No tables found.', ar: 'لا توجد طاولات.' },
  'tables.notAssigned': {
    en: 'No table selected',
    ar: 'لم يتم اختيار طاولة',
  },
  'tables.tip': {
    en: 'Tip: The blue card is the table currently assigned to this order. You can tap it to keep it and close this dialog.',
    ar: 'ملاحظة: البطاقة الزرقاء هي الطاولة المخصصة لهذا الطلب حالياً. اضغط عليها للإبقاء عليها وإغلاق النافذة.',
  },
  'tables.seats': { en: 'Seats', ar: 'المقاعد' },
  'tables.seatsTitle': {
    en: '{name} • {seats} seats',
    ar: '{name} • {seats} مقعد',
  },
  'tables.currentlyAssigned': {
    en: 'Currently assigned to this order',
    ar: 'مخصصة لهذا الطلب حالياً',
  },
  'cart.releaseConfirmTitle': { en: 'Release this table?', ar: 'تحرير الطاولة؟' },
  'cart.releaseTable': { en: 'Release table', ar: 'تحرير الطاولة' },
  'pay.title': { en: 'Payment link', ar: 'رابط الدفع' },
  'pay.scanHint': {
    en: 'Ask the customer to scan this with their phone camera.',
    ar: 'اطلب من العميل مسح الرمز بكاميرا هاتفه.',
  },
  'pay.qrAlt': { en: 'Payment link QR code', ar: 'رمز الاستجابة السريعة للدفع' },
  'pay.copy': { en: 'Copy link', ar: 'نسخ الرابط' },
  'pay.copied': { en: 'Copied', ar: 'تم النسخ' },
  'pay.whatsapp': { en: 'WhatsApp', ar: 'واتساب' },
  'pay.needMobile': {
    en: 'Add the customer mobile number to send by WhatsApp',
    ar: 'أضف رقم موبايل العميل للإرسال عبر واتساب',
  },
  'pay.waMessage': {
    en: 'Your payment link for {amount} KD:',
    ar: 'رابط الدفع الخاص بك بمبلغ {amount} د.ك:',
  },
  'pay.checkStatus': { en: 'Check payment status', ar: 'تحقق من حالة الدفع' },
  'pay.paid': { en: 'Paid', ar: 'تم الدفع' },
  'pay.failed': { en: 'Payment failed', ar: 'فشل الدفع' },
  'pay.awaiting': { en: 'Awaiting payment', ar: 'بانتظار الدفع' },
  'pay.expired': { en: 'Link expired', ar: 'انتهت صلاحية الرابط' },
  // "Collected", not "Paid": a closed counter sale means the till took the
  // money, which is not the same claim as a payment provider confirming it.
  'pay.collected': { en: 'Collected', ar: 'تم التحصيل' },
  'pay.unpaid': { en: 'Unpaid', ar: 'غير مدفوع' },
} as const;
