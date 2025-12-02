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
                <span className='inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-500'>
                  <Icon className='w-4 h-4' />
                </span>
                <span className='text-sm font-semibold'>
                  {options.title ?? 'Are you sure?'}
                </span>
              </ModalHeader>
              <ModalBody className='text-sm text-slate-700'>
                {options.message ?? 'Please confirm this action.'}
              </ModalBody>
              <ModalFooter className='flex justify-end gap-2'>
                {!options.hideCancel && (
                  <Button
                    variant='light'
                    size='sm'
                    onPress={() => handleClose(false)}
                  >
                    {options.cancelLabel ?? 'Cancel'}
                  </Button>
                )}
                <Button
                  color={confirmColor}
                  size='sm'
                  onPress={() => handleClose(true)}
                >
                  {options.confirmLabel ?? 'Confirm'}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </ConfirmDialogContext.Provider>
  );
}
