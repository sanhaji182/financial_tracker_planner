import api from '../utils/api';
import type { DataSufficiency } from './dashboard';

export interface DataQualityIssue {
  code: string;
  severity: 'critical' | 'warning' | 'info' | string;
  title: string;
  detail: string;
  cta_label?: string;
  cta_url?: string;
  affects?: string[];
  count?: number;
  account_id?: string;
  account_name?: string;
}

export interface MetricGate {
  metric: string;
  visible: boolean;
  degraded: boolean;
  confidence: string;
  reasons?: string[];
  missing?: string[];
}

export interface AccountQuality {
  account_id: string;
  account_name: string;
  type: string;
  currency: string;
  score: number;
  freshness: string;
  has_recent_reconcile: boolean;
  days_since_last_tx: number;
  balance: number;
  formatted_balance?: string;
}

export interface DataQualityResponse {
  as_of: string;
  formula_version: string;
  overall_score: number;
  overall_confidence: string;
  grade: string;
  completeness_score: number;
  freshness_score: number;
  hygiene_score: number;
  reconciliation_rate: number;
  reconciliation_confidence: number;
  uncategorized_rate: number;
  issues: DataQualityIssue[];
  accounts: AccountQuality[];
  gates: MetricGate[];
  missing_inputs: string[];
  decision_metrics_hidden: string[];
  decision_metrics_degraded: string[];
  data_sufficiency?: DataSufficiency;
  assumptions?: string[];
}

export const dataQualityService = {
  async get(): Promise<DataQualityResponse> {
    const res = await api.get('/data-quality');
    return res.data.data;
  },
};

export function gateFor(dq: DataQualityResponse | undefined, metric: string): MetricGate | undefined {
  return dq?.gates?.find((g) => g.metric === metric);
}

export default dataQualityService;
