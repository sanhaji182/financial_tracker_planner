import api from '../utils/api';

export interface Document {
  id: string;
  user_id: string;
  file_name: string;
  file_path: string;
  file_url: string;
  file_type: string;
  file_size: number;
  linked_entity_type?: string;
  linked_entity_id?: string;
  tags?: string[];
  description?: string;
  created_at: string;
  updated_at: string;
  formatted_created_at: string;
}

export interface UploadDocumentPayload {
  file: File;
  linked_entity_type?: string;
  linked_entity_id?: string;
  tags?: string[];
  description?: string;
}

const documentsService = {
  getDocuments: async (entityType?: string, tag?: string): Promise<Document[]> => {
    const params = new URLSearchParams();
    if (entityType) params.append('linked_entity_type', entityType);
    if (tag) params.append('tag', tag);
    
    const query = params.toString();
    const res = await api.get<{ data: Document[] }>(`/documents${query ? '?' + query : ''}`);
    return res.data.data;
  },

  uploadDocument: async (payload: UploadDocumentPayload): Promise<Document> => {
    const formData = new FormData();
    formData.append('file', payload.file);
    if (payload.linked_entity_type) formData.append('linked_entity_type', payload.linked_entity_type);
    if (payload.linked_entity_id) formData.append('linked_entity_id', payload.linked_entity_id);
    if (payload.description) formData.append('description', payload.description);
    if (payload.tags && payload.tags.length > 0) {
      formData.append('tags', payload.tags.join(','));
    }

    const res = await api.post<{ data: Document }>('/documents', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data.data;
  },

  deleteDocument: async (id: string): Promise<void> => {
    await api.delete(`/documents/${id}`);
  },

  linkDocument: async (id: string, entityType: string, entityId: string): Promise<void> => {
    await api.put(`/documents/${id}/link`, {
      linked_entity_type: entityType,
      linked_entity_id: entityId,
    });
  },

  getDocumentObjectURL: async (id: string): Promise<string> => {
    const res = await api.get(`/documents/${id}/download`, { responseType: 'blob' });
    return URL.createObjectURL(res.data);
  },

  downloadDocument: async (id: string, fileName: string): Promise<void> => {
    const objectUrl = await documentsService.getDocumentObjectURL(id);
    try {
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  },
};

export default documentsService;
