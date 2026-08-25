import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * The one place the renderer asks "may this operator do X".
 *
 * Every page used to answer that for itself, and each answered it differently:
 * Recent Orders tested `role === 'admin' | 'manager' | 'owner'`, the POS store
 * tested a four-name list that omitted `owner` and `manager` entirely, and only
 * Layout actually read the permission list. The main process meanwhile enforces
 * one thing and one thing only — the permission — so any page asking about a
 * role was asking a question the handler would never be answering. Granting
 * `orders.change_status` to a cashier left the control disabled regardless.
 *
 * Ask for the permission the handler asserts, never for a role.
 */
export type PermissionUser = {
  id: string | number | null;
  name?: string | null;
  role?: string | null;
  is_admin?: boolean | number;
  branch_id?: string | number | null;
  permissions?: string[];
};

export function usePermissions() {
  const [user, setUser] = useState<PermissionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const who = (await window.api.invoke('auth:whoami')) as PermissionUser;
      setUser(who || null);
    } catch {
      // A failed lookup must not hand out rights. Empty permissions disable
      // every gated control, which is the safe direction — the main process
      // would refuse the call anyway, so this only stops a dead-looking button.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const granted = useMemo(
    () => new Set(user?.permissions ?? []),
    [user?.permissions]
  );

  const can = useCallback(
    (permission: string) => granted.has(permission),
    [granted]
  );

  const canAny = useCallback(
    (...permissions: string[]) => permissions.some((p) => granted.has(p)),
    [granted]
  );

  return { user, loading, can, canAny, reload, permissions: granted };
}
