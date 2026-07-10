import api from '../utils/api';
import type { Asset } from './assets';
import type { Debt } from './debts';
import type { UpcomingBill, MoneyValue } from './dashboard';

export interface SharedSummaryResponse {
  total_assets_shared: number;
  formatted_total_assets: string;
  total_debts: number;
  formatted_total_debts: string;
  net_worth_shared: number;
  formatted_net_worth: string;
  upcoming_bills: UpcomingBill[];
  forecast_end_month: MoneyValue;
  owner_name: string;
}

export const sharedViewService = {
  async getSharedSummary(): Promise<SharedSummaryResponse> {
    const res = await api.get('/shared-view/summary');
    return res.data.data;
  },

  async getSharedAssets(): Promise<Asset[]> {
    const res = await api.get('/shared-view/assets');
    return res.data.data || [];
  },

  async getSharedDebts(): Promise<Debt[]> {
    const res = await api.get('/shared-view/debts');
    return res.data.data || [];
  },

  async getSharedBills(): Promise<UpcomingBill[]> {
    const res = await api.get('/shared-view/bills');
    return res.data.data || [];
  },
};
export default sharedViewService;
