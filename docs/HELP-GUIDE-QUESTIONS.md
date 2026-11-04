# In-app help guide — questions, answers and findings

Screen list: [HELP-GUIDE-INVENTORY.md](HELP-GUIDE-INVENTORY.md) (Checkpoint 0 draft; the
corrections below win where they differ).

## Answered by the operator (2026-11-04) — written into the guide

| Question | Answer | Where it shows |
|---|---|---|
| What does **Close order** do? | Finishes the sale (tooltip "Cancel this order" is wrong). | change.cancel, printing.when |
| How is a placed order cancelled? | The manager does it: Today's Orders → Update status → Cancelled by customer. Cashiers do not have "Change order status". | change.cancel, change.cancel-manager |
| KNET at the counter? | Place order with KNET → card machine → Mark paid with the slip reference. | pay.knet |
| Who presses **Complete order** on the kitchen display? | Anyone who has the kitchen display. | kitchen.move |
| No internet? | Keep selling; do not touch the Mode switch. | offline.works |
| Safe to switch the till off with unsent orders? | Yes. | offline.works |
| Website orders on the till? | View only, in Today's Orders; accepted in the back office. | orders.find |
| Support line | "+965 2241 5093", only in the "Still not working?" line. | every trouble step |
| Closing routine (End day is off) | Print Thermal, cashier signs, gives it to the manager. | closing.print |
| Move a table? | Yes — tap the table button on the open order and pick another. | tables.move |
| Help link | Sidebar, above Sign out, for everyone. | — |

## Still open — left OUT of the guide until answered

1. **Quick Mode** in Complete Order — what is it for, when should a cashier use it?
2. **Refunds** — the guide only says "do not give money back from the till yourself. Tell your manager." What is the real process?
3. **Website orders on the kitchen display** — the till often receives them without their dishes, and the kitchen display skips orders with no dishes. Should the kitchen expect them there?
4. **Order numbers offline** — does a receipt printed offline show a different number from the back office later?
5. **"Offline for too long"** — after how long does a till unpair itself? (The guide does not give a number.)
6. **Cash drawer** — the guide explains the setting to managers with the app's own warnings. Is any shop using it yet (release gate: physical test outstanding)?
7. **Forgot password** — who resets it? (Guide says "ask your manager".)
8. **Accountant role** — has no "first day" path. Wanted?
9. **Back-office menu names** "POS devices → Add a till to a branch" are taken from the pair screen. Still correct?

## Corrections found while building (the code, not the brief, is the source)

- **The sidebar "Online / Offline" sign is real.** Online = the till reached the back office AND Mode is Live. Offline = it could not (or Mode is Offline only). The Sync-now button does nothing while Offline.
- **Pickup and delivery orders leave the tab strip as soon as they are placed.** Only dine-in stays. So Mark paid for a placed pickup is done from Recent Orders (Unpaid badge), Undo paid from View details, and "remove a sent dish with manager approval" is a table thing.
- **The order screen folds the side menu to icons every time it opens**, hiding the sync box. The guide tells staff to tap **Expand sidebar**.
- **"Not counted — not put through"** in the closing report means *never placed*, not "still open".
- There is no shift, no kitchen ticket, no stock, no weight, no split bill/payment, no manual discount, no refund screen on the till.

## Bugs and usability problems found

Fixed 2026-11-04: 1, 2 and 3. The rest are not fixed.

1. **FIXED — Kitchen display never showed the order note.** `KitchenDisplayPage.tsx:61` reads `order.order_notes`; the column is `note` (`orders:kitchenBoard` returns `o.*`). The note does print on the receipt.
2. **FIXED — Kitchen display showed "#Local order" instead of the order number** (now uses `shortOrderLabel`, the same label as the order panel) until the order gets its server reference — so on an offline till, always. It reads `order_number || local_number || reference_no`; the orders table has `number`, not the first two, and `reference_no` only arrives from the server. The receipt shows e.g. `#1R9P1`, so offline the kitchen cannot match a ticket to a receipt.
3. **FIXED — Close order tooltip** said "Cancel this order" but finishes the sale. Now `cart.tipClose`: "Finish and close this order".
4. **Arabic order lines show size and add-on names in English** ("Double", "Cheese +") while the screen is in Arabic.
5. **Startup error** on tills without an `orders.completed_at` column: `db.ts` ~line 822 builds `COALESCE(updated_at)` (one argument), SQLite rejects it, so the one-off "release-table repush" repair fails and retries on every start. Seen in the log: `[repair] release-table repush repair failed: SqliteError: wrong number of arguments to function COALESCE()`.
6. **Closing Report page is titled "Sales Reports"** while the menu says "Closing Report".
7. **Quick-user chips** run the role into the name ("Sara Cashier**pos**").
8. The **Expand sidebar** button has no accessible name (tooltip only).
9. Browser-default controls outside the guide: `window.alert` on Closing Report print errors; native `<select>` (Today's Orders, sign-in Mode); native date pickers on the Closing Report.
