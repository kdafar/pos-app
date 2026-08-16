// src/renderer/i18n/strings.admin.ts
// Owned by the admin surface. Add keys here — NOT in strings.ts — so parallel
// work on other surfaces cannot clobber this file.
//
// Kuwaiti/Gulf back-office wording. Latin numerals everywhere (prices, counts,
// page numbers) — only the words flip. Server order-status wording (admin.srv.*)
// is copied verbatim from the backend enum (docs/BACKEND-QUESTIONS.md §3.4) so
// the till, the dashboard and the customer app never disagree about an order.
export const adminStrings = {
  /* ---------- shared admin chrome ---------- */
  'admin.refresh': { en: 'Refresh', ar: 'تحديث' },
  'admin.refreshing': { en: 'Refreshing…', ar: '...جارٍ التحديث' },
  'admin.rows': { en: 'Rows', ar: 'الصفوف' },
  'admin.rowsPerPage': { en: 'Rows per page', ar: 'عدد الصفوف بالصفحة' },
  'admin.readOnly': { en: 'Read-only', ar: 'للعرض فقط' },
  'admin.noData': { en: 'No data', ar: 'لا توجد بيانات' },
  'admin.pageOf': {
    en: 'Page {page} of {pages}',
    ar: 'صفحة {page} من {pages}',
  },
  'admin.first': { en: 'First', ar: 'الأولى' },
  'admin.prev': { en: 'Prev', ar: 'السابق' },
  'admin.next': { en: 'Next', ar: 'التالي' },
  'admin.last': { en: 'Last', ar: 'الأخيرة' },
  'admin.firstPage': { en: 'First page', ar: 'الصفحة الأولى' },
  'admin.prevPage': { en: 'Previous page', ar: 'الصفحة السابقة' },
  'admin.nextPage': { en: 'Next page', ar: 'الصفحة التالية' },
  'admin.lastPage': { en: 'Last page', ar: 'الصفحة الأخيرة' },
  'admin.yes': { en: 'Yes', ar: 'نعم' },
  'admin.no': { en: 'No', ar: 'لا' },
  'admin.active': { en: 'Active', ar: 'مفعّل' },
  'admin.enabled': { en: 'Enabled', ar: 'مفعّل' },
  'admin.disabled': { en: 'Disabled', ar: 'موقوف' },
  'admin.enabledOnly': { en: 'Enabled only', ar: 'المفعّل فقط' },
  'admin.disabledOnly': { en: 'Disabled only', ar: 'الموقوف فقط' },
  'admin.name': { en: 'Name', ar: 'الاسم' },
  'admin.nameEn': { en: 'Name (EN)', ar: 'الاسم بالإنجليزي' },
  'admin.nameAr': { en: 'Name (AR)', ar: 'الاسم بالعربي' },
  'admin.status': { en: 'Status', ar: 'الحالة' },
  'admin.type': { en: 'Type', ar: 'النوع' },
  'admin.actions': { en: 'Actions', ar: 'إجراءات' },
  'admin.supportHint': {
    en: 'Please check the logs for details or contact support.',
    ar: 'راجع السجلات أو تواصل مع الدعم الفني.',
  },

  /* ---------- Items ---------- */
  'admin.items.title': { en: 'Items', ar: 'الأصناف' },
  'admin.items.searchPlaceholder': {
    en: 'Search items…',
    ar: '...ابحث عن صنف',
  },
  'admin.items.colBarcode': { en: 'Barcode', ar: 'الباركود' },
  'admin.items.colPrice': { en: 'Price', ar: 'السعر' },
  'admin.items.colStock': { en: 'Stock', ar: 'التوفر' },
  'admin.items.inStock': { en: 'In Stock', ar: 'متوفر' },
  'admin.items.outOfStock': { en: 'Out of Stock', ar: 'غير متوفر' },
  'admin.items.count': { en: '{n} items', ar: '{n} صنف' },

  /* ---------- Categories ---------- */
  'admin.cats.title': { en: 'Categories', ar: 'الأقسام' },
  'admin.cats.searchPlaceholder': {
    en: 'Search categories (EN/AR)…',
    ar: '...ابحث في الأقسام',
  },
  'admin.cats.visible': { en: 'Visible', ar: 'ظاهر' },
  'admin.cats.visibleOnly': { en: 'Visible only', ar: 'الظاهر فقط' },
  'admin.cats.hiddenOnly': { en: 'Hidden only', ar: 'المخفي فقط' },
  'admin.cats.none': {
    en: 'No categories match your search/filters.',
    ar: 'لا توجد أقسام مطابقة للبحث أو الفلاتر.',
  },
  'admin.cats.clickHint': {
    en: 'Click to view subcategories',
    ar: 'اضغط لعرض الأقسام الفرعية',
  },
  'admin.cats.selected': { en: 'Selected', ar: 'المحدد' },
  'admin.cats.noneSelected': {
    en: 'No category selected',
    ar: 'لم يتم تحديد قسم',
  },
  'admin.cats.showAllSubs': {
    en: 'Show all subcategories',
    ar: 'عرض كل الأقسام الفرعية',
  },
  'admin.subs.title': { en: 'Subcategories', ar: 'الأقسام الفرعية' },
  'admin.subs.all': { en: '(All)', ar: '(الكل)' },
  'admin.subs.searchPlaceholder': {
    en: 'Search subcategories (EN/AR)…',
    ar: '...ابحث في الأقسام الفرعية',
  },
  'admin.subs.none': {
    en: 'No subcategories match your search/filters.',
    ar: 'لا توجد أقسام فرعية مطابقة للبحث أو الفلاتر.',
  },
  'admin.subs.category': { en: 'Category', ar: 'القسم' },
  'admin.subs.count': { en: '{n} subcategories', ar: '{n} قسم فرعي' },

  /* ---------- Add-ons ---------- */
  'admin.addons.itemsTitle': {
    en: 'Items with Addons',
    ar: 'الأصناف اللي عليها إضافات',
  },
  'admin.addons.searchItems': {
    en: 'Search items (EN/AR)…',
    ar: '...ابحث عن صنف',
  },
  'admin.addons.loadingItems': {
    en: 'Loading items…',
    ar: '...جارٍ تحميل الأصناف',
  },
  'admin.addons.noItems': {
    en: 'No items with addons found.',
    ar: 'لا توجد أصناف عليها إضافات.',
  },
  'admin.addons.noImage': { en: 'No image', ar: 'بدون صورة' },
  'admin.addons.hasAddons': { en: 'Has addons', ar: 'يوجد إضافات' },
  'admin.addons.hasGroups': {
    en: 'Has addon groups',
    ar: 'يوجد مجموعات إضافات',
  },
  'admin.addons.selectItemHint': {
    en: 'Select an item on the left to see its addon groups and addons.',
    ar: 'اختر صنفاً من القائمة لعرض مجموعات الإضافات الخاصة به.',
  },
  'admin.addons.groupsTitle': { en: 'Addon Groups', ar: 'مجموعات الإضافات' },
  'admin.addons.noItemSelected': {
    en: 'No item selected.',
    ar: 'لم يتم اختيار صنف.',
  },
  'admin.addons.noGroups': {
    en: 'This item has no addon groups.',
    ar: 'هذا الصنف ما عليه مجموعات إضافات.',
  },
  'admin.addons.noneInGroup': {
    en: 'No addons assigned to this group.',
    ar: 'لا توجد إضافات ضمن هذه المجموعة.',
  },
  'admin.addons.maxSelected': {
    en: 'Max {n} selected',
    ar: 'حد أقصى {n} اختيار',
  },
  'admin.addons.count': { en: '{n} addons', ar: '{n} إضافة' },

  /* ---------- Promos ---------- */
  'admin.promos.title': { en: 'Promos', ar: 'العروض' },
  'admin.promos.subtitle': {
    en: 'Sort, search, and filter by status/type/date window',
    ar: 'ترتيب وبحث وفلترة حسب الحالة أو النوع أو الفترة',
  },
  'admin.promos.searchPlaceholder': {
    en: 'Search code/type/value…',
    ar: '...ابحث بالكود أو النوع أو القيمة',
  },
  'admin.promos.anyTime': { en: 'Any time', ar: 'كل الفترات' },
  'admin.promos.activeNow': { en: 'Active now', ar: 'ساري حالياً' },
  'admin.promos.upcoming': { en: 'Upcoming', ar: 'قادم' },
  'admin.promos.expired': { en: 'Expired', ar: 'منتهي' },
  'admin.promos.allTypes': { en: 'All types', ar: 'كل الأنواع' },
  'admin.promos.percent': { en: 'Percent', ar: 'نسبة' },
  'admin.promos.amount': { en: 'Amount', ar: 'مبلغ' },
  'admin.promos.code': { en: 'Code', ar: 'الكود' },
  'admin.promos.value': { en: 'Value', ar: 'القيمة' },
  'admin.promos.minTotal': { en: 'Min Total', ar: 'أقل مبلغ' },
  'admin.promos.maxDiscount': { en: 'Max Discount', ar: 'أعلى خصم' },
  'admin.promos.starts': { en: 'Starts', ar: 'يبدأ' },
  'admin.promos.ends': { en: 'Ends', ar: 'ينتهي' },
  'admin.promos.statusActive': { en: 'Active', ar: 'ساري' },
  'admin.promos.none': {
    en: 'No promos match your search/filters.',
    ar: 'لا توجد عروض مطابقة للبحث أو الفلاتر.',
  },
  'admin.promos.count': { en: '{n} promos', ar: '{n} عرض' },

  /* ---------- Tables ---------- */
  'admin.tables.title': { en: 'Tables', ar: 'الطاولات' },
  'admin.tables.adminHint': {
    en: 'Admin: you can clear occupied tables',
    ar: 'مدير: تقدر تفرّغ الطاولات المشغولة',
  },
  'admin.tables.readOnlyHint': {
    en: 'Read-only • synced from server',
    ar: 'للعرض فقط • مزامنة من السيرفر',
  },
  'admin.tables.number': { en: 'Number', ar: 'الرقم' },
  'admin.tables.label': { en: 'Label', ar: 'التسمية' },
  'admin.tables.capacity': { en: 'Capacity', ar: 'عدد الكراسي' },
  'admin.tables.branchId': { en: 'Branch ID', ar: 'رقم الفرع' },
  'admin.tables.available': { en: 'Available', ar: 'فاضية' },
  'admin.tables.occupied': { en: 'Occupied', ar: 'مشغولة' },
  'admin.tables.reserved': { en: 'Reserved', ar: 'محجوزة' },
  'admin.tables.clear': { en: 'Clear table', ar: 'تفريغ الطاولة' },
  'admin.tables.clearTitle': {
    en: 'Clear table "{label}"?',
    ar: 'تفريغ الطاولة "{label}"؟',
  },
  'admin.tables.clearBody': {
    en: 'This will detach any current order from this table.',
    ar: 'راح يتم فك ارتباط الطلب الحالي عن هذه الطاولة.',
  },
  'admin.tables.clearHint': {
    en: 'You can always reassign a new order to this table later.',
    ar: 'تقدر تربط طلب جديد بهذه الطاولة في أي وقت.',
  },
  'admin.tables.clearFailed': {
    en: 'Could not clear table',
    ar: 'تعذر تفريغ الطاولة',
  },
  'admin.tables.none': { en: 'No tables found', ar: 'لا توجد طاولات' },
  'admin.tables.searchPlaceholder': { en: 'Search…', ar: '...بحث' },

  /* ---------- Payment methods ---------- */
  'admin.pay.title': { en: 'Payment Methods', ar: 'طرق الدفع' },
  'admin.pay.subtitle': {
    en: 'Search, filter, sort, paginate',
    ar: 'بحث وفلترة وترتيب وتصفح',
  },
  'admin.pay.searchPlaceholder': {
    en: 'Search slug / name / legacy…',
    ar: '...ابحث بالمعرّف أو الاسم أو الكود القديم',
  },
  'admin.pay.activeFilter': { en: 'Active filter', ar: 'فلتر التفعيل' },
  'admin.pay.slug': { en: 'Slug', ar: 'المعرّف' },
  'admin.pay.legacyCode': { en: 'Legacy Code', ar: 'الكود القديم' },
  'admin.pay.noneFiltered': {
    en: 'No methods match your search/filters.',
    ar: 'لا توجد طرق دفع مطابقة للبحث أو الفلاتر.',
  },
  'admin.pay.none': { en: 'No methods found.', ar: 'لا توجد طرق دفع.' },
  'admin.pay.count': { en: '{n} methods', ar: '{n} طريقة دفع' },

  /* ---------- Locations ---------- */
  'admin.loc.title': { en: 'Locations', ar: 'المناطق' },
  'admin.loc.subtitle': {
    en: 'States, Cities & Blocks',
    ar: 'المحافظات والمناطق والقطع',
  },
  'admin.loc.states': { en: 'States', ar: 'المحافظات' },
  'admin.loc.cities': { en: 'Cities', ar: 'المناطق' },
  'admin.loc.blocks': { en: 'Blocks', ar: 'القطع' },
  'admin.loc.state': { en: 'State', ar: 'المحافظة' },
  'admin.loc.city': { en: 'City', ar: 'المنطقة' },
  'admin.loc.searchStates': {
    en: 'Search states…',
    ar: '...ابحث في المحافظات',
  },
  'admin.loc.searchCities': {
    en: 'Search cities/state…',
    ar: '...ابحث بالمنطقة أو المحافظة',
  },
  'admin.loc.searchBlocks': {
    en: 'Search blocks/city/state…',
    ar: '...ابحث بالقطعة أو المنطقة أو المحافظة',
  },
  'admin.loc.allStates': { en: 'All states', ar: 'كل المحافظات' },
  'admin.loc.filterByState': {
    en: 'Filter by state',
    ar: 'فلترة حسب المحافظة',
  },
  'admin.loc.filterBlocksByState': {
    en: 'Filter blocks by state',
    ar: 'فلترة القطع حسب المحافظة',
  },
  'admin.loc.minOrder': { en: 'Min Order', ar: 'أقل طلب' },
  'admin.loc.minOrderFilter': { en: 'Min order ≥', ar: 'أقل طلب ≥' },
  'admin.loc.deliveryFee': { en: 'Delivery Fee', ar: 'رسوم التوصيل' },
  'admin.loc.deliveryFeeFilter': {
    en: 'Delivery fee ≤',
    ar: 'رسوم التوصيل ≤',
  },
  'admin.loc.noStates': { en: 'No states found.', ar: 'لا توجد محافظات.' },
  'admin.loc.noCities': {
    en: 'No cities match your filters.',
    ar: 'لا توجد مناطق مطابقة للفلاتر.',
  },
  'admin.loc.noBlocks': {
    en: 'No blocks match your filters.',
    ar: 'لا توجد قطع مطابقة للفلاتر.',
  },
  'admin.loc.statesCount': { en: '{n} states', ar: '{n} محافظة' },
  'admin.loc.citiesCount': { en: '{n} cities', ar: '{n} منطقة' },
  'admin.loc.blocksCount': { en: '{n} blocks', ar: '{n} قطعة' },

  /* ---------- Today's orders ---------- */
  'admin.orders.title': { en: 'Today’s Orders', ar: 'طلبات اليوم' },
  'admin.orders.subtitle': {
    en: 'All statuses for the current day',
    ar: 'كل الحالات لليوم الحالي',
  },
  'admin.orders.searchPlaceholder': {
    en: 'Search number / name / mobile / status…',
    ar: '...ابحث برقم الطلب أو الاسم أو الموبايل أو الحالة',
  },
  'admin.orders.allTypes': { en: 'All types', ar: 'كل الأنواع' },
  'admin.orders.orderTypeFilter': { en: 'Order type', ar: 'نوع الطلب' },
  'admin.orders.number': { en: 'Number', ar: 'رقم الطلب' },
  'admin.orders.customer': { en: 'Customer', ar: 'العميل' },
  'admin.orders.updated': { en: 'Updated', ar: 'آخر تحديث' },
  'admin.orders.print': { en: 'Print', ar: 'طباعة' },
  'admin.orders.printReceipt': { en: 'Print receipt', ar: 'طباعة الفاتورة' },
  'admin.orders.noneFiltered': {
    en: 'No orders match your filters.',
    ar: 'لا توجد طلبات مطابقة للفلاتر.',
  },
  'admin.orders.noneToday': {
    en: 'No orders for today.',
    ar: 'لا توجد طلبات اليوم.',
  },
  'admin.orders.count': { en: '{n} orders', ar: '{n} طلب' },
  'admin.orders.printAdminOnly': {
    en: 'Only admin users are allowed to print this report.',
    ar: 'الطباعة متاحة للمدراء فقط.',
  },
  'admin.orders.printNoId': {
    en: 'Cannot print: order ID is missing.',
    ar: 'تعذرت الطباعة: رقم الطلب غير موجود.',
  },
  'admin.orders.printFailed': {
    en: 'Failed to print this order.',
    ar: 'تعذرت طباعة هذا الطلب.',
  },

  /* ---------- server order statuses (backend enum, §3.4) ---------- */
  'admin.srv.0': { en: 'Pending payment', ar: 'بانتظار الدفع' },
  'admin.srv.1': { en: 'Order received', ar: 'تم تسجيل الطلب' },
  'admin.srv.2': { en: 'Preparing', ar: 'قيد التحضير' },
  'admin.srv.3.delivery': { en: 'Assigned to driver', ar: 'سلمت للسائق' },
  'admin.srv.3.other': { en: 'Waiting for pickup', ar: 'بانتظار الاستلام' },
  'admin.srv.4.delivery': { en: 'Delivered', ar: 'تم التوصيل' },
  'admin.srv.4.other': { en: 'Picked up', ar: 'تم الاستلام' },
  'admin.srv.5': { en: 'Cancelled by customer', ar: 'ألغيت من قبلك' },
  'admin.srv.6': { en: 'Cancelled by admin', ar: 'ألغيت من قبل الإدارة' },
  'admin.srv.7': { en: 'Waiting for pickup', ar: 'بانتظار الاستلام' },
  'admin.srv.8': { en: 'Rejected (automatic)', ar: 'مرفوض (تلقائي)' },
  'admin.srv.9': { en: 'Rejected (manual)', ar: 'مرفوض (يدوي)' },
  'admin.srv.unknown': { en: 'Status {n}', ar: 'حالة {n}' },

  /* ---------- Closing / sales report ---------- */
  'admin.rep.title': { en: 'Sales Reports', ar: 'تقارير المبيعات' },
  'admin.rep.startDate': { en: 'Start Date', ar: 'من تاريخ' },
  'admin.rep.endDate': { en: 'End Date', ar: 'إلى تاريخ' },
  'admin.rep.tabDaily': { en: 'Daily Report', ar: 'التقرير اليومي' },
  'admin.rep.tabItem': { en: 'By Item', ar: 'حسب الصنف' },
  'admin.rep.tabCategory': { en: 'By Category', ar: 'حسب القسم' },
  'admin.rep.tabPayment': { en: 'By Payment', ar: 'حسب طريقة الدفع' },
  'admin.rep.tabOrderType': { en: 'By Order Type', ar: 'حسب نوع الطلب' },
  'admin.rep.colItem': { en: 'Item', ar: 'الصنف' },
  'admin.rep.colCategory': { en: 'Category', ar: 'القسم' },
  'admin.rep.colPaymentMethod': { en: 'Payment Method', ar: 'طريقة الدفع' },
  'admin.rep.colOrderType': { en: 'Order Type', ar: 'نوع الطلب' },
  'admin.rep.colClient': { en: 'Client', ar: 'العميل' },
  'admin.rep.colDate': { en: 'Date', ar: 'التاريخ' },
  'admin.rep.colOrderNo': { en: 'Order #', ar: 'رقم الطلب' },
  'admin.rep.colOpStatus': { en: 'Op. Status', ar: 'حالة الدوام' },
  'admin.rep.colDiscount': { en: 'Discount', ar: 'الخصم' },
  'admin.rep.colCountSold': { en: 'Count / Sold', ar: 'العدد المباع' },
  'admin.rep.colTotalAmount': { en: 'Total Amount', ar: 'إجمالي المبلغ' },
  'admin.rep.inside': { en: 'Inside', ar: 'ضمن الدوام' },
  'admin.rep.outside': { en: 'Outside', ar: 'خارج الدوام' },
  'admin.rep.noOrders': { en: 'No orders found', ar: 'لا توجد طلبات' },
  'admin.rep.noRows': { en: 'No data available', ar: 'لا توجد بيانات' },
  'admin.rep.unknown': { en: 'Unknown', ar: 'غير معروف' },
  'admin.rep.cardInside': {
    en: 'Orders Inside Hours',
    ar: 'طلبات ضمن الدوام',
  },
  'admin.rep.cardOutside': {
    en: 'Orders Outside Hours',
    ar: 'طلبات خارج الدوام',
  },
  'admin.rep.cardCancelled': { en: 'Cancelled Orders', ar: 'الطلبات الملغية' },
  'admin.rep.cardEarning': { en: 'Total Earning', ar: 'إجمالي الإيراد' },
  'admin.rep.grossSales': { en: 'Gross Sales Total', ar: 'إجمالي المبيعات' },
  'admin.rep.discounts': { en: 'Discounts', ar: 'الخصومات' },
  'admin.rep.deliveryFees': { en: 'Delivery fees', ar: 'رسوم التوصيل' },
  'admin.rep.netTotal': {
    en: 'Total (Grand Total of All Sales) (Net Sales)',
    ar: 'الإجمالي النهائي (صافي المبيعات)',
  },
  'admin.rep.outsideTotal': {
    en: 'Outside Hours Sales Total (Informational)',
    ar: 'إجمالي مبيعات خارج الدوام (للعلم فقط)',
  },
  'admin.rep.cancelledTotal': {
    en: 'Cancelled Orders Total (From Inside Hours) (Informational)',
    ar: 'إجمالي الطلبات الملغية ضمن الدوام (للعلم فقط)',
  },
  'admin.rep.orderTypeDriveThru': { en: 'Drive-thru', ar: 'خدمة السيارات' },
  'admin.rep.statusAccepted': { en: 'Accepted', ar: 'تم القبول' },
  'admin.rep.print': { en: 'Print', ar: 'طباعة' },
} as const;
