import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@heroui/react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n';
import { describeError } from '../utils/posError';

/** The till actions a manager can approve. Mirrors the main process. */
export type ApprovalAction =
  | 'void_sent_line'
  | 'force_close_table'
  | 'cancel_sent_order'
  | 'mark_unpaid';

/** Sent back to the main process with the retried action. */
export type Approval = { code: string; reason: string | null };

type Run<T> = (approval?: Approval) => Promise<T>;

/**
 * Run a guarded action. When the cashier holds the permission it simply
 * happens. When they do not, the main process answers POS_APPROVAL_REQUIRED and
 * the Manager approval dialog opens; the same action is retried with the code.
 * Resolves with the action's result, or null when the dialog is cancelled.
 */
type ApproveFn = <T>(action: ApprovalAction, run: Run<T>) => Promise<T | null>;

const ApprovalContext = createContext<ApproveFn | null>(null);

export function useApproval(): ApproveFn {
  const ctx = useContext(ApprovalContext);
  if (!ctx) throw new Error('useApproval must be used inside ApprovalProvider');
  return ctx;
}

/** Refusals the dialog shows in place, keeping itself open for another code. */
const IN_DIALOG = new Set([
  'POS_APPROVAL_CODE_WRONG',
  'POS_APPROVAL_LOCKED',
  'POS_APPROVAL_NOT_ALLOWED',
  'POS_APPROVAL_NO_APPROVERS',
  'POS_APPROVAL_REQUIRED',
]);

const ACTION_LABEL: Record<ApprovalAction, StringKey> = {
  void_sent_line: 'approval.action.void_sent_line',
  force_close_table: 'approval.action.force_close_table',
  cancel_sent_order: 'approval.action.cancel_sent_order',
  mark_unpaid: 'approval.action.mark_unpaid',
};

const REASONS: StringKey[] = [
  'approval.reason.wrongItem',
  'approval.reason.changedMind',
  'approval.reason.customerLeft',
];

type Pending = {
  action: ApprovalAction;
  run: Run<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; message: string } | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  const approve = useCallback<ApproveFn>(async (action, run) => {
    try {
      return await run();
    } catch (e) {
      if (describeError(e, 'en').code !== 'POS_APPROVAL_REQUIRED') throw e;
    }
    return new Promise((resolve, reject) => {
      setCode('');
      setReason('');
      setProblem(null);
      setPending({ action, run: run as Run<unknown>, resolve: resolve as any, reject });
    });
  }, []);

  const close = (result: unknown = null) => {
    pending?.resolve(result);
    setPending(null);
  };

  const submit = async () => {
    if (!pending || busy) return;
    const digits = code.replace(/\D/g, '');
    if (!digits) {
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await pending.run({ code: digits, reason: reason.trim() || null });
      close(result);
    } catch (e) {
      const d = describeError(e, lang);
      if (IN_DIALOG.has(d.code)) {
        // Stay open: a wrong or locked code is fixed here, not in a toast.
        setProblem({ title: d.title, message: d.message });
        setCode('');
        setTimeout(() => codeRef.current?.focus(), 0);
      } else {
        // Anything else is the action's own failure; the caller reports it.
        pending.reject(e);
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo(() => approve, [approve]);

  return (
    <ApprovalContext.Provider value={value}>
      {children}

      <Modal
        isOpen={!!pending}
        onOpenChange={(open) => !open && !busy && close(null)}
        size='md'
        placement='center'
        backdrop='opaque'
        scrollBehavior='inside'
        classNames={{
          wrapper: 'p-2 sm:p-4',
          base: 'ui-popup !rounded-[24px] m-0 w-full max-h-[calc(100dvh-2rem)]',
          backdrop: 'bg-black/50',
        }}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className='flex items-center gap-3'>
                <span className='inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--st-amber)] text-white'>
                  <ShieldCheck className='h-5 w-5' strokeWidth={1.8} />
                </span>
                <div className='flex min-w-0 flex-col'>
                  <span className='text-lg font-semibold ink'>
                    {t('approval.title')}
                  </span>
                  {pending && (
                    <span className='text-sm font-medium ink-2'>
                      {t(ACTION_LABEL[pending.action])}
                    </span>
                  )}
                </div>
              </ModalHeader>
              <ModalBody className='gap-4 overflow-y-auto'>
                {/* A manager card is a barcode of the same six digits; a
                    scanner types them and presses Enter, so the field submits
                    on Enter just like typing it. */}
                <Input
                  ref={codeRef}
                  autoFocus
                  type='password'
                  inputMode='numeric'
                  autoComplete='off'
                  maxLength={6}
                  label={t('approval.code')}
                  labelPlacement='outside'
                  placeholder='••••••'
                  description={t('approval.codeHint')}
                  value={code}
                  onValueChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit();
                  }}
                  isDisabled={busy}
                  classNames={{ inputWrapper: 'ui-input min-h-12', input: 'text-center text-xl tracking-[0.5em] money' }}
                />

                <div className='space-y-2'>
                  <Input
                    label={t('approval.reasonLabel')}
                    labelPlacement='outside'
                    placeholder={t('approval.reasonPlaceholder')}
                    value={reason}
                    onValueChange={setReason}
                    isDisabled={busy}
                    classNames={{ inputWrapper: 'ui-input' }}
                  />
                  <div className='flex flex-wrap gap-2'>
                    {REASONS.map((key) => (
                      <Chip
                        key={key}
                        variant={reason === t(key) ? 'solid' : 'bordered'}
                        color={reason === t(key) ? 'primary' : 'default'}
                        className='min-h-8 cursor-pointer'
                        onClick={() => setReason(t(key))}
                      >
                        {t(key)}
                      </Chip>
                    ))}
                  </div>
                </div>

                {problem && (
                  <div className='ui-notice'>
                    <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-[var(--st-red)]' strokeWidth={1.8} />
                    <div className='min-w-0'>
                      <p className='text-sm font-semibold text-[var(--st-red)]'>{problem.title}</p>
                      <p className='text-sm font-medium ink'>{problem.message}</p>
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter className='flex flex-wrap justify-end gap-2 border-t border-line'>
                <Button
                  variant='bordered'
                  size='lg'
                  className='rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                  onPress={() => close(null)}
                  isDisabled={busy}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  color='primary'
                  size='lg'
                  className='rounded-[13px] font-semibold'
                  onPress={() => void submit()}
                  isLoading={busy}
                  isDisabled={code.length === 0}
                >
                  {t('approval.approve')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </ApprovalContext.Provider>
  );
}
