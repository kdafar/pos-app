import { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Button, SelectItem, Spinner, Switch } from '@heroui/react';
import { AlertTriangle, CheckCircle2, Info, RotateCcw, Save, ShieldCheck, Users } from 'lucide-react';
import { PageShell } from '../components/PageShell';
import { PERMISSIONS } from '../../shared/permissions';
import { useI18n, type StringKey } from '../i18n';
import { useToast } from '../components/ToastProvider';

// Permissions are granted to a ROLE, and every user holding it inherits them.
// There is no per-user layer that can quietly contradict the role: granting a
// permission to one cashier and not to another doing the same job is exactly
// how this got mis-set in the field.
type Role = {
  role: string;
  permissions: string[];
  defaults: string[];
  users: Array<{ id: number; name: string }>;
  is_own_role?: boolean;
};

const GROUPS = [
  { title: 'permissions.group.orders' as StringKey, help: 'permissions.group.ordersHelp' as StringKey, keys: PERMISSIONS.filter((p) => p.startsWith('orders.')) },
  { title: 'permissions.group.reports' as StringKey, help: 'permissions.group.reportsHelp' as StringKey, keys: PERMISSIONS.filter((p) => p.startsWith('reports.')) },
  { title: 'permissions.group.setup' as StringKey, help: 'permissions.group.setupHelp' as StringKey, keys: ['catalog.manage', 'payments.manage', 'locations.manage', 'tables.manage', 'tables.force_close'] },
  { title: 'permissions.group.system' as StringKey, help: 'permissions.group.systemHelp' as StringKey, keys: ['settings.manage', 'updates.manage', 'users.permissions'] },
];

