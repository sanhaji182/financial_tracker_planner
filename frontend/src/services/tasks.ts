import api from '../utils/api';

export interface TaskChecklist {
	id: string;
	user_id: string;
	title: string;
	description: string;
	due_date?: string;
	frequency: string; // once, monthly, quarterly, yearly
	category: string;
	status: string; // pending, completed, overdue, skipped
	completed_at?: string;
	created_at: string;
}

export interface CreateTaskPayload {
	title: string;
	description: string;
	due_date: string;
	frequency: string;
	category: string;
}

export interface UpdateTaskPayload {
	title?: string;
	description?: string;
	due_date?: string;
	frequency?: string;
	category?: string;
	status?: string;
}

const tasksService = {
	getTasks: async (status?: string, dateFrom?: string, dateTo?: string, frequency?: string): Promise<TaskChecklist[]> => {
		const params = new URLSearchParams();
		if (status) params.append('status', status);
		if (dateFrom) params.append('date_from', dateFrom);
		if (dateTo) params.append('date_to', dateTo);
		if (frequency) params.append('frequency', frequency);

		const query = params.toString();
		const res = await api.get<any>(`/tasks${query ? '?' + query : ''}`);
		return res.data.data || [];
	},

	getTaskByID: async (id: string): Promise<TaskChecklist> => {
		const res = await api.get<any>(`/tasks/${id}`);
		return res.data.data;
	},

	createTask: async (payload: CreateTaskPayload): Promise<TaskChecklist> => {
		const res = await api.post<any>('/tasks', payload);
		return res.data.data;
	},

	updateTask: async (id: string, payload: UpdateTaskPayload): Promise<{ message: string }> => {
		const res = await api.put<any>(`/tasks/${id}`, payload);
		return res.data.data;
	},

	deleteTask: async (id: string): Promise<{ message: string }> => {
		const res = await api.delete<any>(`/tasks/${id}`);
		return res.data.data;
	}
};

export default tasksService;
