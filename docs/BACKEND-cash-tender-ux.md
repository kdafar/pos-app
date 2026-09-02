# Cash tender capture — the rules the till already ships

For the web POS (PHP/Blade). The desktop till implements all of this in
`src/shared/cashChange.ts`; this document is that behaviour written out so the
two ends agree, and so the web POS does not have to rediscover it the way we
did.

Everything here is about **capturing what the customer handed over**. The
change arithmetic itself is already correct server-side (`Order::CASH_ROUNDING_UNIT`,
`Order::getChangeDueAttribute()`) — do not reimplement it.

---

## 1. The one fact everything follows from

**Kuwait has no coin below 5 fils.** The 1 fils has not been minted since 1988.

Every rule below is a consequence:

- No amount ending in 1, 2, 3, 4, 6, 7, 8 or 9 fils can be handed over.
- Change is rounded to 5 fils (already implemented server-side).
- A capture field must not accept, offer, or step through amounts that do not
  exist.

The money format has three decimals, which makes 0.001 *look* like a valid
amount. It is not.

## 2. Validity — `isTenderable`

An amount can be tendered when it is **positive and a whole multiple of 5 fils**.
Any pile of real Kuwaiti coins and notes sums to a multiple of 5 fils, so this
single test is sufficient.

```php
public static function isTenderable(?float $amount): bool
{
    if ($amount === null || !is_finite($amount) || $amount <= 0) {
        return false;
    }
    return intdiv((int) round($amount * 1000), 5) * 5 === (int) round($amount * 1000);
}
```

Work in **whole fils (integers)**, never in floats. `0.1 + 0.2 !== 0.3`, and the
naive float form of the rounding rule returns `1.6649999999999998`, which
formats as `1.664` — a coin that does not exist.

| amount | tenderable | why |
|---|---|---|
| 0.005 | yes | the 5 fils coin |
| 0.250, 0.755, 3.250 | yes | |
| 0.001, 0.003, 0.007 | **no** | no such coin |
| 0.501 | **no** | |
| 3.333 | **no** | a valid *bill*, not a valid *tender* |
| 0, negative, null | **no** | |

## 3. Suggested amounts — `suggestTenders`

**People pay with notes, not with increments.** This is the rule that matters,
and the one that is easy to get wrong.

Notes in circulation: **0.250, 0.500, 1, 5, 10, 20 KD.**

Build the list as:

1. **Exact** — the bill rounded **UP** to the nearest 5 fils. (A 3.333 bill is
   not payable in coins; the exact button must offer 3.335, never 3.333.)
2. Then every **note denomination greater than** that exact amount.
3. Then, for bills above the largest note, the **stacks people actually build**:
   round the bill up to the next multiple of 5, of 10, and of 20 KD.
4. Deduplicate, sort ascending, keep Exact first, cap at 4 buttons.

Below 20 KD step 3 collapses onto the note denominations and dedupes away, so
it costs nothing.

### Test vectors — copy these into a test

| bill | buttons |
|---|---|
| 0.500 | 0.500, 1.000, 5.000, 10.000 |
| 0.750 | 0.750, 1.000, 5.000, 10.000 |
| 1.000 | 1.000, 5.000, 10.000, 20.000 |
| 1.200 | 1.200, 5.000, 10.000, 20.000 |
| 3.250 | 3.250, 5.000, 10.000, 20.000 |
| 3.333 | **3.335**, 5.000, 10.000, 20.000 |
| 12.500 | 12.500, 15.000, 20.000 |
| 20.000 | 20.000 |
| 21.000 | 21.000, 25.000, 30.000, 40.000 |
| 45.000 | 45.000, 50.000, 60.000 |
| 0 or invalid | *(empty)* |

`20.000 → [20.000]` is correct and not a bug: one 20 note covers that bill
exactly, so there is nothing else to offer.

## 4. The input control

- **Do not use `<input type="number">` with a step.** Its spinner walks
  0.505 → 0.510 → 0.515 against a 0.500 bill. Nobody hands that over. It is
  increment thinking, and it is the specific mistake this document exists to
  prevent.
