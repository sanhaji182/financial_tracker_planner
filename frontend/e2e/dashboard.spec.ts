import { test, expect } from '@playwright/test';

test.describe('Dashboard E2E Page', () => {
  test.beforeEach(async ({ page }) => {
    // Fallback mock for any other API requests
    await page.route('**/api/v1/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/dashboard')) {
        return route.continue();
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {}, insights: [] }),
      });
    });

    // Mock dashboard API response
    await page.route('**/api/v1/dashboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            net_worth: { value: 15000000, formatted_value: 'Rp 15.000.000' },
            cash_available: { value: 5000000, formatted_value: 'Rp 5.000.000' },
            total_debts: { total_outstanding: 2000000, formatted_total_outstanding: 'Rp 2.000.000', active_count: 1 },
            dti_ratio: 15,
            dti_status: 'healthy',
            health_score: { score: 85, rating: 'Excellent', status_color: 'Green' },
            upcoming_bills: [],
            forecast_end_month: { value: 4500000, formatted_value: 'Rp 4.500.000' },
            safe_to_spend: { value: 1200000, formatted_value: 'Rp 1.200.000' },
            recent_alerts: [],
            insight_summary: 'Arus kas bersih keluarga Anda bulan ini positif.',
            next_action: { title: 'Tahan Kas (Buffer)', description: 'Tahan kas Anda', action_label: 'Detail', action_url: '/' },
            net_worth_trend: [],
          },
        }),
      });
    });

    // Go to login page first to initialize local storage on correct origin
    await page.goto('/login');
    
    // Set localStorage
    await page.evaluate(() => {
      localStorage.setItem('financial-os-auth', JSON.stringify({
        state: {
          user: { id: 'user-123', email: 'owner@example.com', name: 'Dashboard Owner', role: 'owner' },
          accessToken: 'e2e-token',
          isAuthenticated: true,
          isLoading: false,
        },
        version: 0
      }));
    });
    
    // Navigate to dashboard
    await page.goto('/');
    
    // Wait for page load and any potential redirection redirects to settle
    await page.waitForURL('**/');
  });

  test('should display dashboard metrics', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Selamat Datang, Dashboard Owner');
    await expect(page.getByText('Kekayaan Bersih (Net Worth)')).toBeVisible();
    await expect(page.getByText('Dana Likuid Tersedia (Cash)')).toBeVisible();
    await expect(page.getByText('Total Utang Aktif')).toBeVisible();
  });

  test('should toggle dark/light theme correctly', async ({ page }) => {
    const toggleButton = page.locator('button:has(svg.lucide-sun), button:has(svg.lucide-moon)');
    if (await toggleButton.count() > 0) {
      const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await toggleButton.first().click();
      const nextTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(nextTheme).not.toBe(initialTheme);
    }
  });

  test('should layout correctly on mobile screen size', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('h1')).toContainText('Selamat Datang');
  });
});
