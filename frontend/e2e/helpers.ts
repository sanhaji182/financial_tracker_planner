import { Page, Route } from '@playwright/test';

/** Owner user used across mocked critical-path specs. */
export const ownerUser = {
  id: 'user-owner',
  email: 'owner@example.com',
  name: 'Owner User',
  role: 'owner' as const,
  timezone: 'Asia/Jakarta',
  currency_default: 'IDR',
  created_at: '2026-01-01T00:00:00Z',
};

/** Spouse viewer user for role-gated paths. */
export const spouseUser = {
  id: 'user-spouse',
  email: 'spouse@example.com',
  name: 'Spouse Viewer',
  role: 'spouse_viewer' as const,
  timezone: 'Asia/Jakarta',
  currency_default: 'IDR',
  created_at: '2026-01-01T00:00:00Z',
};

export const dashboardPayload = {
  data: {
    net_worth: { value: 15000000, formatted_value: 'Rp 15.000.000' },
    cash_available: { value: 5000000, formatted_value: 'Rp 5.000.000' },
    total_debts: {
      total_outstanding: 2000000,
      formatted_total_outstanding: 'Rp 2.000.000',
      active_count: 1,
    },
    dti_ratio: 15,
    dti_status: 'healthy',
    health_score: { score: 85, rating: 'Excellent', status_color: 'Green' },
    upcoming_bills: [],
    forecast_end_month: { value: 4500000, formatted_value: 'Rp 4.500.000' },
    safe_to_spend: { value: 1200000, formatted_value: 'Rp 1.200.000' },
    recent_alerts: [],
    insight_summary: 'Arus kas bersih keluarga Anda bulan ini positif.',
    next_action: {
      title: 'Tahan Kas (Buffer)',
      description: 'Tahan kas Anda',
      action_label: 'Detail',
      action_url: '/',
    },
    net_worth_trend: [],
    formula_version: 'kernel-v1',
    data_confidence: 'high',
  },
};

type MockOpts = {
  user?: typeof ownerUser | typeof spouseUser;
  /** When false, /auth/refresh returns 401 so login page stays mounted. Default true. */
  session?: boolean;
};

/**
 * Catch-all API mock. Register BEFORE navigation.
 * Playwright matches routes in reverse order — register this first, then
 * more specific handlers afterward if needed.
 */
export async function mockApiFallback(page: Page, opts: MockOpts = {}) {
  const user = opts.user ?? ownerUser;
  const session = opts.session !== false;

  await page.route('**/api/v1/**', async (route: Route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/auth/refresh') && method === 'POST') {
      if (!session) {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'no session' } }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { access_token: 'e2e-token', user } }),
      });
      return;
    }

    if (url.includes('/auth/login') && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { access_token: 'e2e-token', user } }),
      });
      return;
    }

    if (url.includes('/auth/register') && method === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Registration successful',
          data: { access_token: 'e2e-token', user },
        }),
      });
      return;
    }

    if (url.includes('/auth/logout') && method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'ok' }),
      });
      return;
    }

    if (url.includes('/dashboard')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dashboardPayload),
      });
      return;
    }

    if (url.includes('/forecast/monthly')) {
      const money = (v: number) => ({ value: v, formatted_value: `Rp ${v}` });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            month: '2026-07',
            estimated_income: money(20000000),
            estimated_fixed_expenses: money(5000000),
            estimated_variable_expenses: money(4000000),
            projected_end_balance: money(4500000),
            lowest_balance: money(2000000),
            lowest_balance_date: '2026-07-20',
            threshold_limit: money(1000000),
            safe_to_spend: money(1200000),
            daily_projections: [
              {
                date: '2026-07-01',
                projected_balance: 5000000,
                formatted_balance: 'Rp 5000000',
                included: true,
              },
            ],
            is_tight: false,
            formula_version: 'forecast-v2+forecast-v1+kernel-v1',
            end_balance_scenarios: {
              conservative: money(3000000),
              expected: money(4500000),
              optimistic: money(6000000),
            },
            assumptions: ['e2e mock'],
            as_of: '2026-07-15T00:00:00Z',
          },
        }),
      });
      return;
    }

    if (url.includes('/forecast/backtest')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            as_of: '2026-07-15T00:00:00Z',
            formula_version: 'forecast-v2',
            overall: {
              horizon_days: 30,
              label: '30d',
              sample_size: 0,
              mae: 0,
              formatted_mae: 'Rp 0',
              wape: 0,
              bias: 0,
              formatted_bias: 'Rp 0',
              directional_accuracy: 0,
            },
            by_horizon: [],
            points: [],
            points_used: 0,
            points_skipped: 0,
          },
        }),
      });
      return;
    }

    // Spouse shared-view endpoints need object (not []) shapes.
    if (url.includes('/shared-view/summary')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            total_assets_shared: 10_000_000,
            formatted_total_assets: 'Rp 10.000.000',
            total_debts: 2_000_000,
            formatted_total_debts: 'Rp 2.000.000',
            net_worth_shared: 8_000_000,
            formatted_net_worth: 'Rp 8.000.000',
            upcoming_bills: [],
            forecast_end_month: {
              value: 4_500_000,
              formatted_value: 'Rp 4.500.000',
            },
            owner_name: 'Owner User',
          },
        }),
      });
      return;
    }

    if (url.includes('/shared-view/assets') || url.includes('/shared-view/debts') || url.includes('/shared-view/bills')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
      return;
    }

    // Generic empty success for list/detail endpoints
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], insights: [], total: 0, items: [] }),
    });
  });
}

/** Bootstrap authenticated session via mocked refresh, then open a path. */
export async function gotoAuthed(
  page: Page,
  path = '/',
  user: typeof ownerUser | typeof spouseUser = ownerUser
) {
  await mockApiFallback(page, { user, session: true });
  await page.goto(path);
  await page.waitForLoadState('domcontentloaded');
}
