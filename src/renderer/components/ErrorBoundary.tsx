// src/renderer/components/ErrorBoundary.tsx
//
// The last line. A render error used to take the whole window to a blank white
// screen with no way back — on a till, mid-queue, that is the worst possible
// failure. This keeps the frame, says what happened in the cashier's language,
// and gives them the one button that fixes it.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RotateCw } from 'lucide-react';
import { useI18n } from '../i18n';
import { stripIpcWrapper } from '../../shared/errors';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <CrashScreen
        error={this.state.error}
        onReset={() => this.setState({ error: null })}
      />
    );
  }
}

function CrashScreen({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useI18n();
  return (
    <div className='flex min-h-screen items-center justify-center bg-content1 p-6'>
      <div className='w-full max-w-xl rounded-2xl border border-danger/40 bg-danger/5 p-6 text-center'>
        <span className='mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-danger/15 text-danger'>
          <AlertOctagon className='h-7 w-7' />
        </span>
        <h1 className='text-xl font-bold text-foreground'>{t('error.crashTitle')}</h1>
        <p className='mt-2 text-base font-medium leading-relaxed text-default-700'>
          {t('error.crashMsg')}
        </p>

        <button
          type='button'
          onClick={() => {
            // Try re-rendering first; a reload is the fallback for a component
            // that crashes again immediately.
            onReset();
            window.setTimeout(() => window.location.reload(), 50);
          }}
          className='mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-base font-semibold text-primary-foreground hover:opacity-90'
        >
          <RotateCw className='h-4 w-4' />
          {t('error.reload')}
        </button>

        {/* English, LTR, small: this is for whoever is on the phone to support,
            not for the person serving the queue. */}
        <details className='mt-5 text-start'>
          <summary className='cursor-pointer text-sm font-semibold text-default-700'>
            {t('error.details')}
          </summary>
          <pre
            dir='ltr'
            className='mt-2 max-h-40 overflow-auto rounded-lg bg-default-100 p-3 text-start text-xs text-default-700'
          >
            {stripIpcWrapper(error.message || String(error))}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        </details>
      </div>
    </div>
  );
}
