import React, {
  createContext,
  useCallback,
  useContext,
  useState,
  ReactNode,
} from 'react';
import { Card, Button } from '@heroui/react';
import { useI18n } from '../i18n';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Info,
  AlertCircle,
} from 'lucide-react';

type ToastTone = 'info' | 'success' | 'warning' | 'danger';

type ToastOptions = {
  title?: string;
  message?: ReactNode;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastInternal = ToastOptions & { id: number };

type ToastFn = (options: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);

  // Safe fallback if provider is missing (e.g., different root / window)
  if (!ctx) {
    return () => {
      if ((import.meta as any)?.env?.MODE === 'development') {
        console.warn(
          '[ToastProvider] useToast called outside ToastProvider. Toast will be ignored.'
        );
      }
    };
  }

  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastInternal[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback<ToastFn>(
    ({ durationMs = 4000, ...opts }) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const toast: ToastInternal = { id, ...opts };
      setToasts((prev) => [...prev, toast]);

      if (durationMs > 0) {
        setTimeout(() => remove(id), durationMs);
      }
    },
    [remove]
  );

  const getToneStyles = (tone: ToastTone | undefined) => {
    switch (tone) {
      case 'success':
        return {
          icon: <CheckCircle2 className='w-4 h-4' />,
          badge: 'bg-success/15 text-success',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className='w-4 h-4' />,
          badge: 'bg-warning/15 text-warning',
        };
      case 'danger':
        return {
          icon: <AlertCircle className='w-4 h-4' />,
          badge: 'bg-danger/15 text-danger',
        };
      case 'info':
      default:
        return {
          icon: <Info className='w-4 h-4' />,
          badge: 'bg-primary/15 text-primary',
        };
    }
  };

  return (
    <ToastContext.Provider value={showToast}>
      {children}

      {/* Toast stack */}
      {/* Stack hugs the trailing edge: right in English, left in Arabic. */}
      <div className='pointer-events-none fixed top-4 ltr:right-4 rtl:left-4 z-[9999] flex flex-col gap-2'>
        {toasts.map((toast) => {
          const { icon, badge } = getToneStyles(toast.tone);
          return (
            <Card
              key={toast.id}
              className='pointer-events-auto w-80 shadow-xl border border-default-200 bg-content1'
            >
              <div className='flex items-start gap-3 px-3 py-2.5'>
                <div
                  className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full ${badge}`}
                >
                  {icon}
                </div>
                <div className='flex-1 min-w-0'>
                  {toast.title && (
                    <div className='text-sm font-bold text-foreground truncate'>
                      {toast.title}
                    </div>
                  )}
                  {toast.message && (
                    <div className='mt-0.5 text-xs font-medium text-default-700 break-words'>
                      {toast.message}
                    </div>
                  )}
                </div>
                <Button
                  isIconOnly
                  variant='light'
                  size='sm'
                  radius='full'
                  className='mt-[-2px]'
                  aria-label={t('toast.dismiss')}
                  onPress={() => remove(toast.id)}
                >
                  <X className='w-4 h-4 text-default-700' />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
