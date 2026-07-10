import api from '../utils/api';

const exportService = {
	exportTransactionsCSV: async (dateFrom?: string, dateTo?: string, accountID?: string): Promise<void> => {
		const params = new URLSearchParams();
		if (dateFrom) params.append('date_from', dateFrom);
		if (dateTo) params.append('date_to', dateTo);
		if (accountID) params.append('account_id', accountID);

		const query = params.toString();
		const response = await api.get(`/export/transactions${query ? '?' + query : ''}`, {
			responseType: 'blob',
		});

		// Trigger download in browser
		const blob = new Blob([response.data], { type: 'text/csv' });
		const url = window.URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		
		const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
		link.setAttribute('download', `transactions_export_${timestamp}.csv`);
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.URL.revokeObjectURL(url);
	},

	exportMonthlyReportPDF: async (month: string): Promise<void> => {
		const response = await api.get(`/export/monthly-report?month=${month}`, {
			responseType: 'blob',
		});

		// Trigger download in browser
		const blob = new Blob([response.data], { type: 'application/pdf' });
		const url = window.URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.setAttribute('download', `monthly_closing_report_${month}.pdf`);
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.URL.revokeObjectURL(url);
	}
};

export default exportService;
