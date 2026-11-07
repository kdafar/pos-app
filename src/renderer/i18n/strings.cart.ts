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
  // This button finishes the sale (prints if never printed, then closes). It
  // said "Cancel this order", which is the opposite of what it does.
  'cart.tipClose': { en: 'Finish and close this order', ar: 'إنهاء الطلب وإغلاقه' },
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
  /* ---------- manager approval ---------- */
  'approval.title': { en: 'Manager approval', ar: 'موافقة المدير' },
  'approval.code': { en: 'Approval code', ar: 'رمز الموافقة' },
  'approval.codeHint': {
    en: 'A manager types their 6-digit code or scans their manager card.',
    ar: 'يُدخل المدير رمزه المكوّن من 6 أرقام أو يمسح بطاقة المدير.',
  },
  'approval.reasonLabel': { en: 'Reason', ar: 'السبب' },
  'approval.reasonPlaceholder': { en: 'Optional', ar: 'اختياري' },
  'approval.approve': { en: 'Approve', ar: 'موافقة' },
  'approval.action.void_sent_line': {
    en: 'Remove or reduce an item already sent to the kitchen',
    ar: 'حذف أو تقليل صنف أُرسل إلى المطبخ',
  },
  'approval.action.force_close_table': {
    en: 'Free a table that still has an open order',
    ar: 'تحرير طاولة عليها طلب مفتوح',
  },
  'approval.action.cancel_sent_order': {
    en: 'Cancel an order already sent to the kitchen',
    ar: 'إلغاء طلب أُرسل إلى المطبخ',
  },
  'approval.action.mark_unpaid': {
    en: 'Undo a payment',
    ar: 'إلغاء دفع',
  },
  'approval.reason.wrongItem': { en: 'Wrong item', ar: 'صنف خاطئ' },
  'approval.reason.changedMind': { en: 'Customer changed their mind', ar: 'غيّر العميل رأيه' },
  'approval.reason.customerLeft': { en: 'Customer left', ar: 'غادر العميل' },

  'cart.roundSent': {
    en: 'Order updated',
    ar: 'تم تحديث الطلب',
  },
  'cart.roundFailed': {
    en: 'Could not update the order',
    ar: 'تعذر تحديث الطلب',
  },
  'cart.closeFailed': {
    en: 'Could not close the order',
    ar: 'تعذر إغلاق الطلب',
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
  'checkout.splitCash': { en: 'Pay part in cash', ar: 'دفع جزء نقداً' },
  'checkout.splitCashPart': { en: 'Cash part', ar: 'الجزء النقدي' },
  'checkout.splitOtherPart': { en: 'Rest by {method}', ar: 'الباقي عبر {method}' },
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
  'tables.floor': { en: 'Floor', ar: 'الطابق' },
  'tables.allFloors': { en: 'All', ar: 'الكل' },
  'tables.noFloor': { en: 'Other', ar: 'أخرى' },
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

  // Mark order paid — copy from the contract (§12), verbatim.
  'paid.mark': { en: 'Mark paid', ar: 'تسجيل كمدفوع' },
  'paid.confirmTitle': { en: 'Mark this order paid?', ar: 'تسجيل هذا الطلب كمدفوع؟' },
  'paid.confirmBody': {
    en: '{amount} by {method}. Only confirm once the money is in hand.',
    ar: '{amount} عن طريق {method}. أكّد فقط بعد استلام المبلغ.',
  },
  'paid.badgeHand': { en: 'Paid · {method} · {name}', ar: 'مدفوع · {method} · {name}' },
  'paid.badgeGateway': { en: 'Paid', ar: 'مدفوع' },
  'paid.badgeQueued': { en: 'Paid (waiting to send)', ar: 'مدفوع (بانتظار الإرسال)' },
  'paid.undo': { en: 'Undo paid', ar: 'إلغاء الدفع' },
  'paid.undoConfirm': {
    en: 'Remove the paid mark from this order?',
    ar: 'إزالة علامة الدفع عن هذا الطلب؟',
  },
  'paid.reason': { en: 'Reason', ar: 'السبب' },
  'paid.linkWarning': {
    en: "This order's payment link is still open. The customer could still pay it.",
    ar: 'رابط الدفع لهذا الطلب ما زال مفتوحاً. قد يدفعه العميل.',
  },
  // Till-side wording, not in the contract.
  'paid.method': { en: 'Paid by', ar: 'طريقة الدفع' },
  'paid.methodLocked': {
    en: 'This order is closed, so it is paid with the method it was closed with.',
    ar: 'هذا الطلب مغلق، لذا يُسجَّل بطريقة الدفع التي أُغلق بها.',
  },
  'paid.note': { en: 'Note (optional)', ar: 'ملاحظة (اختياري)' },
  'paid.reference': { en: 'KNET slip reference', ar: 'رقم مرجع إيصال كي نت' },
  'paid.referenceHint': {
    en: 'The reference printed on the card machine slip.',
    ar: 'رقم المرجع المطبوع على إيصال جهاز البطاقات.',
  },
  'paid.referenceShown': { en: 'Reference: {ref}', ar: 'المرجع: {ref}' },
  'paid.at': { en: 'Paid at {time}', ar: 'دُفع في {time}' },
  'paid.refusedTitle': { en: 'Payment mark was refused', ar: 'تم رفض تسجيل الدفع' },
  'paid.markFailed': { en: 'Could not mark the order paid', ar: 'تعذّر تسجيل الطلب كمدفوع' },
  'paid.undoFailed': { en: 'Could not undo the payment', ar: 'تعذّر إلغاء الدفع' },
  'paid.queuedToast': {
    en: 'Saved on this till. It will be sent when the connection is back.',
    ar: 'تم الحفظ على نقطة البيع. سيُرسل عند عودة الاتصال.',
  },
  'paid.doneToast': { en: 'Order marked paid', ar: 'تم تسجيل الطلب كمدفوع' },
  'paid.undoneToast': { en: 'Paid mark removed', ar: 'تمت إزالة علامة الدفع' },
} as const;
