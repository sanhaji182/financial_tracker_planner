import api from '../utils/api';

export interface AssetValuation {
  id: string;
  asset_id: string;
  value: number;
  formatted_value: string;
  valuation_date: string;
  source: 'manual' | 'market' | 'appraisal' | 'sync';
  notes?: string;
  created_at: string;
}

export interface Asset {
  id: string;
  user_id: string;
  name: string;
  type: 'savings' | 'property' | 'vehicle' | 'investment' | 'cash' | 'e_wallet' | 'deposit' | 'other';
  current_value: number;
  formatted_value: string;
  purchase_value?: number;
  formatted_purchase?: string;
  purchase_date?: string;
  currency: string;
  linked_account_id?: string;
  linked_account_name?: string;
  is_shared: boolean;
  is_liquid: boolean;
  notes?: string;
  metadata?: any; // flexible based on type
  created_at: string;
  updated_at: string;
  valuations?: AssetValuation[];
}

export interface CreateAssetRequest {
  name: string;
  type: 'savings' | 'property' | 'vehicle' | 'investment' | 'cash' | 'e_wallet' | 'deposit' | 'other';
  current_value: number;
  purchase_value?: number;
  purchase_date?: string;
  linked_account_id?: string;
  is_shared: boolean;
  is_liquid: boolean;
  notes?: string;
  metadata?: any;
}

export interface UpdateAssetRequest {
  name: string;
  current_value: number;
  purchase_value?: number;
  purchase_date?: string;
  is_shared: boolean;
  is_liquid: boolean;
  notes?: string;
  metadata?: any;
}

export interface CreateValuationRequest {
  value: number;
  valuation_date: string;
  source: 'manual' | 'market' | 'appraisal';
  notes?: string;
}

export interface AssetTypeSummary {
  type: string;
  total: number;
  formatted_total: string;
}

export interface AssetSummaryResponse {
  total_assets: number;
  formatted_total_assets: string;
  total_liquid: number;
  formatted_total_liquid: string;
  total_shared: number;
  formatted_total_shared: string;
  total_private: number;
  formatted_total_private: string;
  breakdown_by_type: AssetTypeSummary[];
}

export interface AssetListFilters {
  type?: string;
  is_shared?: boolean;
}

export const assetsService = {
  async getAssets(filters?: AssetListFilters): Promise<Asset[]> {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          params.append(key, String(val));
        }
      });
    }
    const res = await api.get(`/assets?${params.toString()}`);
    return res.data.data || [];
  },

  async getAsset(id: string): Promise<Asset> {
    const res = await api.get(`/assets/${id}`);
    return res.data.data;
  },

  async createAsset(req: CreateAssetRequest): Promise<Asset> {
    const res = await api.post('/assets', req);
    return res.data.data;
  },

  async updateAsset(id: string, req: UpdateAssetRequest): Promise<Asset> {
    const res = await api.put(`/assets/${id}`, req);
    return res.data.data;
  },

  async deleteAsset(id: string): Promise<void> {
    await api.delete(`/assets/${id}`);
  },

  async addValuation(id: string, req: CreateValuationRequest): Promise<AssetValuation> {
    const res = await api.post(`/assets/${id}/valuations`, req);
    return res.data.data;
  },

  async getAssetSummary(): Promise<AssetSummaryResponse> {
    const res = await api.get('/assets/summary');
    return res.data.data;
  },
};
