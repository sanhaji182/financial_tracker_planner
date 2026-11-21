import React from 'react';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Route-scoped error boundary that isolates render crashes and recovers cleanly
 * when mounted with a route key or reset manually by the user.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoHome = (): void => {
    this.setState({ hasError: false, error: null });
    window.location.assign('/');
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="py-10 px-4 max-w-xl mx-auto">
        <Card className="p-7 text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-6 w-6" />
          </div>

          <div className="space-y-1.5">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Halaman mengalami kendala tampilan
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Terjadi kesalahan saat merender halaman ini. Anda dapat memuat ulang halaman atau
              berpindah ke menu lain tanpa kehilangan sesi login.
            </p>
          </div>

          {this.state.error?.message && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 text-left">
              <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300 break-words">
                {this.state.error.message}
              </p>
            </div>
          )}

          <div className="flex items-center justify-center gap-2.5 flex-wrap pt-1">
            <Button variant="secondary" onClick={this.handleReset}>
              <RefreshCw className="h-4 w-4" />
              Muat Ulang Halaman
            </Button>
            <Button onClick={this.handleGoHome}>
              <Home className="h-4 w-4" />
              Kembali ke Dashboard
            </Button>
          </div>
        </Card>
      </div>
    );
  }
}
