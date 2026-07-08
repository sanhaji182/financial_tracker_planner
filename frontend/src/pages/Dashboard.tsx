import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { TrendingUp, ArrowUpRight, ArrowDownRight, RefreshCw, Sparkles } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const simulateLoading = () => {
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Welcome Bar / F-pattern top-left */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary dark:text-white">
            Dashboard Keuangan
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Pantau arus kas, dana darurat, dan progres finansial keluarga Anda.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={simulateLoading} isLoading={isLoading}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Data
          </Button>
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            + Tambah Transaksi
          </Button>
        </div>
      </div>

      {/* Metric Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card
          title="Net Worth"
          extra={<Badge variant="success">Stabil</Badge>}
        >
          <div className="font-money text-2xl font-bold tracking-tight text-text-primary dark:text-white">
            Rp 312.450.000
          </div>
          <div className="flex items-center gap-1 text-xs text-emerald-600 mt-2 font-medium">
            <ArrowUpRight className="w-3.5 h-3.5" />
            <span>↑ 8.2% dari bulan lalu</span>
          </div>
        </Card>

        <Card
          title="Cash Tersedia"
          extra={<Badge variant="info">Likuid</Badge>}
        >
          <div className="font-money text-2xl font-bold tracking-tight text-text-primary dark:text-white">
            Rp 42.150.000
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-500 mt-2">
            <span>Tersebar di 3 bank & e-wallet</span>
          </div>
        </Card>

        <Card
          title="Total Utang"
          extra={<Badge variant="danger">DTI: 28%</Badge>}
        >
          <div className="font-money text-2xl font-bold tracking-tight text-text-primary dark:text-white">
            Rp 120.000.000
          </div>
          <div className="flex items-center gap-1 text-xs text-red-500 mt-2 font-medium">
            <ArrowDownRight className="w-3.5 h-3.5" />
            <span>↓ Rp 5.000.000 dari bulan lalu</span>
          </div>
        </Card>

        <Card
          title="Forecast Saldo Akhir"
          extra={<Badge variant="warning">Aman</Badge>}
        >
          <div className="font-money text-2xl font-bold tracking-tight text-text-primary dark:text-white">
            Rp 15.620.000
          </div>
          <div className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 mt-2 font-medium">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Proyeksi aman untuk bulan depan</span>
          </div>
        </Card>
      </div>

      {/* Main Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left main block (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Actionable Alert Card */}
          <div className="bg-amber-50 dark:bg-amber-950/20 border-l-4 border-amber-500 rounded-r-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex gap-3">
              <span className="text-xl">⚠️</span>
              <div>
                <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">Tagihan Belum Dibayar</h4>
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">Ada 2 tagihan jatuh tempo dalam 3 hari ke depan sebesar Rp 1.500.000.</p>
              </div>
            </div>
            <Button variant="ghost" className="!text-amber-700 dark:!text-amber-400 hover:!bg-amber-100 dark:hover:!bg-amber-950/40 text-xs !h-8 border border-amber-200 dark:border-amber-900">
              Bayar Sekarang
            </Button>
          </div>

          {/* AI Recommended Action Card */}
          <Card 
            title={
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
                <Sparkles className="w-4 h-4" />
                <span>Rekomendasi Tindakan AI</span>
              </div>
            }
          >
            <p className="text-xs text-text-primary mb-4 leading-relaxed">
              Berdasarkan target dana darurat Anda yang baru mencapai 4.2 bulan (target 6 bulan), dan adanya surplus kas sisa bulan ini sebesar <strong>Rp 4.500.000</strong>, kami merekomendasikan tindakan berikut:
            </p>
            <div className="space-y-3">
              <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/10">
                <div className="text-xs">
                  <p className="font-semibold text-text-primary dark:text-white">1. Top Up Dana Darurat</p>
                  <p className="text-text-secondary mt-0.5">Transfer Rp 3.000.000 ke akun BCA Tabungan (Dana Darurat).</p>
                </div>
                <Badge variant="success">Prioritas 1</Badge>
              </div>
              <div className="p-3 border border-slate-100 dark:border-slate-800 rounded-lg flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/10">
                <div className="text-xs">
                  <p className="font-semibold text-text-primary dark:text-white">2. Pelunasan Ekstra Kartu Kredit Mandiri</p>
                  <p className="text-text-secondary mt-0.5">Bayar ekstra Rp 1.500.000 untuk mempercepat pelunasan bunga 14%.</p>
                </div>
                <Badge variant="warning">Prioritas 2</Badge>
              </div>
            </div>
          </Card>

          {/* Table / Recent transactions placeholder */}
          <Card 
            title="Transaksi Terakhir" 
            extra={<Button variant="ghost" className="text-xs !h-8">Lihat Semua</Button>}
          >
            <TableSkeleton rows={4} cols={4} />
          </Card>
        </div>

        {/* Right block (1 col) */}
        <div className="space-y-6">
          <Card title="Status Keuangan (Health Score)">
            <div className="flex flex-col items-center justify-center py-6">
              <div className="relative w-32 h-32 flex items-center justify-center rounded-full border-8 border-indigo-100 dark:border-indigo-950">
                <div className="absolute inset-0 rounded-full border-8 border-indigo-600 dark:border-indigo-400 border-t-transparent border-r-transparent animate-spin-slow" />
                <div className="text-center">
                  <span className="text-3xl font-extrabold text-text-primary dark:text-white">72</span>
                  <span className="text-[10px] block text-text-secondary font-medium">Bagus</span>
                </div>
              </div>
              <p className="text-xs text-text-secondary mt-4 text-center px-4 leading-relaxed">
                Skor Anda naik 3 poin dibanding bulan lalu karena pengurangan utang kartu kredit.
              </p>
            </div>
          </Card>

          <Card title="Kategori Anggaran Teratas">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-text-primary dark:text-slate-300">🍽️ Makan & Minum</span>
                  <span className="text-text-secondary">Rp 3.800.000 / Rp 5.000.000</span>
                </div>
                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: '76%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-text-primary dark:text-slate-300">🚗 Transport</span>
                  <span className="text-text-secondary">Rp 1.200.000 / Rp 1.500.000</span>
                </div>
                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: '80%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-text-primary dark:text-slate-300">🛒 Belanja Bulanan</span>
                  <span className="text-text-secondary">Rp 3.100.000 / Rp 3.000.000</span>
                </div>
                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: '100%' }} />
                </div>
                <p className="text-[10px] text-red-500 mt-1 font-semibold">⚠️ Over budget Rp 100.000</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Transaction Modal Showcase */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Catat Transaksi Baru"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Batal</Button>
            <Button variant="primary" onClick={() => {
              alert(`Tercatat: ${testInput}`);
              setModalOpen(false);
              setTestInput('');
            }}>Simpan</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-text-secondary mb-2">Formulir pencatatan transaksi manual.</p>
          <Input 
            label="Keterangan / Keperluan"
            placeholder="Contoh: Belanja Bulanan Supermarket"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
          />
          <Input 
            label="Nominal (Rupiah)"
            type="number"
            placeholder="0"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input 
              label="Tanggal"
              type="date"
              defaultValue={new Date().toISOString().split('T')[0]}
            />
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-text-secondary mb-1">Tipe</span>
              <select className="h-10 px-3 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-bg-base text-text-primary focus:outline-none focus:border-indigo-500">
                <option value="expense">Pengeluaran</option>
                <option value="income">Pemasukan</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};
