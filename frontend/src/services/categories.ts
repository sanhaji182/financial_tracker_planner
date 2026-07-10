import api from '../utils/api';

export interface Category {
  id: string;
  user_id?: string;
  parent_id?: string;
  name: string;
  type: 'income' | 'expense';
  icon?: string;
  color?: string;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCategoryRequest {
  name: string;
  type: 'income' | 'expense';
  icon?: string;
  color?: string;
  parent_id?: string;
}

export interface UpdateCategoryRequest {
  name: string;
  icon?: string;
  color?: string;
}

export const categoriesService = {
  async getCategories(): Promise<Category[]> {
    const res = await api.get('/categories');
    return res.data.data || [];
  },

  async createCategory(req: CreateCategoryRequest): Promise<Category> {
    const res = await api.post('/categories', req);
    return res.data.data;
  },

  async updateCategory(id: string, req: UpdateCategoryRequest): Promise<Category> {
    const res = await api.put(`/categories/${id}`, req);
    return res.data.data;
  },

  async deleteCategory(id: string): Promise<void> {
    await api.delete(`/categories/${id}`);
  },
};