export default function PermissionsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  const [selected, setSelected] = useState('');
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState(false);
  /** The back office owns permissions for this estate; the till only shows them. */
  const [serverManaged, setServerManaged] = useState(false);

  const role = roles.find((item) => item.role === selected);
  // Two separate reasons a role cannot be edited here, and the notice below
  // distinguishes them: your own role (you would lock yourself out) and
  // server-managed (there is nothing to change on this machine).
  const locked = !!role?.is_own_role || serverManaged;
  const defaults = useMemo(() => new Set(role?.defaults || []), [role?.defaults]);
  const changed =
    !!role &&
    !locked &&
    (allowed.size !== role.permissions.length ||
      role.permissions.some((p) => !allowed.has(p)));

  const choose = (key: string, source = roles) => {
    const next = source.find((item) => item.role === key);
    setSelected(key);
    setAllowed(new Set(next?.permissions || []));
    setSaved(false);
  };

  const load = async () => {
    setBusy(true);
    try {
      // The handler used to answer with a bare array and now answers with
      // { roles, serverManaged }. Both shapes are accepted so a renderer and a
      // main process from different builds cannot leave the page empty.
      const resp = (await window.api.invoke('permissions:listRoles')) as
        | Role[]
        | { roles: Role[]; serverManaged?: boolean };
      const next = Array.isArray(resp) ? resp : resp?.roles ?? [];
      setServerManaged(!Array.isArray(resp) && !!resp?.serverManaged);
      setRoles(next);
      const key = next.some((item) => item.role === selected)
        ? selected
        : next[0]?.role || '';
      choose(key, next);
    } catch (e) {
      // Was silent: a denied invoke left an empty picker, which reads as
      // "there are no roles" rather than "you may not edit these".
      toast.error(e, { title: t('admin.loadFailed') });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggle = (key: string, checked: boolean) =>
    setAllowed((current) => {
      const next = new Set(current);
      checked ? next.add(key) : next.delete(key);
      setSaved(false);
      return next;
    });

  const save = async () => {
    if (!role) return;
    setBusy(true);
    try {
      const result = await window.api.invoke('permissions:setRole', role.role, [
        ...allowed,
      ]);
      setRoles((all) =>
        all.map((item) =>
          item.role === role.role
            ? { ...item, permissions: result.permissions }
            : item
        )
      );
      setAllowed(new Set(result.permissions));
      setSaved(true);
    } catch (e) {
      toast.error(e, { title: t('permissions.title') });
    } finally {
      setBusy(false);
    }
  };

  const roleLabel = (key: string) => key.replace(/_/g, ' ');

  return (
    <PageShell title={t('permissions.title')} subtitle={t('permissions.subtitle')}>
      <div className='mx-auto max-w-6xl space-y-4'>
        <div className='ui-card grid gap-4 p-4 sm:p-5 lg:grid-cols-2'>
          <Autocomplete
            label={t('permissions.selectRole')}
            placeholder={t('permissions.chooseRole')}
            selectedKey={selected || null}
            menuTrigger='focus'
            onSelectionChange={(key) => key && choose(String(key))}
          >
            {roles.map((item) => (
              <SelectItem key={item.role} textValue={item.role}>
                <span className='capitalize'>{roleLabel(item.role)}</span>
                {item.is_own_role ? ' — ' + t('permissions.yourRole') : ''}
              </SelectItem>
            ))}
          </Autocomplete>
          {role ? (
            <div className='flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 px-4 py-3'>
              <div className='flex min-w-0 items-center gap-3'>
                <div className='flex h-10 w-10 items-center justify-center rounded-full bg-surface ink-2 border border-line'>
                  <ShieldCheck size={20} strokeWidth={1.8} />
                </div>
                <div className='min-w-0'>
                  <p className='font-semibold capitalize'>{roleLabel(role.role)}</p>
                  <p className='truncate text-xs ink-2'>
                    {role.users.length
                      ? t('permissions.appliesTo', { n: role.users.length })
                      : t('permissions.appliesToNobody')}
                  </p>
                </div>
              </div>
              <div className='text-end'>
                <span className='ui-chip ui-chip-brand'>
                  {t('permissions.enabled', {
                    allowed: allowed.size,
                    total: PERMISSIONS.length,
                  })}
                </span>
              </div>
            </div>
          ) : (
            <div className='rounded-[20px] border border-dashed border-line-strong p-4 text-sm ink-2'>
              {t('permissions.noRoles')}
            </div>
          )}
        </div>

        {busy && !role ? (
          <div className='flex justify-center py-16'>
            <Spinner />
          </div>
        ) : (
          role && (
            <>
              {serverManaged ? (
                <div className='ui-notice px-4 py-3 text-sm'>
                  <Info size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 ink-2' />
                  <span>{t('permissions.serverManaged')}</span>
                </div>
              ) : (
                <>
                  {/* Stated plainly, because the opposite assumption — that
                      this reaches every till — is the one shops actually
                      make, and it is wrong until the back office owns them. */}
                  <div className='ui-notice px-4 py-3 text-sm'>
                    <AlertTriangle size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 text-warning' />
                    <span>{t('permissions.localOnly')}</span>
                  </div>
                  {role?.is_own_role && (
                    <div className='ui-notice px-4 py-3 text-sm'>
                      <Info size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 ink-2' />
                      <span>{t('permissions.ownRoleReadOnly')}</span>
                    </div>
                  )}
                </>
              )}

              {/* Who this actually changes. The point of moving off per-user
                  permissions is that the blast radius is visible before saving. */}
              {role.users.length > 0 && (
                <div className='ui-card p-4'>
                  <div className='mb-2 flex items-center gap-2 text-sm font-semibold'>
                    <Users size={16} strokeWidth={1.8} className='ink-2' />
                    {t('permissions.membersLabel')}
                  </div>
                  <div className='flex flex-wrap gap-1.5'>
                    {role.users.map((u) => (
                      <span key={u.id} className='ui-chip ui-chip-gray'>
                        {u.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className='grid gap-4 lg:grid-cols-2'>
                {GROUPS.map((group) => (
                  <section
                    key={group.title}
                    className='ui-card min-w-0 p-4 sm:p-5'
                  >
                    <div className='mb-3 flex justify-between gap-2'>
                      <div>
                        <h2 className='text-xs font-semibold uppercase tracking-wide ink-2'>{t(group.title)}</h2>
                        <p className='text-xs ink-3 mt-0.5'>{t(group.help)}</p>
                      </div>
                      <ShieldCheck size={19} strokeWidth={1.8} className='shrink-0 ink-3' />
                    </div>
                    <div className='space-y-1'>
                      {group.keys.map((key) => {
                        const label = t(('permissions.' + key) as StringKey);
                        return (
                          <label
                            key={key}
                            className={
                              'flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2.5 ' +
                              (locked
                                ? 'cursor-default opacity-70'
                                : 'cursor-pointer hover:bg-[var(--hover)]')
                            }
                          >
                            <span className='text-sm font-medium'>{label}</span>
                            <Switch
                              aria-label={label}
                              isDisabled={locked}
                              isSelected={allowed.has(key)}
                              onValueChange={(checked) => toggle(key, checked)}
                            />
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>

              <div className='ui-card sticky bottom-3 flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4 shadow-[var(--shadow-2)]'>
                {saved ? (
                  <span className='flex items-center gap-2 text-sm font-medium text-success'>
                    <CheckCircle2 size={17} strokeWidth={1.8} />
                    {t('permissions.saved')}
                  </span>
                ) : (
                  <span className='text-sm ink-2'>
                    {changed ? t('permissions.unsaved') : t('permissions.current')}
                  </span>
                )}
                <div className='flex gap-2'>
                  <Button
                    variant='bordered'
                    className='border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                    isDisabled={locked}
                    startContent={<RotateCcw size={16} strokeWidth={1.8} />}
                    onPress={() => {
                      setAllowed(new Set(defaults));
                      setSaved(false);
                    }}
                  >
                    {t('permissions.defaults')}
                  </Button>
                  <Button
                    color='primary'
                    className='font-semibold'
                    isDisabled={!changed || locked}
                    isLoading={busy}
                    startContent={busy ? undefined : <Save size={16} strokeWidth={1.8} />}
                    onPress={save}
                  >
                    {t('permissions.save')}
                  </Button>
                </div>
              </div>
            </>
          )
        )}
      </div>
    </PageShell>
  );
}
