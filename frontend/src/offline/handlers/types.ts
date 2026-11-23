import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import type { DashboardResponse } from '../../services/dashboard';
import type { EFSummaryResponse } from '../../services/emergencyFund';
import type { Budget } from '../../services/budgets';
import type { LocalDatabase } from '../storage';

export interface LocalHandlerContext {
  config: AxiosRequestConfig;
  method: string;
  path: string;
  searchParams: URLSearchParams;
  db: LocalDatabase;
}

export interface LocalHandlerHelpers {
  makeOk: <T>(config: AxiosRequestConfig, data: T, status?: number) => AxiosResponse<T>;
  makeError: (config: AxiosRequestConfig, status: number, message: string, code?: string) => never;
  parseJsonBody: <T>(data: unknown) => T;
  computeDashboard: (db: LocalDatabase) => DashboardResponse;
  computeEmergencyFundSummary: (db: LocalDatabase) => EFSummaryResponse;
  computeMonthlyExpenseEstimate: (db: LocalDatabase) => number;
  computeBudgetRow: (
    db: LocalDatabase,
    raw: { id: string; category_id: string; month: string; amount: number }
  ) => Budget;
}
