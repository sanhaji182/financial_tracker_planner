import api from '../utils/api';

export interface HouseholdNote {
	id: string;
	user_id: string;
	title: string;
	content: string;
	tags: string[];
	note_date: string;
	created_at: string;
	formatted_note_date: string;
}

export interface CreateNotePayload {
	title: string;
	content: string;
	tags: string[];
	note_date?: string;
}

export interface UpdateNotePayload {
	title?: string;
	content?: string;
	tags?: string[];
	note_date?: string;
}

const journalService = {
	getNotes: async (search?: string, tag?: string, dateFrom?: string, dateTo?: string): Promise<HouseholdNote[]> => {
		const params = new URLSearchParams();
		if (search) params.append('search', search);
		if (tag) params.append('tag', tag);
		if (dateFrom) params.append('date_from', dateFrom);
		if (dateTo) params.append('date_to', dateTo);

		const query = params.toString();
		const res = await api.get<HouseholdNote[]>(`/journal${query ? '?' + query : ''}`);
		return res.data || [];
	},

	getNoteByID: async (id: string): Promise<HouseholdNote> => {
		const res = await api.get<HouseholdNote>(`/journal/${id}`);
		return res.data;
	},

	createNote: async (payload: CreateNotePayload): Promise<HouseholdNote> => {
		const res = await api.post<HouseholdNote>('/journal', payload);
		return res.data;
	},

	updateNote: async (id: string, payload: UpdateNotePayload): Promise<{ message: string }> => {
		const res = await api.put<{ message: string }>(`/journal/${id}`, payload);
		return res.data;
	},

	deleteNote: async (id: string): Promise<{ message: string }> => {
		const res = await api.delete<{ message: string }>(`/journal/${id}`);
		return res.data;
	}
};

export default journalService;
