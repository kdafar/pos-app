# Order Portal restyle — questions for the operator

Branch `feat/portal-design`. Rules: [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md). Nothing below is
guessed into the app; each item is either left as it was or done the simplest way and listed here.

## Needs a decision

1. **Where does the restaurant's colour come from?** The till reads it from synced *settings
   rows* (`branding.theme_color`, then the older `branding.primary_color` keys). The brief says the
   server will add `branding.theme_color` to `GET /api/pos/bootstrap`. If it arrives as a
   top-level `branding: { … }` object rather than a settings row, the till ignores it today and a
   small main-process change is needed. Which shape will the server send?
2. **Default colour before the server sends one:** now `#17483e` (the brief's green). It used to be
   blue `#2563eb`. Your portal screenshot shows blue for Majestic, so tills that already have a
   colour keep theirs; tills with none would turn green. OK?
3. **Base text size on touch tills:** the brief sets the root to 15px on touch screens (the till
   was 16px). Everything gets about 6% smaller on a touch till; mouse PCs are unchanged. OK, or
   keep 16px?
4. **Text size choices:** the till already has Small / Normal / Large / Extra large. The brief
   asks for Normal / Large / Extra large. Keep the four?
5. **Phones (< 768px):** the brief suggests a top bar + bottom dock. The till now keeps the icon
   rail (76px) on phones. The bottom dock is a bigger layout change. Do Android phones need it?
6. **Money format:** the portal writes `KD 0.500`; the till writes `0.500` (with `د.ك` / KWD where
   it already did). Not changed, because it changes labels. Switch to the portal's format?
7. **Side menu header** now shows the restaurant's initial in a brand square, the branch name, and
   the signed-in person under it (was: the person only). OK?
8. **Mark paid button** is now the brand colour (primary action). It was green. Keep brand?
9. **"Collected" vs "Paid":** both are now solid green chips (no tinted chips allowed); they still
   differ by icon and word. Is that enough for cashiers?
10. **Order details** on the till is a centred window; the portal uses a side sheet. Switch?

## Not done yet (next checkpoints)

- Contrast check with a light brand colour (`#f89939`): run
  `node scripts/help-shots/design-review.cjs <dir> "#f89939"` and look at text on brand.
- A test that the colour from the server reaches `--brand` and is still used after a restart
  offline (brief §10). The colour is stored with the synced settings, so it already survives a
  restart; the test is not written yet.
- The A4 closing-report print template keeps its own colours (it is a printed document).
- The help screenshots (`npm run help:shots`) need re-taking once the design is approved.

## Small known issues

- Arabic table chips read `(4)1ط` instead of `ط1 (4)` (number order inside the chip). Looks older
  than this restyle; to check.
- Today's Orders "Update status" shows plain `open` for an order that was never placed
  (behaviour, unchanged).
