# POS ↔ Backend: pairing recovery

Two asks, from a field incident where tills came back to the **Pair screen**
after a shop re-ran the installer, and a cashier had to type a fresh pair code
to get a till that had been paired and selling for months back online.

**Blocker (answer needed):** §2 — how a revoked device is recognisable.
**Feature request:** §3 — `POST /api/pos/reclaim`, so this never needs a human.
**Confirmations only:** §4.

---

> ## Answered 2026-09-01 — all of it
>
> The backend's reply is in their repo as `docs/POS-PAIRING-RECOVERY.md`. What
> came back, and what the client did with it:
>
> - **§2.1 answered, and they fixed a bug of their own.** An unknown device id
>   used to answer `POS_DEVICE_REVOKED` — it now answers `POS_DEVICE_UNKNOWN`
>   (401). `POS_DEVICE_REVOKED` is the only device-auth response that may
>   unpair. `classifyAuthFailure()` now keys on the code alone and never lets a
>   message override it.
> - **§2.2 was already shipped** — every `/api/pos/*` refusal has carried a
>   stable code since 2026-08-23. The message fallback survives only for a
>   server older than that.
> - **§3 built and live**, with mitigations 1–4, armed per branch and off
>   everywhere for now. Client side is `reclaimDevice()` and `sync:reclaim`;
>   the Pair screen tries it before showing anyone a form. The response's
>   `branch_id` wins over the one we ask with — the device row is authoritative.
> - **§4.1: no version gating exists**, so that was not the trigger. Their
>   reconstruction matches our own §1: a cold credential read sent no
>   `Authorization` header, they answered `401 POS_AUTH_MISSING`, and the old
>   interceptor unpaired on it. They also asked us to honour `Retry-After` on
>   the shared 60/min per-IP throttle, which `sync:run` now does.
> - **§4.2: tokens never expire, but the 14-day killswitch will lock a till
>   that comes back from a holiday.** No client change — the value is
>   per-device and a branch closing for a season should have it raised first.
>
> **Still open on our side:** their catalogue is at v1.3.0 / 65 entries and we
> have only taken the six codes this work needed. The rest is unreconciled.

---

## 1. What we already fixed on the client

The bug was ours. `configureApi`'s axios response interceptor answered **every**
401 and 403 by deleting the device token and blanking `device_id` — so a single
rejected request permanently unpaired the till, whatever the rejection actually
meant. The first sync after an update was enough to trigger it.

Shipping now:

- A 401/403 destroys nothing. The token and `device_id` survive.
- Only a **positive revoke** unpairs, via `markDeviceRevoked()`, which keeps the
  local catalog and the unsynced outbox (per §6.4 of `BACKEND-QUESTIONS.md`).
- The keychain read is retried, and both credential stores are consulted, so a
  cold read cannot make a paired till look unpaired.

That closes the reported incident. It also means the client's behaviour now
hangs entirely on being able to tell a revoke from a glitch — which is §2.

---

## 2. BLOCKER — how do we recognise a revoked device?

`classifyAuthFailure()` currently decides like this:

```ts
// 401 or 403 only
if (/DEVICE_REVOKED/i.test(body.code) || /revoked/i.test(body.message))
  return 'revoked';      // unpair, send the till to the Pair screen
return 'unauthorized';   // keep the pairing, keep retrying
```

Both failure modes are bad and both are yours to prevent:

- If a **genuinely revoked** device does *not* get the word `revoked`, that till
  retries forever and never tells the shop why it stopped syncing.
- If a **transient** 401 *does* carry the word `revoked`, we unpair a healthy
  till — the exact bug we just fixed, reintroduced from your side.

### 2.1 Please fill this in

For each case, the status and the **exact** body you send today:

| # | Situation | HTTP | `code` | `message` (verbatim) |
|---|---|---|---|---|
| a | Admin deactivates / revokes the device | ? | ? | ? |
| b | Token expired or rotated | ? | ? | ? |
| c | Token is valid but belongs to another device | ? | ? | ? |
| d | Token is garbage / malformed | ? | ? | ? |
| e | Valid token, device asks for the wrong branch | ? | ? | ? |
| f | Device locked by admin | 423 | ? | (confirmed already) |
| g | Killswitch / offline too long | 423 | ? | (confirmed already) |

Only **(a)** may unpair. Everything else must be survivable.

### 2.2 The clean fix: send `code`

This is §7.1 of `BACKEND-QUESTIONS.md`, still open. `classifyServerError()`
checks `response.data.code` **first** and a recognised code wins outright over
any message matching. Adding `"code": "POS_DEVICE_REVOKED"` to case (a) — and
the matching code to the rest — deletes the `contains('revoked')` guesswork
permanently. The full catalogue is `docs/pos-errors.json`; 27 codes are already
marked as yours to send.

It is additive; nothing on our side needs to change to receive it.

---

## 3. FEATURE — `POST /api/pos/reclaim`

### 3.1 The problem

