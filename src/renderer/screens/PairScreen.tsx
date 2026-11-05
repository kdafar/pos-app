// src/renderer/screens/PairScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { announceSynced } from '../utils/syncEvents';
import { Input, Button, Spinner } from '@heroui/react';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BrandHeader } from '../components/BrandHeader';
import { LanguageToggle } from '../components/LanguageToggle';
import { HelpButton } from '../help/HelpButton';
import { useI18n } from '../i18n';
import { unpairDevice, useConfirmUnpair } from '../components/useConfirmUnpair';

import { usePosError } from '../utils/posError';
import { AppVersion } from '../components/AppVersion';

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

/** What the server says this till turned out to be. */
type PairedAs = { branchId: string; branchName: string };

export default function PairScreen() {
  const nav = useNavigate();
  const { t } = useI18n();
  const describe = usePosError();
  const confirmUnpair = useConfirmUnpair();

  const [baseUrl, setBaseUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /**
   * The code, plus what actually failed in the words of whatever failed.
   *
   * Enrolment is done by whoever is setting the till up, not by a cashier
   * mid-service, so it is shown here outright rather than behind the
   * disclosure the toasts use — "The action did not go through. Try again."
   * tells that person nothing they can act on, and neither does "No connection
   * to the server" without saying which server. The translated sentence is
   * still the line above it; this is the one underneath, for reading down a
   * phone to support.
   */
  const [errTech, setErrTech] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [unpairedReason, setUnpairedReason] = useState<string | null>(null);
  /**
   * The branch this machine was last paired to, if any.
   *
   * Nobody types it any more — the code carries the branch — but the older
   * chain-wide codes are still live on the server and still read the request
   * field, so a till being re-paired with one keeps sending what it already
   * knew. A machine that has never paired sends nothing, and a chain-wide code
   * on it is answered POS_PAIR_BRANCH_INVALID: correct, because there is no
   * honest answer to "which branch" available at the counter.
   */
  const [knownBranchId, setKnownBranchId] = useState('');
  const [pairedAs, setPairedAs] = useState<PairedAs | null>(null);
  // Starts true so the pairing form never flashes up before the till has had
  // its chance to reconnect on its own.
  const [reclaiming, setReclaiming] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        let s = await (window as any).pos.auth.status();
        if (s.paired) {
          nav('/login', { replace: true });
          return;
        }

        /**
         * Before asking anyone for a code, let the till try to reconnect
         * itself. A device that lost only its token still knows its device_id
         * and the machine it paired from, and the server will trade those for
         * a new one — so the common case never reaches this form at all.
         *
         * Every refusal is survivable and simply falls through to it: the
         * branch may not have self-service re-pairing switched on, the
         * machine may have been replaced, or there may be no network.
         */
        const reclaimed = await (window as any).api
          .invoke('sync:reclaim')
          .catch(() => null);

        if (reclaimed?.ok) {
          // Best effort: a till that just got its key back should not sit on
          // a stale catalog, but a sync that fails must not trap it here.
          await (window as any).api.invoke('sync:run').catch(() => null);
          s = await (window as any).pos.auth.status();
          if (s.paired) {
            nav('/login', { replace: true });
            return;
          }
        }

        setUnpairedReason(s.unpaired_reason ?? null);
        // Remembered, not shown: it is only the legacy request field's value.
        if (s.branch_id) setKnownBranchId(String(s.branch_id));
        if (s.base_url) {
          setBaseUrl(s.base_url);
          setPrefilled(true);
        }
      } finally {
        setReclaiming(false);
      }
    })();
  }, [nav]);

  const disabled = useMemo(
    () => busy || !baseUrl.trim() || !code.trim(),
    [busy, baseUrl, code]
  );

  /** One place that decides what an error puts on screen. */
  const showError = (e: unknown) => {
    const d = describe(e);
    setErr(
      d.message.startsWith(d.title) ? d.message : `${d.title} — ${d.message}`
    );
    setErrTech(d.detail ? `${d.code}: ${d.detail}` : null);
  };

  const clearError = () => {
    setErr(null);
    setErrTech(null);
  };

  const handlePair = async () => {
    clearError();
    setBusy(true);
    try {
      const base = baseUrl.trim();
      // Sent exactly as typed apart from the surrounding spaces. The server
      // accepts either case and treats the dash as optional, and normalising
      // here would only risk mangling the older chain-wide codes, which are
      // not this shape and are still valid.
      const pair = code.trim();
      const branchNum = Number(knownBranchId || 0);

      // 1) Save base URL + branch in local KV (store)
      await (window as any).pos.auth.pair({
        baseUrl: base,
        pairCode: pair,
        branchId: branchNum,
      });

      // 2) Real pairing with the server → creates device, saves device_id + token via pairDevice()
      //
      //    No name goes up from here. The server names the till from the code
      //    it was issued under, and the main process fills the request field
      //    with what this machine already is — see resolveDeviceName().
      await (window as any).api.invoke(
        'sync:pair',
        base,
        pair,
        String(branchNum),
        ''
      );

      // 3) Bootstrap catalog and users
      await (window as any).api.invoke('sync:bootstrap', base);

      // 4) Optional: run full sync (incremental pull + push)
      await (window as any).api.invoke('sync:run');
      // The shop's colour (and anything else listening) now that its data is in.
      announceSynced();

      // 5) Check status, then say which shop this till turned out to belong to.
      //
      //    Read back from the server's answer, never from anything typed on
      //    this screen — that is the whole point of the change. Two shops once
      //    spent five days filing each other's takings because the wrong
      //    branch was visible only in a report that looks the same when it is
      //    empty as when the shop is quiet.
      const s = await (window as any).pos.auth.status();
      if (s.paired) {
        setPairedAs({
          branchId: s.branch_id ? String(s.branch_id) : '',
          branchName: (s.branch_name || '').trim(),
        });
      } else {
        // in case something weird happens
        setErr(t('pair.notMarkedPaired'));
        setErrTech(null);
      }
    } catch (e: any) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Fill a field from the clipboard without a keystroke.
   *
   * Ctrl+V now works app-wide (the main process had never registered an
   * application menu, so Electron routed no clipboard accelerators at all),
   * but some of these PCs are locked down by whoever set them up and some
   * counters keep the keyboard out of reach behind the drawer. The button is
   * the way in that does not depend on either.
   */
  const pasteInto = async (set: (v: string) => void) => {
    clearError();
    const text: string = await (window as any).api
      .invoke('clipboard:readText')
      .catch(() => '');
    if (text) set(text.trim());
    else setErr(t('pair.pasteEmpty'));
  };

  /**
   * A small button that lives inside a field, so it reads as part of it.
   *
   * A function returning JSX rather than a nested component: a component
   * declared inside the render body is a new type on every keystroke, so React
   * would tear this one down and rebuild it as the code is typed — and the
   * field loses focus with it.
   */
  const pasteButton = (onPaste: () => void) => (
    <Button
      size='md'
      variant='bordered'
      onPress={onPaste}
      isDisabled={busy}
      className='min-w-0 border border-[var(--line-strong)] bg-[var(--surface)] px-3 -me-1 font-semibold'
    >
      {t('pair.paste')}
    </Button>
  );

  const handleUnpair = async () => {
    clearError();
    const choice = await confirmUnpair();
    if (!choice) return;
    setBusy(true);
    try {
      await unpairDevice(choice.wipe);
      // reset form
      setBaseUrl('');
      setCode('');
      setKnownBranchId('');
      setPairedAs(null);
      setPrefilled(false);
    } catch (e: any) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  // Same waiting card AuthedGate shows, so a till reconnecting on its own
  // looks like the app still starting up rather than a new screen appearing.
  if (reclaiming) {
    return (
      <div className='min-h-dvh flex items-center justify-center bg-canvas p-3 sm:p-4'>
        <div className='ui-card w-full max-w-md'>
          <div className='py-6 px-6 flex flex-col items-center gap-3 text-center'>
            <Spinner size='lg' color='primary' />
            <div className='text-base font-semibold ink'>
              {t('pair.reclaiming')}
            </div>
            <div className='text-xs ink-3 max-w-sm'>
              {t('pair.reclaimHint')}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Enrolled — now name the shop, and make someone look at it.
   *
   * This screen used to jump straight to the login form on success. A branch
   * name that flashes past on the way somewhere else has not been shown to
   * anyone, so this stop is deliberate: the name is the largest thing on the
   * card, and the way to correct it sits beside the way to accept it.
   */
  if (pairedAs) {
    const branch = pairedAs.branchName
      ? pairedAs.branchId
        ? `${pairedAs.branchName} (#${pairedAs.branchId})`
        : pairedAs.branchName
      : '';

    return (
      <div className='min-h-dvh flex items-center justify-center bg-canvas p-3 sm:p-4 lg:p-6'>
        <div className='ui-card w-full max-w-lg min-w-0'>
          <div className='flex flex-wrap items-center justify-between gap-3 border-b border-line p-4'>
            <BrandHeader
              title='Majestic POS'
              subtitle={t('pair.paired')}
              align='left'
            />
            <div className='flex items-center gap-2'>
              <LanguageToggle compact />
              <HelpButton />
            </div>
          </div>

          <div className='space-y-4 p-4 sm:py-6'>
            {branch ? (
              <>
                <div className='ui-notice items-center justify-center px-4 py-4 text-center text-lg'>
                  <CircleCheck
                    size={22}
                    strokeWidth={1.8}
                    className='shrink-0 text-success'
                  />
                  <span className='min-w-0 break-words'>
                    <Rich text={t('pair.branchConfirm', { branch })} />
                  </span>
                </div>
                <div className='text-xs ink-2'>
                  {t('pair.branchConfirmHint')}
                </div>
              </>
            ) : (
              // The name only arrives with the catalog, so a bootstrap that
              // failed leaves the id on its own. Still worth showing: it came
              // from the server too, and a number someone can check beats
              // saying nothing about where the money is going.
              <div className='ui-notice text-sm'>
                <TriangleAlert
                  size={18}
                  strokeWidth={1.8}
                  className='mt-0.5 shrink-0 text-warning'
                />
                <span className='min-w-0'>
                  {pairedAs.branchId ? (
                    <Rich
                      text={t('pair.branchIdOnly', { id: pairedAs.branchId })}
                    />
                  ) : (
                    t('pair.branchUnknown')
                  )}
                </span>
              </div>
            )}

            {err && (
              <div className='ui-notice text-sm' role='alert'>
                <TriangleAlert
                  size={18}
                  strokeWidth={1.8}
                  className='mt-0.5 shrink-0 text-danger'
                />
                <div className='min-w-0'>
                  <div>{err}</div>
                  {errTech && (
                    <div className='mt-1 break-all font-mono text-xs ink-3'>
                      {errTech}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className='flex flex-wrap items-center justify-between gap-3 border-t border-line p-4'>
            <Button
              variant='light'
              color='danger'
              onPress={handleUnpair}
              isDisabled={busy}
              size='md'
              className='font-semibold'
            >
              {t('auth.unpair')}
            </Button>
            <Button
              color='primary'
              onPress={() => nav('/login', { replace: true })}
              isDisabled={busy}
              size='lg'
              className='font-semibold'
            >
              {t('pair.continue')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-dvh flex items-center justify-center bg-canvas p-3 sm:p-4 lg:p-6'>
      <div className='ui-card w-full max-w-4xl min-w-0'>
        <div className='flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between lg:px-6'>
          <BrandHeader
            title='Majestic POS'
            subtitle={t('pair.subtitle')}
            align='left'
          />

          {/* No "go to login" here: this form only shows on an unpaired till,
              and a paired one is sent to login before it ever renders. */}
          <div className='flex items-center gap-2'>
            <LanguageToggle compact />
            <HelpButton />
          </div>
        </div>

        <div className='p-4 lg:p-6'>
          {unpairedReason === 'server_locked' && (
            <div className='ui-notice mb-4 text-sm' role='alert'>
              <TriangleAlert
                size={18}
                strokeWidth={1.8}
                className='mt-0.5 shrink-0 text-danger'
              />
              <span className='min-w-0'>
                <Rich text={t('pair.serverLocked')} />
              </span>
            </div>
          )}

          {unpairedReason === 'offline_too_long' && (
            <div className='ui-notice mb-4 text-sm' role='alert'>
              <TriangleAlert
                size={18}
                strokeWidth={1.8}
                className='mt-0.5 shrink-0 text-warning'
              />
              <span className='min-w-0'>
                <Rich text={t('pair.offlineTooLong')} />
              </span>
            </div>
          )}

          <div className='grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
            {/* LEFT: FORM */}
            <div className='min-w-0 space-y-4'>
              <Input
                label={t('pair.baseUrl')}
                placeholder='https://restaurant.example.com'
                value={baseUrl}
                onValueChange={setBaseUrl}
                isRequired
                variant='bordered'
                size='lg'
                dir='ltr'
                autoComplete='off'
                spellCheck='false'
                endContent={pasteButton(() => pasteInto(setBaseUrl))}
                classNames={{
                  inputWrapper: 'ui-input',
                  label: 'text-sm font-semibold',
                  input: 'text-sm text-start',
                }}
              />

              {/*
                Neither a branch nor a name is asked for here, on purpose. The
                code carries both, and a control that looks like it decides
                where the money lands but does not is worse than no control at
                all — that is exactly how two shops spent five days filing
                each other's takings.
              */}
              <Input
                label={t('pair.code')}
                placeholder={t('pair.codePlaceholder')}
                description={t('pair.codeHint')}
                value={code}
                // Spaces dropped wherever they land, not just at the ends. A
                // code read down a phone gets typed "42E8 QEET" about as often
                // as not, and no code in either scheme contains one. Case and
                // the dash are left exactly as typed — the server is relaxed
                // about both, and the older chain-wide codes are a different
                // shape that this screen has no business reformatting.
                onValueChange={(v) => setCode(v.replace(/\s+/g, ''))}
                isRequired
                variant='bordered'
                size='lg'
                dir='ltr'
                autoComplete='off'
                autoCorrect='off'
                spellCheck='false'
                endContent={pasteButton(() => pasteInto(setCode))}
                classNames={{
                  inputWrapper: 'ui-input',
                  label: 'text-sm font-semibold',
                  // Big, monospaced and widely spaced: this one gets typed by
                  // hand off a phone screen more often than it gets pasted.
                  input:
                    'text-lg font-mono tracking-[0.25em] uppercase text-start',
                  description: 'text-xs ink-3',
                }}
              />

              {prefilled && !err && (
                <div className='text-xs font-semibold text-success'>
                  {t('pair.prefilled')}
                </div>
              )}

              {err && (
                <div className='ui-notice text-sm' role='alert'>
                  <TriangleAlert
                    size={18}
                    strokeWidth={1.8}
                    className='mt-0.5 shrink-0 text-danger'
                  />
                  <div className='min-w-0'>
                    <div>{err}</div>
                    {/*
                      The status, the endpoint and the server's own sentence.
                      Collected in the main process, where they still exist —
                      none of it survives the IPC boundary on its own, and a till
                      has no DevTools open for anyone to find it in.
                    */}
                    {errTech && (
                      <div className='mt-1 break-all font-mono text-xs ink-3'>
                        {errTech}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT: HELP / STEPS */}
            <div className='min-w-0 space-y-2 rounded-2xl bg-surface-2 border border-line px-4 py-3 text-xs ink-2'>
              <div className='mb-1 text-xs font-semibold uppercase tracking-wide ink-2'>
                {t('pair.howTo')}
              </div>
              <ol className='space-y-2'>
                {(['pair.step1', 'pair.step2', 'pair.step3', 'pair.step4'] as const).map(
                  (k, i) => (
                    <li key={k} className='flex items-start gap-2.5'>
                      <span className='ui-count ui-chip-brand mt-0.5 shrink-0'>
                        {i + 1}
                      </span>
                      <span className='min-w-0 text-sm'>
                        <Rich text={t(k)} />
                      </span>
                    </li>
                  )
                )}
              </ol>

              <div className='mt-2 space-y-1 border-t border-line pt-2'>
                <div className='text-xs font-semibold uppercase tracking-wide ink-2'>
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
        </div>

        <div className='flex flex-wrap items-center justify-between gap-3 border-t border-line p-4 lg:px-6'>
          <Button
            variant='light'
            color='danger'
            onPress={handleUnpair}
            isDisabled={busy}
            size='md'
            className='font-semibold'
          >
            {t('auth.unpair')}
          </Button>
          <AppVersion />
          <Button
            color='primary'
            isDisabled={disabled}
            isLoading={busy}
            onPress={handlePair}
            size='lg'
            className='font-semibold'
          >
            {t('auth.pairDevice')}
          </Button>
        </div>
      </div>
    </div>
  );
}