- The **denomination buttons are the primary control.** One tap.
- Keep a plain text input (`inputMode="decimal"`) for the occasional odd
  amount typed straight in — a customer paying 0.750 in coins for a 0.500 bill.
  Accept only the shape of a KD amount: digits, at most one dot, at most three
  decimals.
- Size the buttons for a **finger**, not a mouse pointer. This is a till.

## 5. What counts as a usable tender

Record it only when it is **tenderable AND covers the bill**.

- **Below the bill** → not a tender, it is a partial payment. Warn inline
  ("Less than the total — will not be printed"), but do **not** block the sale:
  the sale is valid, the capture is optional. The server discards a short
  tender anyway.
- **Not a 5 fils multiple** → warn ("Round to the nearest 5 fils") and do not
  record it.
- **Never send `0`.** Omit `amount_tendered` from the payload entirely. A zero
  reads as "the customer paid nothing" and prints the whole bill as change owed.
- Do **not** preview change for an amount that fails either test — a screen
  showing change for money that could not have been handed over contradicts the
  warning printed directly beneath it.

## 6. When the capture appears at all

Only when **both**:

- `branch.show_change_on_receipt` is on (off by default on every branch), and
- the sale is **cash**.

Server-side, cash means `legacy_code == 0` — an order row carries only the
numeric code. (The desktop till matches on the slug instead, because it holds
the slug and not the code. Both select the same single method today, and both
ends pin a test that fails if that stops being true.)

A KNET or card terminal has already taken the exact amount: no tender to
capture, no change to hand back, no block on the receipt.

## 7. Printing — already agreed, repeated here so it is in one place

Directly under Grand Total, and only for a cash sale with an overpayment:

```
Grand Total   / الإجمالي         3.333
Cash Received / المبلغ المدفوع   5.000
Rounding      / التقريب          0.002
Change        / الباقي           1.665
```

- **`change = raw − rounding`.** Positive rounding = fils the shop kept.
  Negative (prints `- 0.002`) = fils the shop handed over.
- Print the Rounding line **only when rounding actually moved the figure**, so
  the arithmetic on the slip adds up.
- The block prints on **any** overpayment, including one that rounds to
  `Change 0.000` — a 4.998 bill paid with 5.000 leaves the drawer 2 fils up,
  and the slip is the only record of it. "Never print 0.000" applies solely to
  an **exact** payment, where there is nothing to explain.
- Silent on: exact payment, short tender, no tender recorded, and any
  non-cash method.

## 8. Mistakes we already made — do not repeat them

Each of these shipped or nearly shipped on the desktop till and was corrected:

1. **`step="0.001"` on the input.** Offered 0.001, 0.002, 0.003 — none of which
   are coins.
2. **`min="0"` on the input.** Let 0.005 sit against a 0.500 bill. `min` is the
   grand total.
3. **Suggesting "the next whole dinar".** Offered 4.000 for a 3.250 bill. There
   is no 4 KD note; the customer reaches for the 5. Suggestions come from
   denominations, never from rounding up to a tidy number.
4. **An "Exact" button showing the raw bill.** 3.333 is not payable. Round the
   exact button up to 3.335.
5. **Guarding the change block with `raw >= 0.005`.** That swallowed the 1–4
   fils overpayments — precisely the ones that round to zero change and so most
   need explaining. The guard is `raw >= 0.0005`, i.e. any overpayment at all.
6. **A second copy of the rounding rule.** Two implementations of one rule is
   how the counter slip and the office copy end up a few fils apart. There is
   one, server-side, and the client mirrors it under test.

## 9. Definition of done

- `isTenderable` and `suggestTenders` exist as pure, unit-tested functions —
  not logic inlined in a Blade template or a JS event handler.
- The test vectors in §3 pass verbatim.
- The tender input has no spinner and cannot produce a non-5-fils amount.
- A short or non-tenderable amount warns, is not recorded, and does not block
  the sale.
- Nothing in the diff recomputes change independently of
  `Order::getChangeDueAttribute()`.
