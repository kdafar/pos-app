// src/renderer/screens/PairScreen.tsx
import { useEffect, useMemo, useState } from 'react';
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

export default function PairScreen() {
  const nav = useNavigate();

  const [baseUrl, setBaseUrl] = useState('');
  const [deviceName, setDeviceName] = useState('Main Counter POS');
  const [branchId, setBranchId] = useState('1');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await (window as any).pos.auth.status();
      if (s.paired) {
        nav('/login', { replace: true });
        return;
      }
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
        setErr('Device paired but status is not marked as paired yet.');
      }
    } catch (e: any) {
      setErr(e?.message || 'Pairing failed');
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
      setErr(e?.message || 'Unpair failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className='min-h-screen flex items-center justify-center bg-slate-100 px-4'>
      <Card className='w-full max-w-4xl shadow-2xl border border-slate-200 bg-white'>
        <CardHeader className='flex flex-col gap-1 md:flex-row md:items-center md:justify-between'>
          <BrandHeader
            title='Majestic POS'
            subtitle='Step 1 of 2 – Connect this device to your server'
            align='left'
          />

          <div className='text-[11px] text-slate-500'>
            Already paired?{' '}
            <button
              className='underline underline-offset-2 text-slate-800 hover:text-slate-900'
              onClick={() => nav('/login', { replace: true })}
            >
              Go to login
            </button>
          </div>
        </CardHeader>

        <Divider />

        <CardBody className='py-5'>
          <div className='grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
            {/* LEFT: FORM */}
            <div className='space-y-4'>
              <Input
                label='Server base URL'
                placeholder='https://restaurant.example.com'
                value={baseUrl}
                onValueChange={setBaseUrl}
                isRequired
                variant='bordered'
                size='lg'
                classNames={{
                  label: 'text-xs text-slate-600',
                  input: 'text-sm',
                }}
              />

              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <Input
                  label='Device name'
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
                  label='Branch ID'
                  placeholder='e.g. 5'
                  value={branchId}
                  onValueChange={setBranchId}
                  type='number'
                  isRequired
                  variant='bordered'
                  size='lg'
                  classNames={{
                    label: 'text-xs text-slate-600',
                    input: 'text-sm',
                  }}
                />
              </div>

              <Input
                label='Pairing code'
                placeholder='Code from server'
                value={code}
                onValueChange={setCode}
                isRequired
                variant='bordered'
                size='lg'
                classNames={{
                  label: 'text-xs text-slate-600',
                  input: 'text-sm tracking-[0.08em]',
                }}
              />

              {prefilled && !err && (
                <div className='text-[11px] text-emerald-600'>
                  We pre-filled server and branch from a previous pairing.
                  Confirm they look correct before pairing.
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
                How to pair this device
              </div>
              <ol className='list-decimal list-inside space-y-1'>
                <li>
                  On the web admin, open <b>POS devices</b> and click{' '}
                  <b>Pair new device</b>.
                </li>
                <li>
                  Copy the <b>Server base URL</b> and <b>Branch ID</b> shown
                  there and paste them on the left.
                </li>
                <li>
                  Enter the <b>Pairing code</b> generated by the server.
                </li>
                <li>
                  Press <b>Pair device</b>. If successful, you’ll be taken to
                  the login screen.
                </li>
              </ol>

              <div className='mt-2 border-t border-slate-200 pt-2 space-y-1'>
                <div className='font-semibold text-xs text-slate-900'>Tips</div>
                <ul className='list-disc list-inside space-y-1'>
                  <li>
                    Use a descriptive device name like <b>Counter #1</b> or{' '}
                    <b>Kitchen screen</b>.
                  </li>
                  <li>
                    If you move this machine to another branch, use{' '}
                    <b>Unpair / Reset</b> first, then pair again.
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
            Unpair / Reset
          </Button>
          <Button
            color='primary'
            isDisabled={disabled}
            isLoading={busy}
            onPress={handlePair}
            size='sm'
          >
            Pair device
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