The pairing is three values in two stores on the till:

| value | stored in |
|---|---|
| `server.base_url`, `device_id`, `branch_id` | `pos.db` (SQLite, in `%APPDATA%\POS App`) |
| `device_token` | Windows Credential Manager, DPAPI-encrypted per Windows user |

Lose **either** store and the device is unpaired. There is no path back except
a human reading a fresh pair code out of the back office and typing it at the
till — during service, on the busiest day, by whoever is standing there.

But at that moment the till usually still knows exactly who it is: `device_id`
and a stable `machine_id` are both sitting in `pos.db`. We already send
`machine_id` to you at `/register`. Nothing consumes it afterwards.

### 3.2 Proposed endpoint

```http
POST /api/pos/reclaim
X-App-Version: 0.4.24
X-Pos-Version: 0.4.24
Content-Type: application/json

{ "device_id": "01M04N3EAFAPRYZDR79F778ZH5",
  "machine_id": "7f8769a3…",      // sha256, stable per physical machine
  "branch_id": 7 }
```

No `Authorization` header — the whole point is that we no longer have a token.

**200** — same envelope as `/register`, so we can reuse the client code:

```json
{ "device": { "id": "…", "branch_id": 7, "locked_at": null,
              "killswitch_after_days": 14 },
  "token": "…" }
```

**Rules we need enforced:**

| Condition | Response |
|---|---|
| `machine_id` does not match the one recorded at `/register` | **403**, no token — this is the whole security property |
| Device revoked / deactivated | **401** with the revoke `code` from §2 |
| Device locked | **423** with `locked_at` — we keep the pairing and stay locked |
| Device unknown | **404** |
| Otherwise | **200**, issue a fresh token and **invalidate the previous one** |

### 3.3 Read this before you build it

`/reclaim` as specified above **weakens the current security model**, and you
should decide deliberately whether that trade is acceptable.

Today, `device_id` and `machine_id` both live in `pos.db` — a plain SQLite file,
readable by anyone who can copy it off the machine. The token does *not*: it is
in Credential Manager, encrypted by Windows to that specific user account. So
right now, **copying `pos.db` gets an attacker nothing.**

Add `/reclaim` keyed on those two values and copying `pos.db` becomes enough to
mint a valid device token for a real till.

We are not asking you to accept that silently. Mitigations worth considering,
roughly in order of how much they cost you:

1. **Rate-limit hard** — one reclaim per device per day, and alert on the second.
2. **Audit it** — write every reclaim to a log the branch manager actually sees,
   with timestamp, IP and app version. A reclaim the shop did not expect is then
   visible rather than silent.
3. **Invalidate the old token** on every reclaim, so a stolen copy and the real
   till cannot both be live — the shop notices immediately when its till stops.
4. **Per-branch toggle**, defaulting to off for anyone who does not want it.
5. **Back-office arming** — a reclaim returns `202 pending` and only issues a
   token once someone approves it in the dashboard. Safest, but it puts a human
   back in the loop, which is the thing we were trying to remove. Reasonable as
   the behaviour for a device whose `machine_id` has *changed*.

Our recommendation is 1–4 together: it removes the pair-code-during-service
problem, and an attacker who can already copy files off a till's disk has
easier routes than this one.

If you would rather not take that trade at all, say so and we will keep the
manual pair code — the client fix in §1 already stops the incident that started
this, and §2 alone is enough to close it out.

---

## 4. Confirmations

**4.1 Version gating — most likely trigger.** Every authenticated request now
carries `X-App-Version` and `X-Pos-Version`. Does any middleware reject an
unrecognised or too-old version with **401 or 403**? If so that is almost
certainly what fired on the first sync after the installer ran, and it would
have unpaired the till under the old client. If you gate on version, please use
**426** or a 403 carrying a distinct `code`, never a bare 401.

**4.2 Do device tokens expire?** TTL, rotation policy, or non-expiring? A till
can be switched off over a holiday and come back after two weeks.

**4.3 Is a token bound to `machine_id`?** If the same `device_id` pairs again
from a different machine, is the previous token invalidated?

**4.4 What does `/register` do when a `machine_id` we have already seen pairs
again** — new device row, or reuse of the existing one?

---

## Appendix — everything the POS calls

Base URL is `{server.base_url}/api/pos`.

| Method | Path | Auth |
|---|---|---|
| POST | `/register` | none (pair code) |
| POST | `/reclaim` | none — **proposed, §3** |
| GET | `/time` | Bearer |
| GET | `/bootstrap` | Bearer |
| POST | `/pull` | Bearer |
| POST | `/push` | Bearer |
| GET | `/orders/{id}` | Bearer |

Headers on every authenticated request:

```
Authorization: Bearer <device_token>
X-Pos-Device:  <device_id>
X-App-Version: <semver, no leading v>
X-Pos-Version: <same>
```

`/register` request body: `{ code, branch_id, name, machine_id, app_version }`.
