import api from '../utils/api';
import { getTodayLocalDate } from '../utils/date';
import { isNativeMobile, saveAndShareNativeBlob } from '../utils/mobile';

async function deliverExportBlob(blob: Blob, fileName: string, title: string): Promise<void> {
  if (isNativeMobile()) {
    await saveAndShareNativeBlob(blob, fileName, title);
    return;
  }

  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

const exportService = {
  exportTransactionsCSV: async (
    dateFrom?: string,
    dateTo?: string,
    accountID?: string
  ): Promise<void> => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    if (accountID) params.append('account_id', accountID);

    const query = params.toString();
    const response = await api.get(`/export/transactions${query ? '?' + query : ''}`, {
      responseType: 'blob',
    });

    const blob = new Blob([response.data], { type: 'text/csv' });
    const timestamp = getTodayLocalDate().replace(/-/g, '');
    await deliverExportBlob(
      blob,
      `transactions_export_${timestamp}.csv`,
      'Ekspor Transaksi CSV'
    );
  },

  exportMonthlyReportPDF: async (month: string): Promise<void> => {
    const response = await api.get(`/export/monthly-report?month=${month}`, {
      responseType: 'blob',
    });

    const blob = new Blob([response.data], { type: 'application/pdf' });
    await deliverExportBlob(
      blob,
      `monthly_closing_report_${month}.pdf`,
      `Laporan Bulanan ${month}`
    );
  },
};

export default exportService;
