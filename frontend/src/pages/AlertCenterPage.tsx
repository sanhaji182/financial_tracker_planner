import React, { useState } from 'react';
import { Bell, BellOff, CheckCheck, Trash2, AlertTriangle, Info, XCircle, ExternalLink, Filter } from 'lucide-react';
import { useAlerts } from '../hooks/useAlerts';
import type { Alert, AlertSeverity } from '../services/alerts';
import { useNavigate } from 'react-router-dom';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

type FilterTab = 'all' | 'unread' | 'danger' | 'warning' | 'info';

const severityConfig: Record<AlertSeverity, { icon: React.ReactNode; bg: string; border: string; text: string; badge: string }> = {
  danger: {
    icon: <XCircle className="h-5 w-5 text-red-500 dark:text-red-400" />,
    bg: 'bg-red-50 dark:bg-red-500/10',
    border: 'border-red-200 dark:border-red-500/20',
    text: 'text-red-700 dark:text-red-400',
    badge: 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-500/30',
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5 text-amber-500 dark:text-amber-400" />,
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    border: 'border-amber-200 dark:border-amber-500/20',
    text: 'text-amber-700 dark:text-amber-400',
    badge: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30',
  },
  info: {
    icon: <Info className="h-5 w-5 text-blue-500 dark:text-blue-400" />,
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    border: 'border-blue-200 dark:border-blue-500/20',
    text: 'text-blue-700 dark:text-blue-400',
    badge: 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30',
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

function AlertCard({ alert, onMarkRead, onDismiss }: {
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
      className={`rounded-xl border p-4 transition-all duration-205 ${alert.is_read ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800' : `${cfg.bg} ${cfg.border}`}`}
      onClick={() => !alert.is_read && onMarkRead(alert.id)}
      style={{ cursor: alert.is_read ? 'default' : 'pointer' }}
    >
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 mt-0.5 rounded-full p-1.5 ${cfg.bg}`}>
          {cfg.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-bold ${cfg.text}`}>{alert.title}</span>
              {!alert.is_read && (
                <span className="h-2 w-2 rounded-full bg-blue-500 dark:bg-blue-400 flex-shrink-0 animate-pulse" />
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {alert.action_url && (
                <button
                  onClick={e => { e.stopPropagation(); handleActionClick(); }}
                  className="text-xs px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-slate-300 flex items-center gap-1 transition-colors"
                >
                  {alert.action_label || 'Lihat'} <ExternalLink className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={e => { e.stopPropagation(); onDismiss(alert.id); }}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 hover:text-red-500 transition-colors"
                title="Hapus"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <p className="text-sm text-slate-650 dark:text-slate-400 mt-1 leading-relaxed">{alert.message}</p>

          <div className="flex items-center gap-2 mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cfg.badge}`}>
              {typeLabels[alert.type] || alert.type}
            </span>
            <span className="text-xs text-slate-500">{alert.time_ago}</span>
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg">
            <Bell className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Alert Center</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {data?.unread_count ? `${data.unread_count} notifikasi belum dibaca` : 'Semua notifikasi terbaca'}
            </p>
          </div>
        </div>

        {(data?.unread_count ?? 0) > 0 && (
          <button
            onClick={() => markAllAsRead()}
            className="flex items-center gap-2 rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-sm text-slate-300 transition-colors"
          >
            <CheckCheck className="h-4 w-4" />
            Tandai Semua Dibaca
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-slate-500" />
        {filterTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
              activeFilter === tab.key
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20'
                : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300'
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
          {[1, 2, 3].map(i => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-8 text-center">
          <XCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-medium">{error}</p>
        </div>
      ) : alerts.length === 0 ? (
        <EmptyState
          title="Tidak ada notifikasi"
          description={activeFilter === 'unread' ? 'Semua notifikasi sudah dibaca.' : 'Tidak ada notifikasi saat ini.'}
          icon={BellOff}
        />
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => (
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
