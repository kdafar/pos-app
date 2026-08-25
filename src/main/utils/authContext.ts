// src/main/utils/authContext.ts
import { app } from 'electron';

/**
 * Permission lookups used to fall back to "full admin" whenever there was no
 * session, and again whenever the lookup itself threw. That meant an
 * unauthenticated caller could edit locked / printed / completed orders, and a
 * transient DB error escalated privileges instead of denying them.
 *
 * Permission checks must fail CLOSED. The permissive fallback survives for
 * local development only, where there is often no paired device or seeded user
 * to sign in as.
 *
 * Deliberately keyed off `app.isPackaged` rather than NODE_ENV: electron-vite
 * does not substitute NODE_ENV into the main bundle, so it is `undefined` in a
 * packaged build and every `process.env.NODE_ENV !== 'production'` check
 * silently evaluates true there.
 */
export function allowAnonymousAdmin(): boolean {
  try {
    return !app.isPackaged;
  } catch {
    // No app object (tests / odd context) — assume production and deny.
    return false;
  }
}

/**
 * Roles that may bypass order locks and see other operators' orders.
 * Defined alongside ROLE_DEFAULTS so the admin list and the permission table
 * can never disagree about what a role like `owner` is allowed to do.
 */
export { ADMIN_ROLES, isAdminRole } from '../../shared/permissions';
