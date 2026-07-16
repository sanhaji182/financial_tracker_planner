import { test, expect } from '@playwright/test';
import { mockApiFallback, ownerUser } from './helpers';

test.describe('Authentication Flow', () => {
  test('register redirects to dashboard', async ({ page }) => {
    await mockApiFallback(page, { user: ownerUser, session: false });

    await page.goto('/register');
    await expect(page.locator('input#name, input[name="name"]').first()).toBeVisible({
      timeout: 15000,
    });

    const name = page.locator('input#name, input[name="name"]').first();
    const email = page.locator('input#email, input[type="email"]').first();
    const password = page.locator('input#password, input[type="password"]').first();
    const confirm = page.locator('input#confirmPassword, input[name="confirmPassword"]').first();

    await name.fill('E2E User');
    await email.fill('e2e@example.com');
    await password.fill('password123');
    if (await confirm.count()) {
      await confirm.fill('password123');
    }
    await page.locator('button[type="submit"]').click();

    await page.waitForURL((url) => !url.pathname.includes('/register'), { timeout: 15000 });
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
  });
});
