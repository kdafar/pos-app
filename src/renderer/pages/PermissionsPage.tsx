import { useEffect, useMemo, useState } from 'react';
import { Button, Spinner, Switch } from '@heroui/react';
import { AlertTriangle, CheckCircle2, Info, Lock, RotateCcw, Save, ShieldCheck, Users } from 'lucide-react';
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

  const roleCount = (item: Role) =>
    item.role === selected && !locked ? allowed.size : item.permissions.length;

  const applyDefaults = () => {
    setAllowed(new Set(defaults));
    setSaved(false);
  };

  const notices = role ? (
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
            <AlertTriangle size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 text-[var(--st-amber)]' />
            <span>{t('permissions.localOnly')}</span>
          </div>
          {role.is_own_role && (
            <div className='ui-notice px-4 py-3 text-sm'>
              <Lock size={18} strokeWidth={1.8} className='mt-0.5 shrink-0 ink-2' />
              <span>{t('permissions.ownRoleReadOnly')}</span>
            </div>
          )}
        </>
      )}
    </>
  ) : null;

  return (
    <PageShell title={t('permissions.title')} subtitle={t('permissions.subtitle')}>
      <div className='mx-auto max-w-6xl'>
        {busy && !role ? (
          <div className='flex justify-center py-16'>
            <Spinner />
          </div>
        ) : !role ? (
          <div className='rounded-[20px] border border-dashed border-line-strong p-6 text-center text-sm ink-2'>
            {t('permissions.noRoles')}
          </div>
        ) : (
          <div className='grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start'>
            {/* Role picker: scrolling segmented control on small screens... */}
            <div className='min-w-0 lg:hidden'>
              <p className='mb-1.5 text-xs font-semibold uppercase tracking-wide ink-2'>
                {t('permissions.selectRole')}
              </p>
              <div className='chip-scroll overflow-x-auto'>
                <div className='ui-seg' role='group' aria-label={t('permissions.selectRole')}>
                  {roles.map((item) => (
                    <button
                      key={item.role}
                      type='button'
                      aria-pressed={item.role === selected}
                      className='ui-seg-item capitalize'
                      onClick={() => choose(item.role)}
                    >
                      {roleLabel(item.role)}
                      <span className='ui-count'>{roleCount(item)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ...and a list of selectable rows beside the role on large ones. */}
            <nav
              aria-label={t('permissions.selectRole')}
              className='ui-card hidden min-w-0 p-2 lg:sticky lg:top-0 lg:block'
            >
              <p className='px-3 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wide ink-2'>
                {t('permissions.selectRole')}
              </p>
              <div className='space-y-1'>
                {roles.map((item) => (
                  <button
                    key={item.role}
                    type='button'
                    aria-current={item.role === selected ? 'page' : undefined}
                    className='ui-nav flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start'
                    onClick={() => choose(item.role)}
                  >
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm font-semibold capitalize'>
                        {roleLabel(item.role)}
                        {item.is_own_role ? ' — ' + t('permissions.yourRole') : ''}
                      </span>
                      <span className='block truncate text-xs opacity-80'>
                        {item.users.length
                          ? t('permissions.appliesTo', { n: item.users.length })
                          : t('permissions.appliesToNobody')}
                      </span>
                    </span>
                    <span className='ui-count'>{roleCount(item)}</span>
                  </button>
                ))}
              </div>
            </nav>

            <div className='min-w-0 space-y-4'>
              {/* Role header: who this actually changes. The point of moving
                  off per-user permissions is that the blast radius is
                  visible before saving. */}
              <div className='ui-card space-y-3 p-4 sm:p-5'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <div className='flex min-w-0 items-center gap-3'>
                    <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 ink-2'>
                      <ShieldCheck size={22} strokeWidth={1.8} />
                    </div>
                    <div className='min-w-0'>
                      <h2 className='truncate text-xl font-semibold capitalize'>{roleLabel(role.role)}</h2>
                      <p className='truncate text-sm ink-2'>
                        {role.users.length
                          ? t('permissions.appliesTo', { n: role.users.length })
                          : t('permissions.appliesToNobody')}
                      </p>
                    </div>
                  </div>
                  <span className='ui-chip ui-chip-brand'>
                    {t('permissions.enabled', {
                      allowed: allowed.size,
                      total: PERMISSIONS.length,
                    })}
                  </span>
                </div>
                {role.users.length > 0 && (
                  <div>
                    <div className='mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ink-2'>
                      <Users size={16} strokeWidth={1.8} />
                      {t('permissions.membersLabel')}
                    </div>
                    <div className='flex flex-wrap gap-1.5'>
                      {role.users.map((u) => (
                        <span key={u.id} className='ui-chip ui-chip-outline'>
                          {u.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {notices && <div className='space-y-2'>{notices}</div>}
              </div>

              {GROUPS.map((group) => {
                const on = group.keys.filter((k) => allowed.has(k)).length;
                return (
                  <section key={group.title} className='ui-card min-w-0 p-3 sm:p-4'>
                    <div className='mb-2 flex flex-wrap items-start justify-between gap-2 px-1 sm:px-2'>
                      <div className='min-w-0'>
                        <h2 className='text-xs font-semibold uppercase tracking-wide ink-2'>{t(group.title)}</h2>
                        <p className='mt-0.5 text-xs ink-3'>{t(group.help)}</p>
                      </div>
                      <span className='ui-chip ui-chip-outline'>
                        {t('permissions.enabled', { allowed: on, total: group.keys.length })}
                      </span>
                    </div>
                    <div className='divide-y divide-[var(--line)]'>
                      {group.keys.map((key) => {
                        const label = t(('permissions.' + key) as StringKey);
                        return (
                          <label
                            key={key}
                            className={
                              'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[11px] px-2 py-2.5 sm:px-3 ' +
                              (locked
                                ? 'cursor-default opacity-60'
                                : 'cursor-pointer hover:bg-[var(--hover)]')
                            }
                          >
                            <span className='min-w-0 flex-1 text-sm font-medium'>{label}</span>
                            {locked && <Lock size={14} strokeWidth={1.8} className='shrink-0 ink-3' />}
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
                );
              })}

              {/* Opaque save bar while there is something to save (or just
                  saved); otherwise the current-state text sits quietly. */}
              {changed || saved ? (
                <div className='sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-t-[16px] border-t border-line bg-surface p-3 shadow-[var(--shadow-2)] sm:p-4'>
                  {saved ? (
                    <span className='flex items-center gap-2 text-sm font-medium text-success'>
                      <CheckCircle2 size={17} strokeWidth={1.8} />
                      {t('permissions.saved')}
                    </span>
                  ) : (
                    <span className='text-sm font-medium'>{t('permissions.unsaved')}</span>
                  )}
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      variant='bordered'
                      size='lg'
                      className='border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                      isDisabled={locked}
                      startContent={<RotateCcw size={16} strokeWidth={1.8} />}
                      onPress={applyDefaults}
                    >
                      {t('permissions.defaults')}
                    </Button>
                    <Button
                      color='primary'
                      size='lg'
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
              ) : (
                <div className='flex flex-wrap items-center justify-between gap-2 px-1'>
                  <span className='text-sm ink-2'>{t('permissions.current')}</span>
                  <Button
                    variant='bordered'
                    size='lg'
                    className='border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                    isDisabled={locked}
                    startContent={<RotateCcw size={16} strokeWidth={1.8} />}
                    onPress={applyDefaults}
                  >
                    {t('permissions.defaults')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}
