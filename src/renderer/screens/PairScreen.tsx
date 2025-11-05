// src/renderer/screens/PairScreen.tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Card, CardHeader, CardBody, CardFooter,
  Input, Button, Divider
} from '@heroui/react';
import { useNavigate } from 'react-router-dom';

export default function PairScreen() {
  const nav = useNavigate();

  const [baseUrl, setBaseUrl] = useState('');
  const [deviceName, setDeviceName] = useState('Main Counter POS');
  const [branchId, setBranchId] = useState('1');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const s = await window.pos.auth.status();
      if (s.paired) {
        nav('/login', { replace: true });
        return;
      }
      // Prefill if available
      if (s.base_url) setBaseUrl(s.base_url);
      if (s.branch_id) setBranchId(String(s.branch_id));
    })();
  }, [nav]);

  const disabled = useMemo(
    () => busy || !baseUrl.trim() || !deviceName.trim() || !branchId.trim() || !code.trim(),
    [busy, baseUrl, deviceName, branchId, code]
  );

  const handlePair = async () => {
    setErr(null);
    setBusy(true);
    try {
      await window.pos.auth.pair({
        baseUrl: baseUrl.trim(),
        pairCode: code.trim(),
        deviceName: deviceName.trim(),
        branchId: Number(branchId || 0),
      });
      try { await window.pos.sync.run?.(); } catch {}
      const s = await window.pos.auth.status();
      if (s.paired) nav('/login', { replace: true });
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
      await window.pos.auth.unpair();
      // reset form
      setBaseUrl('');
      setBranchId('1');
      setCode('');
      setDeviceName('Main Counter POS');
    } catch (e: any) {
      setErr(e?.message || 'Unpair failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4">
      <Card className="w-full max-w-xl shadow-xl">
        <CardHeader className="flex flex-col items-start gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Device Pairing</h1>
          <p className="text-sm text-default-500">Connect this POS to your server.</p>
        </CardHeader>

        <Divider />

        <CardBody className="grid gap-4">
          <Input
            label="Server Base URL"
            placeholder="https://your-server.com"
            value={baseUrl}
            onValueChange={setBaseUrl}
            isRequired
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Device Name"
              placeholder="Main Counter POS"
              value={deviceName}
              onValueChange={setDeviceName}
              isRequired
            />
            <Input
              label="Branch ID"
              placeholder="e.g. 5"
              value={branchId}
              onValueChange={setBranchId}
              type="number"
              isRequired
            />
          </div>
          <Input
            label="Pairing Code"
            placeholder="Code from server"
            value={code}
            onValueChange={setCode}
            isRequired
          />

          {err && <div className="text-sm text-danger-500">{err}</div>}
        </CardBody>

        <CardFooter className="flex items-center justify-between gap-3">
          <Button variant="flat" color="danger" onPress={handleUnpair} isDisabled={busy}>
            Unpair / Reset
          </Button>
          <Button color="primary" isDisabled={disabled} isLoading={busy} onPress={handlePair}>
            Pair Device
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
