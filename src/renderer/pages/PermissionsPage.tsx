import { useEffect, useMemo, useState } from 'react';
import { Autocomplete, Button, Checkbox, Chip, SelectItem, Spinner } from '@heroui/react';
import { CheckCircle2, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { PageShell } from '../components/PageShell';
import { PERMISSIONS, rolePermissions } from '../../shared/permissions';
import { useI18n, type StringKey } from '../i18n';

type User = { id: number; name: string; email?: string; role?: string; is_self?: boolean; permissions: string[] };
const GROUPS = [
  { title: 'permissions.group.orders' as StringKey, help: 'permissions.group.ordersHelp' as StringKey, keys: PERMISSIONS.filter((p) => p.startsWith('orders.')) },
  { title: 'permissions.group.reports' as StringKey, help: 'permissions.group.reportsHelp' as StringKey, keys: PERMISSIONS.filter((p) => p.startsWith('reports.')) },
  { title: 'permissions.group.setup' as StringKey, help: 'permissions.group.setupHelp' as StringKey, keys: ['catalog.manage', 'payments.manage', 'locations.manage', 'tables.manage'] },
  { title: 'permissions.group.system' as StringKey, help: 'permissions.group.systemHelp' as StringKey, keys: ['settings.manage', 'updates.manage', 'users.permissions'] },
];
export default function PermissionsPage() {
  const { t } = useI18n();
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState('');
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState(false);
  const user = users.find((item) => String(item.id) === selected);
  const defaults = useMemo(() => new Set(rolePermissions(user?.role)), [user?.role]);
  const changed = !!user && !user.is_self && (allowed.size !== user.permissions.length || user.permissions.some((p) => !allowed.has(p)));

  const choose = (id: string, source = users) => {
    const next = source.find((item) => String(item.id) === id);
    setSelected(id); setAllowed(new Set(next?.permissions || [])); setSaved(false);
  };
  const load = async () => {
    setBusy(true);
    try {
      const next = await window.api.invoke('permissions:listUsers') as User[];
      setUsers(next);
      const id = next.some((item) => String(item.id) === selected) ? selected : String(next[0]?.id || '');
      choose(id, next);
    } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, []);
  const toggle = (key: string, checked: boolean) => setAllowed((current) => {
    const next = new Set(current); checked ? next.add(key) : next.delete(key); setSaved(false); return next;
  });
  const save = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await window.api.invoke('permissions:setUser', user.id, [...allowed]);
      setUsers((all) => all.map((item) => item.id === user.id ? { ...item, permissions: result.permissions } : item));
      setAllowed(new Set(result.permissions)); setSaved(true);
    } finally { setBusy(false); }
  };

  return <PageShell title={t('permissions.title')} subtitle={t('permissions.subtitle')}>
    <div className='max-w-6xl space-y-4'>
      <div className='grid gap-4 rounded-xl border border-default-200 bg-content1 p-5 shadow-sm lg:grid-cols-2'>
        <Autocomplete label={t('permissions.selectUser')} placeholder={t('permissions.chooseOperator')} selectedKey={selected || null} menuTrigger='focus'
          onSelectionChange={(key) => choose(String(key || ''))}>
          {users.map((item) => <SelectItem key={String(item.id)} textValue={`${item.name} ${item.email || ''} ${item.role || ''}`}>{item.name} — {item.is_self ? t('permissions.currentAccount') : item.role || t('permissions.unknown')}</SelectItem>)}
        </Autocomplete>
        {user ? <div className='flex items-center justify-between gap-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3'>
          <div className='flex min-w-0 items-center gap-3'><div className='flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 font-bold text-primary'>{user.name.slice(0, 2).toUpperCase()}</div><div><p className='font-semibold'>{user.name}</p><p className='text-xs text-default-500'>{user.email || t('permissions.localUser')}</p></div></div>
          <div className='text-end'><Chip size='sm' color='primary' variant='flat'>{user.role || t('permissions.unknown')}</Chip><p className='mt-1 text-xs text-default-500'>{t('permissions.enabled', { allowed: allowed.size, total: PERMISSIONS.length })}</p></div>
        </div> : <div className='rounded-lg border border-dashed border-default-300 p-4 text-sm text-default-500'>{t('permissions.noUsers')}</div>}
      </div>

      {busy && !user ? <div className='flex justify-center py-16'><Spinner/></div> : user && <>
        {user.is_self && <div className='rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-default-700'>{t('permissions.selfReadOnly')}</div>}
        <div className='grid gap-4 lg:grid-cols-2'>{GROUPS.map((group) => <section key={group.title} className='rounded-xl border border-default-200 bg-content1 p-5 shadow-sm'>
          <div className='mb-3 flex justify-between'><div><h2 className='font-semibold'>{t(group.title)}</h2><p className='text-xs text-default-500'>{t(group.help)}</p></div><ShieldCheck size={19} className='text-primary'/></div>
          <div className='space-y-1'>{group.keys.map((key) => { const label = t(`permissions.${key}` as StringKey); return <label key={key} className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${user.is_self ? 'cursor-default opacity-70' : 'cursor-pointer hover:bg-default-100'}`}><span className='text-sm font-medium'>{label}</span><Checkbox aria-label={label} isDisabled={user.is_self} isSelected={allowed.has(key)} onValueChange={(checked) => toggle(key, checked)}/></label>; })}</div>
        </section>)}</div>
        <div className='sticky bottom-3 flex items-center justify-between rounded-xl border border-default-200 bg-content1/95 p-4 shadow-lg backdrop-blur'>
          {saved ? <span className='flex items-center gap-2 text-sm font-medium text-success'><CheckCircle2 size={17}/>{t('permissions.saved')}</span> : <span className='text-sm text-default-500'>{changed ? t('permissions.unsaved') : t('permissions.current')}</span>}
          <div className='flex gap-2'><Button variant='flat' isDisabled={user.is_self} startContent={<RotateCcw size={16}/>} onPress={() => { setAllowed(new Set(defaults)); setSaved(false); }}>{t('permissions.defaults')}</Button><Button color='primary' isDisabled={!changed || user.is_self} isLoading={busy} startContent={busy ? undefined : <Save size={16}/>} onPress={save}>{t('permissions.save')}</Button></div>
        </div>
      </>}
    </div>
  </PageShell>;
}
