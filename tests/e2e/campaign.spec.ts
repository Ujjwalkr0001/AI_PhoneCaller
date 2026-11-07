import { expect, test } from '@playwright/test';
test('login → HR wizard → CSV → mock launch → result → export', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(process.env.SEED_ADMIN_EMAIL ?? 'demo@example.test');
  await page.getByLabel('Password', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD ?? 'local-demo-passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'A little more human. A lot more possible.' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/dashboard.png', fullPage: true });
  await page.getByRole('link', { name: 'New campaign', exact: true }).click();
  await page.getByRole('button', { name: 'HR & Recruitment' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const name = `Synthetic HR test ${Date.now()}`;
  await page.getByLabel('Campaign name', { exact: true }).fill(name);
  await page.getByLabel('Company name', { exact: true }).fill('Synthetic Orbit');
  await page.getByLabel('Job title', { exact: true }).fill('TypeScript engineer');
  await page.getByLabel('Role summary', { exact: true }).fill('Build accessible React applications. Synthetic job listing.');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/wizard.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Or paste CSV / add a row manually').fill('phone,first_name\n+12025550103,Synthetic');
  await page.getByRole('button', { name: 'Apply column mapping' }).click();
  await expect(page.getByRole('heading', { name: '1 contact rows' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Test allowlist').fill('+12025550103');
  await page.getByRole('checkbox', { name: 'I confirm the operator obligations are met.' }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Launch campaign', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  // Browser transport is independent of PSTN calling hours. The dialer continues enforcing its gate.
  await page.getByRole('button', { name: 'Browser test call', exact: true }).click();
  await page.getByRole('button', { name: 'Start simulation', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Browser test call' });
  await expect(dialog.getByText('Is this a good time?', { exact: false })).toBeVisible();
  for (const [index, text] of ['Yes', 'yes', 'Tell me more', 'No questions', 'Yes, I agree to follow-up'].entries()) {
    await dialog.getByLabel('Simulated caller response').fill(text);
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    if (index < 4) await expect(dialog.locator('.turn.caller')).toHaveCount(index + 1);
    await page.waitForTimeout(500); // Wait for mock playback mark; no live provider involved.
  }
  await expect(dialog.getByText('Call ended', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close browser test' }).click();
  // The campaign is test-mode and the server is explicitly MOCK_MODE=true.
  await page.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible({ timeout: 20000 });
  const download = page.waitForEvent('download'); await page.getByRole('link', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('campaign-results.csv');
  await page.getByRole('button', { name, exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Call result' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/result.png', fullPage: true });
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const campaignId = new URL(page.url()).pathname.split('/').at(-1);
  const removed = await page.request.delete(`/api/v1/campaigns/${campaignId}`, { headers: { 'X-CSRF-Token': session.csrf } });
  expect(removed.ok()).toBe(true);
});
test('mobile layout has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByLabel('Email address').fill('demo@example.test'); await page.getByLabel('Password', { exact: true }).fill('local-demo-passphrase'); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'A little more human. A lot more possible.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'output/playwright/mobile-dark.png', fullPage: true });
});
