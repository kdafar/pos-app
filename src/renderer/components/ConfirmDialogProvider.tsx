import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from '@heroui/react';
import { AlertTriangle, Info } from 'lucide-react';
import { useI18n } from '../i18n';

type ConfirmTone = 'default' | 'danger' | 'success';

type ConfirmOptions = {
  title?: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  hideCancel?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmFn | null>(null);

export function useConfirmDialog(): ConfirmFn {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error(
      'useConfirmDialog must be used inside ConfirmDialogProvider'
    );
  }
  return ctx;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({});
  const [resolver, setResolver] = useState<(value: boolean) => void>(
    () => () => {}
  );

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      setOptions(opts);
      setResolver(() => resolve);
      setOpen(true);
    });
  }, []);

  const handleClose = (result: boolean) => {
    setOpen(false);
    resolver(result);
  };

  const value = useMemo(() => confirm, [confirm]);

  const tone = options.tone ?? 'default';

  const confirmColor =
    tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : 'primary';

  const Icon = tone === 'danger' ? AlertTriangle : Info;

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}

      <Modal
        isOpen={open}
        onOpenChange={(isOpen) => !isOpen && handleClose(false)}
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
                {/* Tone follows the action: a delete confirm should not wear
                    the same colour as "are you sure you want to continue".
                    A solid status disc, never a tinted fill. */}
                <span
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full
                    ${
                      confirmColor === 'danger'
                        ? 'bg-[var(--st-red)] text-white'
                        : confirmColor === 'success'
                        ? 'bg-[var(--st-green)] text-white'
                        : 'bg-[var(--brand)] text-[var(--brand-ink)]'
                    }`}
                >
                  <Icon className='w-5 h-5' strokeWidth={1.8} />
                </span>
                <span className='min-w-0 text-lg font-semibold ink'>
                  {options.title ?? t('confirm.title')}
                </span>
              </ModalHeader>
              <ModalBody className='overflow-y-auto text-sm font-medium ink'>
                {options.message ?? t('confirm.message')}
              </ModalBody>
              <ModalFooter className='flex flex-wrap justify-end gap-2 border-t border-line'>
                {!options.hideCancel && (
                  <Button
                    variant='bordered'
                    size='lg'
                    className='rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface)] font-semibold'
                    onPress={() => handleClose(false)}
                  >
                    {options.cancelLabel ?? t('common.cancel')}
                  </Button>
                )}
                <Button
                  color={confirmColor}
                  size='lg'
                  className='rounded-[13px] font-semibold'
                  // A risky confirm carries the warning icon, so it never reads
                  // as a main button on a shop whose brand colour is red too.
                  startContent={
                    tone === 'danger' ? <Icon className='w-5 h-5' strokeWidth={1.8} /> : undefined
                  }
                  onPress={() => handleClose(true)}
                >
                  {options.confirmLabel ?? t('confirm.ok')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </ConfirmDialogContext.Provider>
  );
}
