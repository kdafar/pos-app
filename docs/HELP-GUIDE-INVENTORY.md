# In-app help guide — screen inventory and topic plan (CHECKPOINT 0)

Status: **draft for operator review.** Nothing is built yet. Open points are in
[HELP-GUIDE-QUESTIONS.md](HELP-GUIDE-QUESTIONS.md).

Read from the code at version 0.6.0 (commit 5394f64). EN/AR names are copied
from the `src/renderer/i18n/strings*.ts` files: they are what the screen shows.

---

## 1. Roles on this till

From `src/shared/permissions.ts` (`ROLE_DEFAULTS`). A user can have extra
permissions added or taken away, so these are only the defaults.

| Role | What it can do by default | Guide path |
|---|---|---|
| `pos` / `branch` (cashier) | create orders, see own orders, edit unpaid orders, cancel (unsent) orders, tables, mark paid | **Cashier** |
| `kitchen` | kitchen display, see all orders, change order status | **Kitchen** |
| `manager` | everything except Permissions | **Branch manager** |
| `admin` / `owner` | everything | **Branch manager** |
| `accountant` | see all orders, closing report, print/export reports | ? (see Q1.2) |

The till has **no shift**: no "open shift", no "close shift", no cash count
screen. A manager approves some actions by typing a 6-digit code or scanning a
manager card (**Manager approval / موافقة المدير**).

---

## 2. Screens, popups and main buttons

"Changes" = what the action touches: **O**rder, **P**ayment, **Pr**inter,
**T**able, **S**ync, **D**evice. There is **no stock tracking on the till**:
nothing on it changes stock (items only show **Out of Stock / غير متوفر**
when the back office marks them so).

### 2.1 Before signing in

| Screen / control | EN | AR | Who | What it does | Changes |
|---|---|---|---|---|---|
| Pair screen | Pair device | ربط الجهاز | anyone (no sign-in) | Connect the till to a branch with **Server base URL** + **Pairing code** from the back office. Shows the branch back; staff must check it. | D, S |
| Pair: success | Continue to login | المتابعة لتسجيل الدخول | anyone | Goes to sign-in. | — |
| Sign-in screen | Sign in | تسجيل الدخول | anyone | Tap your name under **Quick users / دخول سريع**, type password. | — |
| Sign-in: Device status | Mode: Live (sync) / Offline only | متصل (مزامنة) / بدون اتصال فقط | anyone | Turns sending to the server on/off. | S |
| Sign-in: Outbox | Outbox · {n} pending / Up to date | صندوق الإرسال · بانتظار الإرسال / كل شيء محدّث | anyone | Shows orders not yet sent. | — |
| Sign-in: Unpair | Unpair device | إلغاء ربط الجهاز | **anyone, before sign-in** (Q1.5) | Disconnects the till; optional **Also delete all data on this device**. | D, S |
| Sign-in: Shift tips | Shift tips | إرشادات الوردية | anyone | Three tips (offline mode, sync, pair). | — |
| Language button | English / العربية | | anyone | Switches language and screen direction. | — |

### 2.2 Sidebar (every screen after sign-in)

