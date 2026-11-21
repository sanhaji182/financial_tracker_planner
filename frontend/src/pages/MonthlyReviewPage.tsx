import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, AlertTriangle, CheckCircle2, Circle, SkipForward, Loader2 } from 'lucide-react';
import reviewService, { type MonthlyReview, type SuggestedAction } from '../services/review';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/authStore';
import { MoneyDisplay } from '../components/ui/MoneyDisplay';
import { CardSkeleton } from '../components/ui/Skeleton';

export const MonthlyReviewPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';
  const currentMonth = new Date().toISOString().substring(0, 7);

  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<MonthlyReview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (m = month) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await reviewService.getMonthly(m);
      setData(res);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal memuat monthly review');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const setStatus = async (itemId: string, status: string) => {
    if (!isOwner) return;
    setBusyId(itemId);
    try {
      await reviewService.updateItem(itemId, status, month);
      await load(month);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal update item');
    } finally {
      setBusyId(null);
    }
  };

  const goAction = (a: SuggestedAction) => {
    if (a.action_url) navigate(a.action_url);
  };

  if (isLoading && !data) {
    return (
      <div className="space-y-6 p-6 max-w-5xl mx-auto">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ClipboardCheck className="w-7 h-7 text-indigo-600" aria-hidden="true" />
            Review Bulanan
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Checklist + aksi reversibel —{' '}
            <span className="font-mono">{data?.formula_version || 'behavioral-v1'}</span>
          </p>
        </div>
        <label className="text-sm">
          <span className="sr-only">Pilih bulan</span>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
          />
        </label>
      </header>

      {errorMsg && (
        <div role="alert" className="flex items-start gap-2 p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <p className="text-sm">{errorMsg}</p>
        </div>
      )}

      {data && (
        <>
          <Card className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm text-slate-500">Progress checklist wajib</p>
                <p className="text-2xl font-bold mt-1">
                  {data.completed_count}/{data.total_required}{' '}
                  <span className="text-base font-medium text-slate-500">({data.progress_pct}%)</span>
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300 mt-2">{data.summary}</p>
              </div>
              <div
                className="w-full sm:w-48 h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
                role="progressbar"
                aria-valuenow={data.progress_pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Progress review bulanan"
              >
                <div
                  className="h-full bg-indigo-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, data.progress_pct))}%` }}
                />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold mb-3">Checklist</h2>
            <ul className="space-y-3" aria-label="Checklist review bulanan">
              {data.checklist.map((it) => {
                const done = it.status === 'done' || it.status === 'skipped';
                return (
                  <li
                    key={it.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl border border-slate-100 dark:border-slate-800"
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {done ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {it.title}
                          {it.required ? (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-rose-600">wajib</span>
                          ) : null}
                        </p>
                        <p className="text-sm text-slate-500">{it.description}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {it.category} · status: {it.status}
                        </p>
                      </div>
                    </div>
                    {isOwner && (
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {it.action_url && (
                          <Button type="button" variant="secondary" onClick={() => navigate(it.action_url!)}>
                            Buka
                          </Button>
                        )}
                        <Button
                          type="button"
                          disabled={busyId === it.id}
                          onClick={() => setStatus(it.id, 'done')}
                          className="inline-flex items-center gap-1"
                        >
                          {busyId === it.id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          Selesai
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busyId === it.id}
                          onClick={() => setStatus(it.id, 'skipped')}
                          className="inline-flex items-center gap-1"
                        >
                          <SkipForward className="w-3 h-3" aria-hidden="true" /> Lewati
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-semibold mb-3">Suggested actions</h2>
            {data.suggested_actions.length === 0 ? (
              <p className="text-sm text-slate-500">Tidak ada aksi tertunda — bagus.</p>
            ) : (
              <ul className="space-y-3" aria-label="Usulan aksi">
                {data.suggested_actions.map((a) => (
                  <li
                    key={a.id}
                    className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">
                        {a.title}{' '}
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">{a.severity}</span>
                        {a.is_reversible ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-600">reversible</span>
                        ) : null}
                      </p>
                      <p className="text-sm text-slate-500">{a.rationale}</p>
                      {a.amount ? (
                        <p className="text-xs mt-1">
                          Amount: <MoneyDisplay value={a.amount} />
                        </p>
                      ) : null}
                    </div>
                    <Button type="button" onClick={() => goAction(a)}>
                      {a.confirm_label || 'Buka'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {data.disclaimer && (
            <p className="text-xs text-slate-500" role="note">
              {data.disclaimer}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default MonthlyReviewPage;
