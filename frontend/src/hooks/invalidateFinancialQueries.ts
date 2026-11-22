import type { QueryClient, QueryKey } from '@tanstack/react-query';

export const CORE_FINANCIAL_QUERY_KEYS: readonly QueryKey[] = [
    ['dashboard'],
    ['accounts'],
    ['transactions'],
    ['budgets'],
    ['forecast'],
    ['emergency-fund'],
    ['allocation'],
    ['assets'],
    ['investment'],
    ['debts'],
    ['bills'],
    ['data-quality'],
    ['shared'],
];

/**
 * Invalidate all derived financial queries (plus any entity-specific keys)
 * so mutations immediately reflect across Dashboard, Budgets, Data Quality, and reports.
 */
export function invalidateFinancialData(
    queryClient: QueryClient,
    extraKeys: QueryKey[] = [],
): void {
    for (const queryKey of [...CORE_FINANCIAL_QUERY_KEYS, ...extraKeys]) {
        queryClient.invalidateQueries({ queryKey });
    }
}
