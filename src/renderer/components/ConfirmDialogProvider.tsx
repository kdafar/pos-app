import React, {
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
        backdrop='blur'
        className='rounded-2xl'
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className='flex items-center gap-3'>
                {/* Tone follows the action: a delete confirm should not wear
                    the same colour as "are you sure you want to continue".
                    bg-danger/15 was a light-theme tint that rendered as a white
                    disc on the dark theme. */}
                <span
                  className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full
                    ${
                      confirmColor === 'danger'
                        ? 'bg-danger/15 text-danger'
                        : confirmColor === 'success'
                        ? 'bg-success/15 text-success'
                        : 'bg-primary/15 text-primary'
                    }`}
                >
                  <Icon className='w-5 h-5' />
                </span>
                <span className='text-base font-bold text-foreground'>
                  {options.title ?? t('confirm.title')}
                </span>
              </ModalHeader>
              <ModalBody className='text-sm font-medium text-foreground'>
                {options.message ?? t('confirm.message')}
              </ModalBody>
              <ModalFooter className='flex justify-end gap-2'>
                {!options.hideCancel && (
                  <Button
                    variant='flat'
                    onPress={() => handleClose(false)}
                  >
                    {options.cancelLabel ?? t('common.cancel')}
                  </Button>
                )}
                <Button
                  color={confirmColor}
                  className='font-semibold'
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
