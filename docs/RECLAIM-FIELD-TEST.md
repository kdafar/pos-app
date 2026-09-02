# Silent re-pair — field test runbook

**Window:** Thursday 3 September 2026, 04:00–09:00 Kuwait (UTC+3)
**Branch:** Salmiya — already armed, nothing to request on the day
**Backend:** watching the audit log live

The client half of `/reclaim` has never returned a 200. Everything below is
what proves it does, on a real till against the live server.

Take **one till out of service** for this. Every scenario ends with the till
paired and selling again, but scenario B deliberately damages `pos.db`.

---

## Before you start

Write these down — you cannot read some of them once the credential is gone.

```powershell
# The device id and branch this till believes it is
sqlite3 "$env:APPDATA\POS App\pos.db" `
  "SELECT key, value FROM meta WHERE key IN ('device_id','machine_id','branch_id','server.base_url');"

# Confirm the credential is actually there
cmdkey /list | Select-String 'pos-app'
```

Also note the **unsynced order count** from the status bar. It must be the same
at the end of every scenario — the whole point is that none of this costs a
sale.

Take a copy of the database before touching anything:

```powershell
Copy-Item "$env:APPDATA\POS App\pos.db" "$env:USERPROFILE\Desktop\pos.db.backup"
```

---

## Scenario A — clean credential loss

The common case: the token is gone, `pos.db` is intact.

1. Close the POS completely.
2. Delete the credential:
   `cmdkey /delete:pos-app/device_token`
3. Confirm it is gone: `cmdkey /list | Select-String 'pos-app'` returns nothing.
4. **Wait a full minute before starting the POS.** The server refuses a
   machine-only reclaim aimed at a device it saw syncing in the last ten
   minutes — that is the guard against a cloned disk image, working as
   designed. A till that restarts too fast still looks online and earns a
   correct-but-confusing "This till is still connected".
5. Start the POS.

**Expect:** a brief "Reconnecting this device…" card, then the login screen.
**No pairing code is typed at any point.**

**Backend should see:** one allowed reclaim for this device id, in the audit
log, with this till's IP and app version. `same_network` rides along as
evidence; it is not the verdict and a `false` there is not a failure — tills in
this estate roam across unrelated Kuwaiti ranges routinely.

**Fails if:** the pairing form appears. Note which message shows — the reason
is logged, and `POS_RECLAIM_DISABLED` means Salmiya was not actually armed.

---

## Scenario B — the old bug's damage

This is the state the original interceptor left behind, and the one the orders
fallback exists for. `pos.db` survives but `device_id` is blanked.

1. Close the POS completely.
2. Delete the credential *and* blank the device id:

```powershell
cmdkey /delete:pos-app/device_token
sqlite3 "$env:APPDATA\POS App\pos.db" "UPDATE meta SET value='' WHERE key='device_id';"
```

3. Confirm the damage, and confirm the recovery source still exists:

```powershell
sqlite3 "$env:APPDATA\POS App\pos.db" "SELECT value FROM meta WHERE key='device_id';"
# expect: empty

sqlite3 "$env:APPDATA\POS App\pos.db" `
  "SELECT device_id FROM orders WHERE device_id<>'' ORDER BY created_at DESC LIMIT 1;"
# expect: the id you wrote down at the start
```

4. Start the POS.

**Expect:** the same silent reconnect. The main log line to look for is
`[Sync] Recovered device id from local orders.`

**Backend should see:** an allowed reclaim for the *same* device id as
scenario A — recovered from the orders table, not from meta.

**Fails if:** it reaches the pairing form. That means the fallback did not
find an order, which is worth knowing — check the till has at least one of
its own sales.

---

## Scenario C — the machine guard (only if they have shipped it)

Proves a refusal is safe and does not disturb a working till.

1. With the till **paired and healthy**, note that it is syncing normally.
2. Ask the backend to reject the next reclaim from this machine.
3. Trigger a reclaim by repeating scenario A.

**Expect:** the pairing form, with the till's data intact — catalog, orders,
unsynced count all unchanged. The point is that a refusal costs nothing.

**Backend should see:** `wrong_device_id_real_machine` rather than
`machine_mismatch`, and the live token still valid. They will also confirm the
refusal left `last_reclaim_at` untouched — read from the audit log on their
side, so there is nothing for anyone at the till to check.

---

## Scenario D — the machine-only path

Scenarios A and B both supply a `device_id`, so neither exercises the path
where the machine alone identifies the till. This is the state of a device
blanked **before it ever sold**, and the only scenario that reaches it.

Non-destructive: the sales rows are kept, only the id stamped on them is
cleared. You wrote that id down at the start and restore it at the end.

**Do this only when the unsynced count is zero.**

1. Close the POS completely.
2. Remove every copy of the device id, and the credential:

```powershell
cmdkey /delete:pos-app/device_token
sqlite3 "$env:APPDATA\POS App\pos.db" "UPDATE meta SET value='' WHERE key='device_id';"
sqlite3 "$env:APPDATA\POS App\pos.db" "UPDATE orders SET device_id='';"
```

3. Confirm nothing is left to recover, and that the machine id survives — it
   is the only thing identifying the till now:

```powershell
sqlite3 "$env:APPDATA\POS App\pos.db" `
  "SELECT (SELECT value FROM meta WHERE key='device_id') AS meta_id,
          (SELECT COUNT(*) FROM orders WHERE device_id<>'') AS recoverable,
          (SELECT value FROM meta WHERE key='machine_id') AS machine;"
# expect: empty, 0, and the machine id you wrote down
```

4. Wait a minute — the liveness guard again — then start the POS.

**Expect:** the same silent reconnect, with no code.

**Fails as expected if** they have not shipped the machine-only path: the till
shows the pairing form and the log carries `input_missing`. That is the correct
old behaviour, not a regression.

**Restore afterwards**, using the id from the top of this document:

```powershell
sqlite3 "$env:APPDATA\POS App\pos.db" "UPDATE orders SET device_id='<THE ID>';"
```

---

## After every scenario

```powershell
# Credential reissued, and it is a different value than before
cmdkey /list | Select-String 'pos-app'

# Branch is whatever the office says, not what the till asked for
sqlite3 "$env:APPDATA\POS App\pos.db" "SELECT value FROM meta WHERE key='branch_id';"
```

Then ring up **one real sale** and confirm it pushes. A till that reconnected
but cannot sell has not passed.

---

## If it goes wrong

The pairing code still works and always did — nothing here removes that path.
Pair the till normally from the dashboard and the shop is trading again.

If `pos.db` itself is damaged, restore the backup taken at the top, then pair
with a code.

---

## What to report back

For each scenario: whether a code was needed, what the audit log recorded, and
whether the unsynced order count survived. The third is the one nobody thinks
to check and the only one that costs money if it is wrong.
