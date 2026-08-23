// src/renderer/screens/PairScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Input,
  Button,
  Divider,
} from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import { BrandHeader } from '../components/BrandHeader';
import { LanguageToggle } from '../components/LanguageToggle';
import { useI18n } from '../i18n';

import { useErrorLine } from '../utils/posError';
/**
 * Renders `*emphasised*` runs of a translated string as <b>. Keeping the
 * markers inside the string lets the Arabic translation put the emphasis where
 * Arabic word order needs it instead of where English happened to put it.
 */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*]+\*)/g).map((part, i) =>
        part.length > 2 && part.startsWith('*') && part.endsWith('*') ? (
          <b key={i}>{part.slice(1, -1)}</b>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

export default function PairScreen() {
  const nav = useNavigate();
  const { t } = useI18n();
  const errLine = useErrorLine();

  const [baseUrl, setBaseUrl] = useState('');
  const [deviceName, setDeviceName] = useState('Main Counter POS');
  const [branchId, setBranchId] = useState('1');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [unpairedReason, setUnpairedReason] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const s = await (window as any).pos.auth.status();
      if (s.paired) {
        nav('/login', { replace: true });
        return;
      }
      setUnpairedReason(s.unpaired_reason ?? null);
      // Prefill if available
      let anyPrefilled = false;
      if (s.base_url) {
        setBaseUrl(s.base_url);
        anyPrefilled = true;
      }
      if (s.branch_id) {
        setBranchId(String(s.branch_id));
        anyPrefilled = true;
      }
      if (anyPrefilled) setPrefilled(true);
    })();
  }, [nav]);

  const disabled = useMemo(
    () =>
      busy ||
      !baseUrl.trim() ||
      !deviceName.trim() ||
      !branchId.trim() ||
      !code.trim(),
    [busy, baseUrl, deviceName, branchId, code]
  );

  const handlePair = async () => {
    setErr(null);
    setBusy(true);
    try {
      const base = baseUrl.trim();
      const pair = code.trim();
      const device = deviceName.trim();
      const branchNum = Number(branchId || 0);

      // 1) Save base URL + branch in local KV (store)
      await (window as any).pos.auth.pair({
        baseUrl: base,
        pairCode: pair,
        deviceName: device,
        branchId: branchNum,
      });

      // 2) Real pairing with the server → creates device, saves device_id + token via pairDevice()
      await (window as any).api.invoke(
        'sync:pair',
        base,
        pair,
        String(branchNum),
        device
      );

      // 3) Bootstrap catalog and users
      await (window as any).api.invoke('sync:bootstrap', base);

      // 4) Optional: run full sync (incremental pull + push)
      await (window as any).api.invoke('sync:run');

      // 5) Check status & go to login
      const s = await (window as any).pos.auth.status();
      if (s.paired) {
        nav('/login', { replace: true });
      } else {
        // in case something weird happens
        setErr(t('pair.notMarkedPaired'));
      }
    } catch (e: any) {
      setErr(errLine(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUnpair = async () => {
    setErr(null);
    setBusy(true);
    try {
      await (window as any).pos.auth.unpair();
      // reset form
      setBaseUrl('');
      setBranchId('1');
      setCode('');
      setDeviceName('Main Counter POS');
      setPrefilled(false);
    } catch (e: any) {
      setErr(errLine(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='light min-h-screen flex items-center justify-center bg-slate-100 px-4'>
      <Card className='w-full max-w-4xl shadow-2xl border border-slate-200 bg-white'>
        <CardHeader className='flex flex-col gap-1 md:flex-row md:items-center md:justify-between'>
          <BrandHeader
            title='Majestic POS'
            subtitle={t('pair.subtitle')}
            align='left'
          />

          <div className='flex items-center gap-3'>
            <LanguageToggle theme='light' compact />
            <div className='text-[11px] text-slate-500'>
              {t('pair.alreadyPaired')}{' '}
              <button
                className='underline underline-offset-2 text-slate-800 hover:text-slate-900'
                onClick={() => nav('/login', { replace: true })}
              >
                {t('auth.goToLogin')}
              </button>
            </div>
          </div>
        </CardHeader>

        <Divider />

        <CardBody className='py-5'>
          {unpairedReason === 'server_locked' && (
            <div className='mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2'>
              <Rich text={t('pair.serverLocked')} />
            </div>
          )}

          {unpairedReason === 'offline_too_long' && (
            <div className='mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2'>
              <Rich text={t('pair.offlineTooLong')} />
            </div>
          )}

          <div className='grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
            {/* LEFT: FORM */}
            <div className='space-y-4'>
              <Input
                label={t('pair.baseUrl')}
                placeholder='https://restaurant.example.com'
                value={baseUrl}
                onValueChange={setBaseUrl}
                isRequired
                variant='bordered'
                size='lg'
                dir='ltr'
                classNames={{
                  label: 'text-xs text-slate-600',
                  input: 'text-sm text-start',
                }}
              />

              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <Input
                  label={t('pair.deviceName')}
                  placeholder='Main Counter POS'
                  value={deviceName}
                  onValueChange={setDeviceName}
                  isRequired
                  variant='bordered'
                  size='lg'
                  classNames={{
                    label: 'text-xs text-slate-600',
                    input: 'text-sm',
                  }}
                />
                <Input
                  label={t('pair.branchIdLabel')}
                  placeholder={t('pair.branchIdPlaceholder')}
                  value={branchId}
                  onValueChange={setBranchId}
                  type='number'
                  isRequired
                  variant='bordered'
                  size='lg'
                  dir='ltr'
                  classNames={{
                    label: 'text-xs text-slate-600',
                    input: 'text-sm text-start',
                  }}
                />
              </div>

              <Input
                label={t('pair.code')}
                placeholder={t('pair.codePlaceholder')}
                value={code}
                onValueChange={setCode}
                isRequired
                variant='bordered'
                size='lg'
                dir='ltr'
                classNames={{
                  label: 'text-xs text-slate-600',
                  input: 'text-sm tracking-[0.08em] text-start',
                }}
              />

              {prefilled && !err && (
                <div className='text-[11px] text-emerald-600'>
                  {t('pair.prefilled')}
                </div>
              )}

              {err && (
                <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2'>
                  {err}
                </div>
              )}
            </div>

            {/* RIGHT: HELP / STEPS */}
            <div className='rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] text-slate-700 space-y-2'>
              <div className='font-semibold text-xs text-slate-900 mb-1'>
                {t('pair.howTo')}
              </div>
              <ol className='list-decimal list-inside space-y-1'>
                <li>
                  <Rich text={t('pair.step1')} />
                </li>
                <li>
                  <Rich text={t('pair.step2')} />
                </li>
                <li>
                  <Rich text={t('pair.step3')} />
                </li>
                <li>
                  <Rich text={t('pair.step4')} />
                </li>
              </ol>

              <div className='mt-2 border-t border-slate-200 pt-2 space-y-1'>
                <div className='font-semibold text-xs text-slate-900'>
                  {t('pair.tips')}
                </div>
                <ul className='list-disc list-inside space-y-1'>
                  <li>
                    <Rich text={t('pair.tip1')} />
                  </li>
                  <li>
                    <Rich text={t('pair.tip2')} />
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </CardBody>

        <CardFooter className='flex flex-wrap items-center justify-between gap-3 border-t border-slate-200'>
          <Button
            variant='flat'
            color='danger'
            onPress={handleUnpair}
            isDisabled={busy}
            size='sm'
          >
            {t('auth.unpair')}
          </Button>
          <Button
            color='primary'
            isDisabled={disabled}
            isLoading={busy}
            onPress={handlePair}
            size='sm'
          >
            {t('auth.pairDevice')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
