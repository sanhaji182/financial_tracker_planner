import React from 'react';
import { reportClientError } from '../../utils/telemetry';
import { Button } from '../ui/Button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Terjadi kesalahan antarmuka yang tidak terduga.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void reportClientError(error, {
      source: 'react.ErrorBoundary',
      metadata: { componentStack: info?.componentStack?.slice(0, 600) },
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-rose-200 dark:border-rose-900/50 bg-white dark:bg-slate-900 p-6 text-center shadow-lg space-y-4">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                Ups, Tampilan Mengalami Kendala
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Laporan diagnostik telah dicatat secara aman. Anda dapat memuat ulang halaman ini.
              </p>
              {this.state.errorMessage && (
                <p className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-2 text-[11px] font-mono text-rose-600 dark:text-rose-300 break-words">
                  {this.state.errorMessage}
                </p>
              )}
            </div>
            <div className="flex justify-center gap-2">
              <Button type="button" onClick={this.handleReset}>
                <RefreshCw className="w-4 h-4" />
                Coba Lagi
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => window.location.assign('/')}
              >
                Ke Beranda
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
