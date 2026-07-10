import { test, expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  test('register redirects to dashboard', async ({ page }) => {
    // Fallback mock for any other API requests
    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/auth/register') || url.includes('/dashboard')) {
        return route.continue();
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {} }),
      });
    });

    // Mock register API
    await page.route('**/api/v1/auth/register', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'Registration successful',
          data: { 
            access_token: 'e2e-token',
            refresh_token: 'e2e-refresh',
            user: { id: 'user-e2e', email: 'e2e@example.com', name: 'E2E User', role: 'owner' }
          },
        }),
      });
    });

    // Mock dashboard data API
    await page.route('**/api/v1/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            net_worth: { value: 10000000, formatted_value: 'Rp 10.000.000' },
            cash_available: { value: 5000000, formatted_value: 'Rp 5.000.000' },
            total_debts: { total_outstanding: 0, formatted_total_outstanding: 'Rp 0', active_count: 0 },
            dti_ratio: 0,
            dti_status: 'healthy',
            health_score: { score: 95, rating: 'Excellent', status_color: 'Green' },
            upcoming_bills: [],
            forecast_end_month: { value: 5000000, formatted_value: 'Rp 5.000.000' },
            safe_to_spend: { value: 3000000, formatted_value: 'Rp 3.000.000' },
            recent_alerts: [],
            insight_summary: 'Keuangan aman.',
            next_action: { title: 'Tahan Kas', description: 'Simpan uang', action_label: 'Detail', action_url: '/' },
            net_worth_trend: [],
          },
        }),
      });
    });

    // Go to register page
    await page.goto('/register');
    
    // Fill register form using stable ID selectors
    await page.fill('input#name', 'E2E User');
    await page.fill('input#email', 'e2e@example.com');
    await page.fill('input#password', 'password123');
    await page.fill('input#confirmPassword', 'password123');
    await page.click('button:has-text("Daftar Akun Baru")');

    // Wait for redirection to dashboard directly
    await page.waitForURL('**/');
    await expect(page.locator('h1')).toContainText('Selamat Datang, E2E User');
  });
});
