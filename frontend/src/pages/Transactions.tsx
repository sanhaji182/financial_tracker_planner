import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { TableSkeleton } from '../components/ui/TableSkeleton';

export const Transactions: React.FC = () => {
  const [isEmpty, setIsEmpty] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary dark:text-white">
            Transaksi
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Riwayat lengkap pemasukan, pengeluaran, dan transfer rekening Anda.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setIsEmpty(!isEmpty)}>
          Toggle View: {isEmpty ? 'Tampilkan Data' : 'Tampilkan Kosong'}
        </Button>
      </div>

      {isEmpty ? (
        /* Empty State */
        <Card className="min-h-[400px] flex flex-col items-center justify-center text-center p-10">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-2xl mb-4">
            🍽️
          </div>
          <h3 className="text-lg font-bold text-text-primary dark:text-white">
            Belum ada transaksi bulan ini
          </h3>
          <p className="text-sm text-text-secondary max-w-sm mt-2 mb-6">
            Mulai catat pemasukan dan pengeluaran Anda secara manual atau upload struk belanjaan Anda.
          </p>
          <Button variant="primary">
            + Tambah Transaksi Pertama
          </Button>
        </Card>
      ) : (
        <Card title="Daftar Transaksi Terkini">
          <div className="space-y-6">
            {/* Filter toolbar placeholder */}
            <div className="flex flex-wrap gap-3 pb-2">
              <input 
                type="text" 
                placeholder="Cari transaksi..." 
                className="h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-bg-base text-text-primary rounded-lg focus:outline-none focus:border-indigo-500 w-64"
              />
              <select className="h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-bg-base text-text-primary rounded-lg focus:outline-none focus:border-indigo-500">
                <option value="">Semua Kategori</option>
                <option value="makan">🍽️ Makan & Minum</option>
                <option value="transport">🚗 Transport</option>
                <option value="belanja">🛒 Belanja</option>
              </select>
              <select className="h-10 px-3 text-sm border border-slate-200 dark:border-slate-700 bg-bg-base text-text-primary rounded-lg focus:outline-none focus:border-indigo-500">
                <option value="">Semua Tipe</option>
                <option value="income">Pemasukan</option>
                <option value="expense">Pengeluaran</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>
            
            {/* Custom Table with Mock Rows */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 font-semibold text-text-secondary uppercase text-xs">
                    <th className="py-3 px-4">Tanggal</th>
                    <th className="py-3 px-4">Keterangan</th>
                    <th className="py-3 px-4">Kategori</th>
                    <th className="py-3 px-4">Sumber Akun</th>
                    <th className="py-3 px-4 text-right">Jumlah</th>
                    <th className="py-3 px-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-850">
                  <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-3.5 px-4 text-text-secondary whitespace-nowrap">2026-07-08</td>
                    <td className="py-3.5 px-4 font-medium text-text-primary dark:text-white">Gaji Bulanan Utama</td>
                    <td className="py-3.5 px-4"><Badge variant="success">💰 Gaji</Badge></td>
                    <td className="py-3.5 px-4 text-text-secondary">BCA Tabungan</td>
                    <td className="py-3.5 px-4 text-right font-money font-semibold text-emerald-600">Rp 25.000.000</td>
                    <td className="py-3.5 px-4 text-center"><Badge variant="success">Confirmed</Badge></td>
                  </tr>
                  <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-3.5 px-4 text-text-secondary whitespace-nowrap">2026-07-08</td>
                    <td className="py-3.5 px-4 font-medium text-text-primary dark:text-white">Belanja Bulanan Carrefour</td>
                    <td className="py-3.5 px-4"><Badge variant="info">🛒 Belanja</Badge></td>
                    <td className="py-3.5 px-4 text-text-secondary">BCA Tabungan</td>
                    <td className="py-3.5 px-4 text-right font-money font-semibold text-red-600">-Rp 1.250.000</td>
                    <td className="py-3.5 px-4 text-center"><Badge variant="success">Confirmed</Badge></td>
                  </tr>
                  <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-3.5 px-4 text-text-secondary whitespace-nowrap">2026-07-07</td>
                    <td className="py-3.5 px-4 font-medium text-text-primary dark:text-white">Top Up E-Wallet GoPay</td>
                    <td className="py-3.5 px-4"><Badge variant="transfer">🔄 Transfer</Badge></td>
                    <td className="py-3.5 px-4 text-text-secondary">Mandiri → GoPay</td>
                    <td className="py-3.5 px-4 text-right font-money font-semibold text-indigo-600">Rp 500.000</td>
                    <td className="py-3.5 px-4 text-center"><Badge variant="success">Confirmed</Badge></td>
                  </tr>
                  <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-3.5 px-4 text-text-secondary whitespace-nowrap">2026-07-06</td>
                    <td className="py-3.5 px-4 font-medium text-text-primary dark:text-white">Kopi Janji Jiwa (OCR Draft)</td>
                    <td className="py-3.5 px-4"><Badge variant="warning">🍽️ Makan & Minum</Badge></td>
                    <td className="py-3.5 px-4 text-text-secondary">Kas Tunai</td>
                    <td className="py-3.5 px-4 text-right font-money font-semibold text-red-600">-Rp 28.000</td>
                    <td className="py-3.5 px-4 text-center"><Badge variant="warning">Pending Review</Badge></td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            {/* Show Table Skeleton below for visual demo */}
            <div className="pt-6 border-t border-slate-100 dark:border-slate-800">
              <h4 className="text-xs font-semibold text-text-secondary mb-3">Tampilan Loading (Skeleton Table):</h4>
              <TableSkeleton rows={3} cols={5} />
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
