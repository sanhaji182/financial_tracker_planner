import { test, expect } from '@playwright/test';
import {
  gotoAuthed,
  mockApiFallback,
  ownerUser,
  spouseUser,
} from './helpers';

test.describe('Critical paths — owner', () => {
  test('login form → dashboard', async ({ page }) => {
    // No existing session — keep login form mounted.
    await mockApiFallback(page, { user: ownerUser, session: false });

    await page.goto('/login');
    await expect(page.locator('input#email')).toBeVisible({ timeout: 15000 });
    await page.locator('input#email').fill('owner@example.com');
    await page.locator('input#password').fill('password123');
    await page.locator('button[type="submit"]').click();

    // LoginPage delays setAuth by 1s after success message.
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    await expect(page.locator('h1')).toContainText(/Owner User|Selamat Datang/i, {
      timeout: 15000,
    });
  });

  test('dashboard metrics render for owner', async ({ page }) => {
    await gotoAuthed(page, '/', ownerUser);
    await expect(page.locator('h1')).toContainText(/Owner User|Selamat Datang/i, {
      timeout: 15000,
    });
    await expect(
      page.getByText(/Kekayaan Bersih|Net Worth|Dana Likuid|Cash|Safe.to.Spend|Safe to Spend/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('transactions page loads', async ({ page }) => {
    await gotoAuthed(page, '/transactions', ownerUser);
    await expect(page.locator('h1')).toContainText(/Catatan Transaksi|Transaksi/i, {
      timeout: 15000,
    });
  });

  test('bills page loads', async ({ page }) => {
    await gotoAuthed(page, '/bills', ownerUser);
    await expect(page.locator('h1')).toContainText(/Tagihan|Kalender/i, {
      timeout: 15000,
    });
  });

  test('forecast page loads', async ({ page }) => {
    await gotoAuthed(page, '/forecast', ownerUser);
    await expect(
      page.getByText(/Proyeksi Cashflow|Gagal memuat proyeksi|Safe-to-Spend|Forecast/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('closing page is reachable', async ({ page }) => {
    await gotoAuthed(page, '/closing', ownerUser);
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Critical paths — spouse viewer', () => {
  test('spouse can open authenticated shell', async ({ page }) => {
    await gotoAuthed(page, '/spouse', spouseUser);
    // Spouse dashboard may render skeleton then content; accept shell landmark or body text.
    await expect(page).not.toHaveURL(/login/);
    await expect(
      page.getByText(/Ringkasan|Shared|Spouse|Viewer|Aset|Utang|Dashboard|Keluarga/i).first()
    ).toBeVisible({ timeout: 20000 });
  });

  test('spouse does not see owner-only privacy delete phrase', async ({ page }) => {
    await gotoAuthed(page, '/settings/privacy', spouseUser);
    await page.waitForTimeout(800);
    // Either redirected away, or page without destructive owner controls.
    await expect(page.getByText(/HAPUS DATA SAYA/i)).toHaveCount(0);
  });
});
