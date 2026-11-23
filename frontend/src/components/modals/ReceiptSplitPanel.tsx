import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Layers, Plus, Split, Trash2, Users } from 'lucide-react';
import type { Category } from '../../services/categories';
import type { ParsedOCRItem } from '../../services/transactions';
import {
  buildCategorySplitLines,
  calculateSocialSplitBill,
  suggestCategoryForItem,
  type TransactionSplitPayloadItem,
} from '../../utils/receiptSplit';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { toast } from '../../stores/useToastStore';

interface ReceiptSplitPanelProps {
  items: ParsedOCRItem[];
  receiptTotal: number;
  merchantName: string;
  categories: Category[];
  defaultCategoryId: string;
  canMutate: boolean;
  isSubmitting?: boolean;
  onConfirmWithSplits: (splits: TransactionSplitPayloadItem[]) => Promise<void>;
  onApplyMyShare: (myShareAmount: number, summaryNote: string) => void;
}

export const ReceiptSplitPanel: React.FC<ReceiptSplitPanelProps> = ({
  items,
  receiptTotal,
  merchantName,
  categories,
  defaultCategoryId,
  canMutate,
  isSubmitting = false,
  onConfirmWithSplits,
  onApplyMyShare,
}) => {
  const [activeTab, setActiveTab] = useState<'category' | 'social'>('category');
  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories]
  );

  // Per-item category mapping
  const [itemCategories, setItemCategories] = useState<Record<number, string>>({});
  useEffect(() => {
    const initial: Record<number, string> = {};
    items.forEach((it, idx) => {
      initial[idx] =
        suggestCategoryForItem(it.name, categories) ||
        defaultCategoryId ||
        expenseCategories[0]?.id ||
        '';
    });
    setItemCategories(initial);
  }, [items, categories, defaultCategoryId, expenseCategories]);

  // Patungan / Social split state
  const [participants, setParticipants] = useState<string[]>(['Saya', 'Pasangan']);
  const [newParticipant, setNewParticipant] = useState('');
  const [itemAssignees, setItemAssignees] = useState<Record<number, string[]>>({});
  const [taxPct, setTaxPct] = useState('10');
  const [servicePct, setServicePct] = useState('0');
  const [qrisNote, setQrisNote] = useState('');

  useEffect(() => {
    const initial: Record<number, string[]> = {};
    items.forEach((_, idx) => {
      initial[idx] = [...participants];
    });
    setItemAssignees(initial);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const splitLines = useMemo(
    () =>
      buildCategorySplitLines(
        items.map((it, idx) => ({
          name: it.name,
          total: it.total,
          category_id: itemCategories[idx] || defaultCategoryId,
        })),
        receiptTotal,
        defaultCategoryId || expenseCategories[0]?.id || ''
      ),
    [defaultCategoryId, expenseCategories, itemCategories, items, receiptTotal]
  );

  const distinctCategoryCount = splitLines.length;

  const socialResult = useMemo(
    () =>
      calculateSocialSplitBill({
        items: items.map((it, idx) => ({
          name: it.name,
          total: it.total,
          assignedTo: itemAssignees[idx] || participants,
        })),
        participants,
        taxPct: Number(taxPct) || 0,
        servicePct: Number(servicePct) || 0,
        merchantName,
        qrisNote,
      }),
    [itemAssignees, items, merchantName, participants, qrisNote, servicePct, taxPct]
  );

  const handleAddParticipant = () => {
    const trimmed = newParticipant.trim();
    if (!trimmed) return;
    if (participants.includes(trimmed)) {
      toast.info('Nama peserta sudah ada');
      return;
    }
    setParticipants((prev) => [...prev, trimmed]);
    setNewParticipant('');
  };

  const handleRemoveParticipant = (name: string) => {
    if (participants.length <= 1 || name === 'Saya') return;
    setParticipants((prev) => prev.filter((p) => p !== name));
  };

  const toggleItemAssignee = (idx: number, participant: string) => {
    setItemAssignees((prev) => {
      const current = prev[idx] || participants;
      const exists = current.includes(participant);
      const updated = exists
        ? current.filter((p) => p !== participant)
        : [...current, participant];
      return {
        ...prev,
        [idx]: updated.length > 0 ? updated : [participant],
      };
    });
  };

  const handleCopyShareText = async () => {
    try {
      await navigator.clipboard.writeText(socialResult.shareText);
      toast.success('Rincian patungan disalin untuk WhatsApp');
    } catch {
      toast.info('Salin teks tagihan di bawah secara manual');
    }
  };

  const myShare = socialResult.shares.find((s) => s.name === 'Saya')?.total ?? socialResult.grandTotal;

  return (
    <Card
      title="Pecah Struk & Patungan QRIS"
      subtitle="Bagi item struk ke banyak kategori atau hitung patungan otomatis dengan teman/pasangan."
      extra={
        <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('category')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'category'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Pecah per Kategori
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('social')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'social'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Patungan / Split-Bill
          </button>
        </div>
      }
    >
      {activeTab === 'category' ? (
        <div className="space-y-4">
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {items.map((item, idx) => (
              <div key={idx} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                    {item.name}
                  </p>
                  <p className="text-slate-400">
                    {item.quantity}x • Rp {item.total.toLocaleString('id-ID')}
                  </p>
                </div>
                <select
                  aria-label={`Kategori item ${item.name}`}
                  value={itemCategories[idx] || ''}
                  onChange={(e) =>
                    setItemCategories((prev) => ({ ...prev, [idx]: e.target.value }))
                  }
                  className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs text-slate-900 dark:text-white"
                >
                  <option value="">Pilih Kategori...</option>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-indigo-50/60 dark:bg-indigo-950/20 border border-indigo-200/70 dark:border-indigo-900/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950 dark:text-indigo-200">
                Ringkasan Split ({distinctCategoryCount} Kategori)
              </span>
              <Badge variant={distinctCategoryCount >= 2 ? 'success' : 'info'}>
                Total Rp {splitLines.reduce((s, l) => s + l.amount, 0).toLocaleString('id-ID')}
              </Badge>
            </div>
            <div className="space-y-1 text-xs">
              {splitLines.map((line, i) => {
                const catName =
                  expenseCategories.find((c) => c.id === line.category_id)?.name || 'Kategori';
                return (
                  <div key={i} className="flex justify-between text-slate-700 dark:text-slate-300">
                    <span>
                      <strong>{catName}</strong> — {line.description}
                    </span>
                    <span className="font-money font-semibold">
                      Rp {line.amount.toLocaleString('id-ID')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {canMutate && (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={isSubmitting || splitLines.length === 0}
                onClick={() => void onConfirmWithSplits(splitLines)}
              >
                <Split className="w-3.5 h-3.5" />
                Simpan sebagai Transaksi Split
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
              Peserta Patungan
            </label>
            <div className="flex flex-wrap gap-1.5">
              {participants.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
                >
                  {p}
                  {p !== 'Saya' && participants.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveParticipant(p)}
                      aria-label={`Hapus peserta ${p}`}
                      className="text-indigo-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newParticipant}
                onChange={(e) => setNewParticipant(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddParticipant();
                  }
                }}
                placeholder="Tambah nama teman (mis. Budi)"
                className="flex-1 h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs"
              />
              <Button type="button" size="sm" variant="secondary" onClick={handleAddParticipant}>
                <Plus className="w-3.5 h-3.5" />
                Tambah
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 block mb-1">PB1 / Pajak (%)</label>
              <input
                type="number"
                value={taxPct}
                onChange={(e) => setTaxPct(e.target.value)}
                className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 block mb-1">Service (%)</label>
              <input
                type="number"
                value={servicePct}
                onChange={(e) => setServicePct(e.target.value)}
                className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 block mb-1">Info QRIS / Rek</label>
              <input
                type="text"
                value={qrisNote}
                onChange={(e) => setQrisNote(e.target.value)}
                placeholder="BCA / GoPay"
                className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {items.map((item, idx) => {
              const current = itemAssignees[idx] || participants;
              return (
                <div key={idx} className="py-2 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {item.name}
                    </span>
                    <span className="font-money font-semibold">
                      Rp {item.total.toLocaleString('id-ID')}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {participants.map((p) => {
                      const active = current.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => toggleItemAssignee(idx, p)}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                            active
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200/80 dark:border-emerald-900/40 p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between font-bold text-emerald-900 dark:text-emerald-200">
              <span>Rincian Patungan per Orang</span>
              <span>Total: Rp {socialResult.grandTotal.toLocaleString('id-ID')}</span>
            </div>
            {socialResult.shares.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-slate-700 dark:text-slate-200">
                <span>
                  {s.name} <span className="text-slate-400">(PB1+Srv: Rp {s.taxAndService.toLocaleString('id-ID')})</span>
                </span>
                <span className="font-money font-bold">Rp {s.total.toLocaleString('id-ID')}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopyShareText()}>
              <Copy className="w-3.5 h-3.5" />
              Salin Tagihan WhatsApp
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onApplyMyShare(
                  myShare,
                  `Patungan ${merchantName || 'Struk'} (Total tagihan Rp ${socialResult.grandTotal.toLocaleString('id-ID')})`
                );
                toast.success(`Nominal form diubah ke porsi Saya (Rp ${myShare.toLocaleString('id-ID')})`);
              }}
            >
              <Check className="w-3.5 h-3.5" />
              Catat Porsi Saya Saja
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
