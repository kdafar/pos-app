/**
 * Fired on `window` after a sync completes, by whoever ran it.
 *
 * Screens that hold their own copy of synced data listen for it. The POS
 * screen loaded the menu once at sign-in, so a category, item or promo deleted
 * on the web stayed on screen all day even though the sync had already removed
 * it from the till's database.
 */
export const SYNCED_EVENT = 'pos:synced';

export const announceSynced = () => window.dispatchEvent(new Event(SYNCED_EVENT));
