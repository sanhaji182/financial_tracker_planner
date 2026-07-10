import api from '../utils/api';

export interface CurrencyResponse {
  code: string;
  name: string;
  symbol: string;
  exchange_rate_to_idr: number;
  last_updated_at: string;
}

const currenciesService = {
  getCurrencies: async (): Promise<CurrencyResponse[]> => {
    const res = await api.get<CurrencyResponse[]>('/currencies');
    return res.data;
  },

  updateExchangeRate: async (code: string, rate: number): Promise<void> => {
    await api.put(`/currencies/${code}?rate=${rate}`, {});
  },
};

export default currenciesService;
