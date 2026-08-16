// src/renderer/i18n/strings.ts
//
// Kuwait Arabic (ar-KW). Conventions used throughout:
//  - Latin numerals (0123), not Arabic-Indic — standard on Kuwaiti receipts.
//  - Currency د.ك, three decimals.
//  - Order type / status wording is taken verbatim from the backend
//    (docs/BACKEND-QUESTIONS.md §3.4) so the till and the admin dashboard
//    never describe the same order differently.

export type Lang = 'en' | 'ar';

export const LANGS: { code: Lang; label: string; dir: 'ltr' | 'rtl' }[] = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
];

import { cartStrings } from './strings.cart';
import { authStrings } from './strings.auth';
import { navStrings } from './strings.nav';
import { adminStrings } from './strings.admin';

const coreStrings = {
  /* ---------- generic ---------- */
  'common.all': { en: 'All', ar: 'الكل' },
  'common.add': { en: 'Add', ar: 'إضافة' },
  'common.cancel': { en: 'Cancel', ar: 'إلغاء' },
  'common.close': { en: 'Close', ar: 'إغلاق' },
  'common.save': { en: 'Save', ar: 'حفظ' },
  'common.remove': { en: 'Remove', ar: 'حذف' },
  'common.search': { en: 'Search', ar: 'بحث' },
  'common.loading': { en: 'Loading…', ar: '...جارٍ التحميل' },
  'common.qty': { en: 'Qty', ar: 'الكمية' },
  'common.total': { en: 'Total', ar: 'الإجمالي' },
  'common.each': { en: 'Each', ar: 'للحبة' },
  'common.required': { en: 'Required', ar: 'مطلوب' },
  'common.optional': { en: 'Optional', ar: 'اختياري' },
  'common.retry': { en: 'Try again', ar: 'إعادة المحاولة' },
  'common.currency': { en: 'KWD', ar: 'د.ك' },

  /* ---------- order types ---------- */
  'orderType.delivery': { en: 'Delivery', ar: 'توصيل' },
  'orderType.pickup': { en: 'Pickup', ar: 'استلام' },
  'orderType.dinein': { en: 'Dine-in', ar: 'داخل المطعم' },
  'orderType.order': { en: 'Order', ar: 'طلب' },

  /* ---------- order status ---------- */
  'status.open': { en: 'Open', ar: 'مفتوح' },
  'status.placed': { en: 'Placed', ar: 'تم الطلب' },
  'status.prepared': { en: 'Prepared', ar: 'جاهز' },
  'status.ready': { en: 'Ready', ar: 'جاهز للتسليم' },
  'status.closed': { en: 'Closed', ar: 'مغلق' },
  'status.completed': { en: 'Completed', ar: 'مكتمل' },
  'status.cancelled': { en: 'Cancelled', ar: 'ملغي' },
  'status.pending': { en: 'Pending', ar: 'قيد الانتظار' },
  'status.unknown': { en: 'Unknown', ar: 'غير معروف' },

  /* ---------- POS header / orders bar ---------- */
  'pos.new': { en: 'NEW', ar: 'جديد' },
  'pos.signedInAs': { en: 'Signed in as', ar: 'تسجيل الدخول باسم' },
  'pos.operator': { en: 'Operator', ar: 'الكاشير' },
  'pos.noItems': { en: 'No items found', ar: 'لا توجد أصناف' },
  'pos.searchPlaceholder': {
    en: 'Search items, barcode, or Arabic name…',
    ar: '...ابحث بالاسم أو الباركود',
  },
  'pos.categories': { en: 'All Categories', ar: 'كل الأقسام' },
  'pos.outOfStock': { en: 'Out of Stock', ar: 'غير متوفر' },
  'pos.from': { en: 'from', ar: 'يبدأ من' },
  'pos.addons': { en: 'Add-ons', ar: 'الإضافات' },
  'pos.sizes': { en: 'Sizes', ar: 'الأحجام' },
  'pos.options': { en: 'Options', ar: 'الخيارات' },
  'pos.showingOf': {
    en: 'Showing {shown} of {total} items — narrow the search.',
    ar: 'عرض {shown} من {total} صنف — الرجاء تضييق البحث.',
  },

  /* ---------- item options modal ---------- */
  'opts.title': { en: 'Customize your order', ar: 'خيارات الصنف' },
  'opts.basePrice': { en: 'Base price', ar: 'السعر الأساسي' },
  'opts.variation': { en: 'Size / Variation', ar: 'الحجم' },
  'opts.chooseOne': { en: 'Choose 1', ar: 'اختر واحد' },
  'opts.maxChoices': { en: 'Max {n}', ar: 'حد أقصى {n}' },
  'opts.selected': { en: '{n} selected', ar: 'تم اختيار {n}' },
  'opts.tapToAdd': { en: 'Tap to add', ar: 'اضغط للإضافة' },
  'opts.none': {
    en: 'No options configured for this item.',
    ar: 'لا توجد خيارات لهذا الصنف.',
  },
  'opts.addToOrder': { en: 'Add to order', ar: 'إضافة للطلب' },
  'opts.lineTotal': { en: 'Line total', ar: 'إجمالي السطر' },
  'opts.pickVariation': {
    en: 'Please choose a size for this item.',
    ar: 'الرجاء اختيار الحجم لهذا الصنف.',
  },
  'opts.pickRequired': {
    en: 'Please select an option for "{group}".',
    ar: 'الرجاء اختيار خيار من "{group}".',
  },
  'opts.tooMany': {
    en: 'You can select up to {n} options for "{group}".',
    ar: 'يمكنك اختيار {n} كحد أقصى من "{group}".',
  },
  'opts.loadFailed': {
    en: 'Failed to load options for this item.',
    ar: 'تعذر تحميل خيارات هذا الصنف.',
  },

  /* ---------- order side / cart ---------- */
  'cart.title': { en: 'Current Order', ar: 'الطلب الحالي' },
  'cart.empty': { en: 'No items yet', ar: 'لا توجد أصناف بعد' },
  'cart.subtotal': { en: 'Subtotal', ar: 'المجموع' },
  'cart.discount': { en: 'Discount', ar: 'الخصم' },
  'cart.deliveryFee': { en: 'Delivery fee', ar: 'رسوم التوصيل' },
  'cart.grandTotal': { en: 'Grand total', ar: 'المبلغ الإجمالي' },
  'cart.placeOrder': { en: 'Place order', ar: 'تأكيد الطلب' },
  'cart.closeOrder': { en: 'Close order', ar: 'إغلاق الطلب' },
  'cart.print': { en: 'Print', ar: 'طباعة' },
  'cart.removeHint': { en: 'Use the trash to remove', ar: 'استخدم سلة الحذف' },
  'cart.note': { en: 'Note', ar: 'ملاحظة' },

  /* ---------- customer / checkout ---------- */
  'cust.customer': { en: 'Customer', ar: 'العميل' },
  'cust.name': { en: 'Name', ar: 'الاسم' },
  'cust.mobile': { en: 'Mobile', ar: 'رقم الموبايل' },
  'cust.address': { en: 'Address', ar: 'العنوان' },
  'cust.governorate': { en: 'Governorate', ar: 'المحافظة' },
  'cust.area': { en: 'Area', ar: 'المنطقة' },
  'cust.block': { en: 'Block', ar: 'قطعة' },
  'cust.street': { en: 'Street', ar: 'شارع' },
  'cust.building': { en: 'Building', ar: 'مبنى' },
  'cust.floor': { en: 'Floor', ar: 'الدور' },
  'cust.table': { en: 'Table', ar: 'الطاولة' },
  'cust.paymentMethod': { en: 'Payment method', ar: 'طريقة الدفع' },

  /* ---------- barcode / toasts ---------- */
  'scan.unknown': { en: 'Unknown barcode', ar: 'باركود غير معروف' },
  'scan.noMatch': {
    en: 'No product matches "{code}".',
    ar: 'لا يوجد صنف مطابق للباركود "{code}".',
  },
  'scan.failed': { en: 'Scan failed', ar: 'فشل المسح' },
  'toast.outOfStock': {
    en: '{name} is marked out of stock.',
    ar: 'الصنف {name} غير متوفر حالياً.',
  },
  'toast.addFailed': { en: 'Could not add this item', ar: 'تعذر إضافة الصنف' },

  /* ---------- auth ---------- */
  'auth.login': { en: 'Sign in', ar: 'تسجيل الدخول' },
  'auth.logout': { en: 'Sign out', ar: 'تسجيل الخروج' },
  'auth.password': { en: 'Password', ar: 'كلمة المرور' },
  'auth.emailOrUser': { en: 'Email or username', ar: 'البريد أو اسم المستخدم' },
  'auth.branch': { en: 'Branch', ar: 'الفرع' },
  'auth.pairDevice': { en: 'Pair device', ar: 'ربط الجهاز' },
  'auth.unpair': { en: 'Unpair / Reset', ar: 'إلغاء الربط' },
  'auth.goToLogin': { en: 'Go to login', ar: 'الذهاب لتسجيل الدخول' },

  /* ---------- nav ---------- */
  'nav.pos': { en: 'POS', ar: 'نقطة البيع' },
  'nav.orders': { en: 'Orders', ar: 'الطلبات' },
  'nav.items': { en: 'Items', ar: 'الأصناف' },
  'nav.categories': { en: 'Categories', ar: 'الأقسام' },
  'nav.addons': { en: 'Add-ons', ar: 'الإضافات' },
  'nav.promos': { en: 'Promos', ar: 'العروض' },
  'nav.tables': { en: 'Tables', ar: 'الطاولات' },
  'nav.reports': { en: 'Reports', ar: 'التقارير' },
  'nav.settings': { en: 'Settings', ar: 'الإعدادات' },
  'nav.language': { en: 'Language', ar: 'اللغة' },
  'nav.sync': { en: 'Sync now', ar: 'مزامنة الآن' },
} as const;

/** Merged catalogue. Each surface owns its own file to keep edits conflict-free. */
export const strings = {
  ...coreStrings,
  ...cartStrings,
  ...authStrings,
  ...navStrings,
  ...adminStrings,
};

export type StringKey = keyof typeof strings;
