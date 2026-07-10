import api from '../utils/api';

export interface RuleCondition {
  account_id?: string;
  threshold?: number;
  days_before?: number;
  category_id?: string;
  percentage?: number;
  amount?: number;
  frequency?: 'weekly' | 'monthly';
  day_of_month?: number;
  day_of_week?: number;
}

export interface RuleActionConfig {
  template?: string;
  telegram_chat?: string;
  account_id?: string;
  category_id?: string;
  amount?: number;
  description?: string;
  type?: 'expense' | 'income';
}

export interface CreateAutomationRuleRequest {
  name: string;
  trigger_type: 'balance_below' | 'bill_due_soon' | 'budget_exceeded' | 'recurring_transaction';
  condition: RuleCondition;
  action_type: 'send_alert' | 'send_telegram' | 'create_transaction';
  action_config: RuleActionConfig;
}

export interface AutomationRuleResponse {
  id: string;
  user_id: string;
  name: string;
  trigger_type: 'balance_below' | 'bill_due_soon' | 'budget_exceeded' | 'recurring_transaction';
  condition: RuleCondition;
  action_type: 'send_alert' | 'send_telegram' | 'create_transaction';
  action_config: RuleActionConfig;
  is_active: boolean;
  last_triggered_at?: string;
  trigger_count: number;
  created_at: string;
  updated_at: string;
}

const automationRulesService = {
  getRules: async (): Promise<AutomationRuleResponse[]> => {
    const res = await api.get<any>('/automation-rules');
    return res.data.data || [];
  },

  createRule: async (req: CreateAutomationRuleRequest): Promise<AutomationRuleResponse> => {
    const res = await api.post<any>('/automation-rules', req);
    return res.data.data;
  },

  updateRule: async (id: string, req: Partial<AutomationRuleResponse>): Promise<AutomationRuleResponse> => {
    const res = await api.put<any>(`/automation-rules/${id}`, req);
    return res.data.data;
  },

  deleteRule: async (id: string): Promise<void> => {
    await api.delete(`/automation-rules/${id}`);
  },

  evaluateRules: async (): Promise<void> => {
    await api.post('/automation-rules/evaluate', {});
  },
};

export default automationRulesService;
