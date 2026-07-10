import api from '../utils/api';

export interface ScenarioChangeParam {
  debt_id?: string;
  category_id?: string;
  monthly_extra_amount?: number;
  percentage?: number;
  amount?: number;
  month?: string;
  monthly_amount?: number;
}

export interface ScenarioChange {
  type: 'extra_debt_payment' | 'income_change' | 'large_purchase' | 'investment_increase' | 'add_subscription' | 'remove_expense';
  params: ScenarioChangeParam;
}

export interface MetricState {
  base: number;
  scenario: number;
  impact: number;
  severity: 'positive' | 'neutral' | 'negative';
}

export interface ScenarioResult {
  ending_balance: MetricState;
  total_debts: MetricState;
  ef_coverage: MetricState;
  cash_runway: MetricState;
}

export interface ScenarioResponse {
  id: string;
  user_id: string;
  name: string;
  changes: ScenarioChange[];
  result: ScenarioResult;
  created_at: string;
}

const scenariosService = {
  getScenarios: async (): Promise<ScenarioResponse[]> => {
    const res = await api.get<any>('/scenarios');
    return res.data.data || [];
  },

  simulateScenario: async (changes: ScenarioChange[]): Promise<ScenarioResult> => {
    const res = await api.post<any>('/scenarios/simulate', { changes });
    return res.data.data;
  },

  saveScenario: async (name: string, changes: ScenarioChange[], result: ScenarioResult): Promise<ScenarioResponse> => {
    const res = await api.post<any>('/scenarios', { name, changes, result });
    return res.data.data;
  },

  deleteScenario: async (id: string): Promise<void> => {
    await api.delete(`/scenarios/${id}`);
  },
};

export default scenariosService;