| Item | EN | AR | Shown when |
|---|---|---|---|
| Order screen | Order Process | شاشة الطلب | `orders.create` |
| Orders list | Recent Orders (page title: Today's Orders) | آخر الطلبات (طلبات اليوم) | `orders.view_own` |
| Kitchen | Kitchen display | شاشة المطبخ | `orders.kitchen_view` |
| Report | Closing Report | تقرير الإغلاق | `reports.view` |
| Catalog section | Categories, Items, Promocodes | الأقسام، الأصناف، أكواد الخصم | `catalog.manage` (read-only lists) |
| System section | Payment Methods, Locations, Tables, Settings, Updates, Permissions | طرق الدفع، المناطق، الطاولات، الإعدادات، التحديثات، الصلاحيات | one permission each |
| Sync card | Online / Offline, **Sync now**, last sync time, branch name | متصل / غير متصل، **مزامنة الآن** | everyone |
| Update badge | Update ready | تحديث جاهز | when a new version is downloaded |
| Language, theme | English/العربية, Toggle theme | تغيير المظهر | everyone |
| Sign out | Sign out | تسجيل الخروج | everyone |

### 2.3 Order Process / شاشة الطلب (the selling screen)

| Control | EN | AR | What it does | Changes |
|---|---|---|---|---|
| New order | NEW | جديد | Starts a new order. It starts as **Pickup**. | O |
| Open-order tabs | (order type + number) | | Switch between orders still open on this till. | — |
| Order type | Delivery / Pickup / Dine-in | توصيل / استلام / داخل المطعم | Changes the type. Delivery shows only if the branch delivers. | O |
| Table bar | (table names) | | Tap a table to open its order or start a dine-in order on it. | O, T |
| Search | Search items, barcode, or Arabic name… | ابحث بالاسم أو الباركود... | Find a dish. A barcode scanner also adds items. | — |
| Categories | All Categories | كل الأقسام | Filter dishes. | — |
| Dish card | (dish) · Out of Stock | غير متوفر | Tap = add one. Dishes with sizes/add-ons open the options popup. | O |
| **Options popup** | Customize your order → **Add to order** | خيارات الصنف → **إضافة للطلب** | Pick size (**Size / Variation**), add-ons, quantity. | O |
| Line: + / − / trash | Remove; Note | حذف؛ ملاحظة | Change quantity or remove. On a line already sent: needs **Manager approval** (Q2.4). | O |
| Promo | Apply Promo Code → **Apply Code** | تطبيق كود الخصم → **تطبيق الكود** | The only discount on the till. | O |
| Clear cart | Clear cart | تفريغ السلة | Removes all items (asks first). | O |
| Assign table | Assign Table | تحديد الطاولة | Dine-in: pick table and **Covers / عدد الأشخاص**. | T |
| Delivery fee | Delivery fee → No charge / Use area fee | رسوم التوصيل → بدون رسوم / رسوم المنطقة | Change or waive the fee. | O |
| Badges | Main order locked (printed); {n} new items pending | الطلب الرئيسي مقفل (تمت طباعته)؛ أصناف جديدة بانتظار الطباعة | After the first print, items are locked. New items wait for the next print. | — |
| **Place order** (not dine-in) | Place order | تأكيد الطلب | Opens **Complete Order**. | — |
| **Update / Pay** (dine-in) | Update / Pay | تحديث / دفع | First time: opens Complete Order. Later rounds with saved details: sends the round straight away and prints. | O, Pr |
| **Close order** | Close order | إغلاق الطلب | Prints the receipt if never printed, then closes the order. Empty order: deletes it. (Q2.1) | O, Pr |
| **Close & Release** (dine-in with items) | Close & Release | إغلاق وتحرير الطاولة | Asks, prints the receipt, closes the order and frees the table. | O, Pr, T |
| Mark paid | Mark paid / Undo paid | تسجيل كمدفوع / إلغاء الدفع | See 2.5. | P |

### 2.4 Complete Order / إتمام الطلب (checkout popup)

| Control | EN | AR | What it does |
|---|---|---|---|
| Quick Mode | Quick Mode | الوضع السريع | Fewer fields. (Q3.3) |
| Customer lookup | Mobile Number (Customer Lookup) | رقم الموبايل (البحث عن العميل) | Finds a past customer. |
| Customer name | Customer Name | اسم العميل | Required. |
| Delivery address | State, City, Block, Street, Building, Floor | المحافظة، المنطقة، القطعة… | Required for delivery. Shows **Min order** for the area. |
| Table | Assign Table | تحديد الطاولة | Required for dine-in. |
| Notes | Order Notes | ملاحظات الطلب | Shown on the kitchen display. |
| Payment method | Payment method | طريقة الدفع | List comes from the server. |
| Cash received | Cash received / Exact / Change | المبلغ المدفوع / المبلغ بالضبط / الباقي | Only if the branch has it switched on. Must be in 5 fils. |
| Fix list | Finish these before placing the order · Show me | أكمل هذه الخطوات قبل إتمام الطلب · اذهب إليه | Points to missing fields. |
| **Place order** | Place order | تأكيد الطلب | Saves the order as **Placed**, gets an order number from the server when online, prints the receipt, may open the cash drawer (if switched on). Online payment → shows the payment link. |
| Payment link popup | Payment link · Copy link · WhatsApp · Check payment status | رابط الدفع · نسخ الرابط · واتساب · تحقق من حالة الدفع | Customer scans the QR or gets it by WhatsApp. |

### 2.5 Mark paid / تسجيل كمدفوع

On the order panel and in Today's Orders (click the **Unpaid / غير مدفوع** badge).
Pick **Paid by**; for KNET type the **KNET slip reference / رقم مرجع إيصال كي نت**.
Confirm says "Only confirm once the money is in hand." Offline: "Saved on this
till. It will be sent when the connection is back." **Undo paid** needs
`orders.mark_unpaid` or a manager code. Only if the server supports it.

### 2.6 Recent Orders → Today's Orders / طلبات اليوم

Search, **Order type** filter, From/To date, **Filter**. Per row: **Update status**
(Placed → Prepared → Ready / Waiting for pickup → Closed, or **Cancelled by
customer / ألغيت من قبلك**, which asks for a manager code), **Payment** badge
(mark paid), **View details** (items + **History / سجل الطلب**), **Print
receipt**, **Show payment QR**, **Change payment method**, **Send payment link**.
Orders made on the website also appear here (Q5.1).

### 2.7 Kitchen display / شاشة المطبخ

Three lanes: **New orders → Preparing → Ready**. Buttons: **Start preparing /
بدء التحضير**, **Mark ready / تحديد كجاهز**, **Complete order / إكمال الطلب**.
Refreshes every 15 s. Time chip turns orange at 10 min, red at 20 min. Shows
orders from the last 24 h that have items stored on this till.

### 2.8 Closing Report / تقرير الإغلاق

Tabs: **Daily Report, By Item, By Category, By Payment, By Order Type**. Cards:
inside/outside hours, cancelled, **Total Earning**. Buttons: **Print** (A4
preview), **Print Thermal / طباعة حرارية** (roll). Cashiers see only
**Current working day**; managers can pick dates. **End day / إنهاء اليوم** is
in the code but **switched off** (`END_DAY_ENABLED = false`) — Q8.1.

### 2.9 Manager screens

| Screen | EN / AR | Gate | Notes |
|---|---|---|---|
| Tables | Tables / الطاولات | `tables.manage` | Read-only list. **Clear table / تفريغ الطاولة**; a table with an open order needs `tables.force_close` or a manager code. (Cashiers hold `tables.manage` too — Q4.3.) |
| Settings | Settings (Read-only) / الإعدادات (عرض فقط) | `settings.manage` | **Text size**, **Receipt printer** (printer, paper width, **Show the print dialog**, **Print a test receipt**), **Cash drawer** (off by default; **Open the drawer now**), **Invoice logo**, **Repair incomplete orders**, read-only settings table. |
| Updates | Software Update / تحديث البرنامج | `updates.manage` | **Check for updates**, **Restart and install now**. |
| Permissions | Role permissions / صلاحيات الأدوار | `users.permissions` (admin) | Per-till role permissions. |
| Categories, Items, Promocodes, Payment Methods, Locations | | `catalog.manage` etc. | Read-only, synced from the back office. |

### 2.10 Things the suggested topic list mentions that **do not exist** on this till

Writing a guide step for these would invent a feature:

- Open / close shift, cash count.
- Kitchen tickets or station printers (station printing was dropped). The till
  prints **one customer receipt**; the kitchen uses the **Kitchen display**.
- Stock going up or down.
- Sell by weight.
- Split the bill, split payment, merge tables.
- Manual discount (only promo codes).
- Refund (the permission exists, no screen uses it).
- A card-machine connection (KNET is recorded by typing the slip reference).
- Accept / reject screen for website, WhatsApp, Talabat or Keeta orders.
- End day (built, switched off).

---

## 3. Proposed topics and steps (headings only)

`[C]` cashier, `[K]` kitchen, `[M]` manager. Screen id → step for the **?** button
in brackets.

1. **Start the day** `[C K M]`
   1. Sign in with your name (Quick users) `[login]`
   2. Check the Online light and the branch name `[sidebar sync card]`
   3. Print a test receipt *(manager)* `[settings]`
   4. Pair a new till *(manager)* `[pair]`
2. **Take an order** `[C]`
   1. Start a new order and choose the type `[order-process]`
   2. Find a dish (search, categories, barcode)
   3. Sizes and add-ons `[options popup]`
   4. Change quantity, add a note, remove a dish
   5. Use a promo code `[promo popup]`
   6. Delivery: address and delivery fee
   7. Work on several orders at once (order tabs)
3. **Dine-in tables** `[C]`
   1. Seat a table (Assign Table, covers) `[table picker]`
   2. Send more dishes to a table (Update / Pay)
   3. Change the table *(pending Q4.1)*
   4. Finish and free the table (Close & Release)
4. **Take payment** `[C]`
   1. Place the order (Complete Order) `[checkout]`
   2. Cash and change
   3. KNET or card: mark paid with the slip reference `[mark paid]`
   4. Payment link: QR or WhatsApp `[payment link popup]`
   5. Undo a payment *(manager approval)*
5. **Change or cancel** `[C M]`
   1. Change an order before it prints
   2. Remove a dish already sent *(manager approval)* `[approval popup]`
   3. Cancel an order *(pending Q2.1–2.3)*
   4. Manager approval: how to give your code `[M]`
6. **Orders from the website** `[C M]` *(scope pending Q5)*
   1. Find today's orders `[recent-orders]`
   2. Move an order along (Update status)
   3. Reprint a receipt, show a payment QR, send a payment link
7. **Kitchen display** `[K]`
   1. Read a ticket (lanes, time colours, notes) `[kitchen]`
   2. Start preparing → Mark ready → Complete order
8. **Printing and the cash drawer** `[C M]`
   1. When the receipt prints (and when it does not)
   2. Reprint a receipt
   3. Set up the printer *(manager)* `[settings]`
   4. Set up the cash drawer *(manager)*
9. **No internet (offline)** `[C K M]`
   1. What still works offline
   2. See orders waiting to send (Outbox)
   3. Send them now (Sync now)
10. **End of the day** `[C M]`
    1. Read the closing report `[closing-report]`
    2. Print the closing report (thermal or A4)
    3. End day *(only if Q8.1 says it is turned on)*
11. **Manager tools** `[M]`
    1. Language and text size
    2. Clear a table `[tables]`
    3. Install an update `[updates]`
    4. Role permissions `[permissions]`
    5. Repair incomplete orders
    6. Unpair or move a till
12. **Something went wrong** `[all]` — printer, offline/not sending, order
    stuck or missing on another till, wrong dish or price, payment failed or
    paid twice, drawer will not open, cannot sign in / asks to pair again.

**Your first day** paths (6–9 steps each, links into the topics above):

- **Cashier:** 1.1 → 1.2 → 2.1 → 2.3 → 4.1 → 4.2 → 4.3 → 3.4 → 9.1
- **Kitchen:** 1.1 → 7.1 → 7.2 → 9.1 → 12 (order missing) → 1.2
- **Branch manager:** 1.3 → 5.4 → 4.5 → 6.1 → 10.1 → 10.2 → 11.3 → 9.2

---

## 4. Build notes (for after the OK)

- **Help must not sit behind `settings.manage`.** Settings is manager-only, so
  the Help link goes in the sidebar for everyone, beside **Sign out**.
- Screenshots: use a separate till profile (`POS_PROFILE=demo`, already
  supported in dev builds) with seeded demo data, driven by Playwright. This
  adds `playwright` (and an image tool for WebP) as dev dependencies only.
- Existing browser-default controls I found outside the guide (not in scope,
  listed so you know): `window.alert` in Closing Report print errors; native
  `<select>` in Today's Orders type filter and the sign-in Mode switch.
