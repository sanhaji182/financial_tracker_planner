import React, { useState } from 'react';
import {
  BellOff,
  CheckCheck,
  Trash2,
  AlertTriangle,
  Info,
  XCircle,
  ExternalLink,
  Filter,
} from 'lucide-react';
import { useAlerts } from '../hooks/useAlerts';
import type { Alert, AlertSeverity } from '../services/alerts';
import { useNavigate } from 'react-router-dom';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { toast } from '../stores/useToastStore';

type FilterTab = 'all' | 'unread' | 'danger' | 'warning' | 'info';

const severityConfig: Record<
  AlertSeverity,
  { icon: React.ReactNode; bg: string; border: string; text: string; badgeVariant: 'danger' | 'warning' | 'info' }
> = {
  danger: {
    icon: <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />,
    bg: 'bg-rose-50/70 dark:bg-rose-500/10',
    border: 'border-rose-200 dark:border-rose-500/25',
    text: 'text-rose-800 dark:text-rose-300',
    badgeVariant: 'danger',
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
    bg: 'bg-amber-50/70 dark:bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-500/25',
    text: 'text-amber-800 dark:text-amber-300',
    badgeVariant: 'warning',
  },
  info: {
    icon: <Info className="h-5 w-5 text-sky-600 dark:text-sky-400" />,
    bg: 'bg-sky-50/70 dark:bg-sky-500/10',
    border: 'border-sky-200 dark:border-sky-500/25',
    text: 'text-sky-800 dark:text-sky-300',
    badgeVariant: 'info',
  },
};

const typeLabels: Record<string, string> = {
  bill_overdue: 'Tagihan Jatuh Tempo',
  forecast_negative: 'Proyeksi Negatif',
  ef_low: 'Dana Darurat Rendah',
  bill_due_h1: 'Tagihan H-1',
  bill_due_h3: 'Tagihan H-3',
  budget_over: 'Budget Melebihi',
  budget_near_limit: 'Budget Mendekati Limit',
  subscription_renewal: 'Pembaruan Langganan',
};

function AlertCard({
  alert,
  onMarkRead,
  onDismiss,
}: {
  alert: Alert;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const navigate = useNavigate();
  const cfg = severityConfig[alert.severity];

  const handleActionClick = () => {
    if (!alert.is_read) onMarkRead(alert.id);
    if (alert.action_url) navigate(alert.action_url);
  };

  return (
    <div
      className={`rounded-2xl border p-4 transition-all duration-200 shadow-[var(--shadow-card)] ${
        alert.is_read
          ? 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
          : `${cfg.bg} ${cfg.border}`
      }`}
      onClick={() => !alert.is_read && onMarkRead(alert.id)}
      style={{ cursor: alert.is_read ? 'default' : 'pointer' }}
    >
      <div className="flex items-start gap-3.5">
        <div className={`shrink-0 mt-0.5 rounded-xl p-2 ${cfg.bg}`}>{cfg.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`font-display text-sm font-bold ${
                  alert.is_read ? 'text-slate-900 dark:text-white' : cfg.text
                }`}
              >
                {alert.title}
              </span>
              {!alert.is_read && (
                <span className="h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400 shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {alert.action_url && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleActionClick();
                  }}
                  className="text-xs font-medium px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-300 text-slate-700 dark:text-slate-200 flex items-center gap-1 transition-colors"
                >
                  {alert.action_label || 'Lihat'} <ExternalLink className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(alert.id);
                  toast.info('Notifikasi dihapus');
                }}
                className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-slate-400 hover:text-rose-600 transition-colors"
                title="Hapus notifikasi"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
            {alert.message}
          </p>

          <div className="flex items-center gap-2.5 mt-2.5">
            <Badge variant={cfg.badgeVariant}>
              {typeLabels[alert.type] || alert.type}
            </Badge>
            <span className="text-xs text-slate-400">{alert.time_ago}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AlertCenterPage() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  const filters = {
    severity: ['danger', 'warning', 'info'].includes(activeFilter) ? activeFilter : undefined,
    unread: activeFilter === 'unread',
  };

  const { data, isLoading, error, markAsRead, markAllAsRead, dismissAlert } = useAlerts(filters);
  const alerts = data?.alerts || [];

  const filterTabs: { key: FilterTab; label: string; icon?: React.ReactNode }[] = [
    { key: 'all', label: 'Semua' },
    { key: 'unread', label: 'Belum Dibaca' },
    { key: 'danger', label: 'Bahaya', icon: <XCircle className="h-3.5 w-3.5" /> },
    { key: 'warning', label: 'Peringatan', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    { key: 'info', label: 'Info', icon: <Info className="h-3.5 w-3.5" /> },
  ];

  const handleMarkAllRead = () => {
    void markAllAsRead();
    toast.success('Semua notifikasi ditandai dibaca');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Alert Center"
        subtitle={
          data?.unread_count
            ? `${data.unread_count} notifikasi belum dibaca`
            : 'Semua notifikasi telah terbaca'
        }
        actions={
          (data?.unread_count ?? 0) > 0 && (
            <Button variant="secondary" onClick={handleMarkAllRead}>
              <CheckCheck className="h-4 w-4" />
              Tandai Semua Dibaca
            </Button>
          )
        }
      />

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-slate-400" />
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveFilter(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeFilter === tab.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-indigo-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10 p-8 text-center">
          <XCircle className="h-10 w-10 text-rose-500 mx-auto mb-3" />
          <p className="text-rose-700 dark:text-rose-300 font-medium">{error}</p>
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          title="Tidak ada notifikasi"
          description={
            activeFilter === 'unread'
              ? 'Semua notifikasi sudah dibaca.'
              : 'Tidak ada peringatan keuangan saat ini.'
          }
          icon={BellOff}
        />
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onMarkRead={markAsRead}
              onDismiss={dismissAlert}
            />
          ))}
        </div>
      )}
    </div>
  );
}
