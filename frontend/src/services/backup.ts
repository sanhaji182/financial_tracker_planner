import api from '../utils/api';

export interface BackupResponse {
	file_name: string;
	size: number;
	created_at: string;
}

const backupService = {
	getBackups: async (): Promise<BackupResponse[]> => {
		const res = await api.get<BackupResponse[]>('/backup/list');
		return res.data;
	},

	createBackup: async (): Promise<BackupResponse> => {
		const res = await api.post<BackupResponse>('/backup/create');
		return res.data;
	},

	restoreBackup: async (fileName: string, password: string): Promise<{ message: string }> => {
		const res = await api.post<{ message: string }>('/backup/restore', {
			file_name: fileName,
			password: password,
		});
		return res.data;
	},

	downloadBackupFile: async (fileName: string): Promise<void> => {
		const response = await api.get(`/backup/download/${fileName}`, {
			responseType: 'blob',
		});

		const blob = new Blob([response.data], { type: 'application/octet-stream' });
		const url = window.URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.setAttribute('download', fileName);
		document.body.appendChild(link);
		link.click();
		link.remove();
		window.URL.revokeObjectURL(url);
	}
};

export default backupService;
