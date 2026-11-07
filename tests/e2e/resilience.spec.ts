import { expect, test } from '@playwright/test';

test('draft survives refresh, contact removal can be undone, and voice samples cache', async ({
  page,
}) => {
  test.setTimeout(120000);
  const budget = await page.request.get('/healthz');
  if (Number(budget.headers()['x-ratelimit-remaining'] ?? 120) < 100)
    await page.waitForTimeout(
      Math.min(60000, (Number(budget.headers()['x-ratelimit-reset'] ?? 60) + 1) * 1000),
    );
  await page.goto('/login?next=/campaigns');
  await page.getByLabel('Email address').fill(process.env.SEED_ADMIN_EMAIL ?? 'demo@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill(process.env.SEED_ADMIN_PASSWORD ?? 'local-demo-passphrase');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Make room for better conversations.' }).waitFor();
  await page.evaluate(() => localStorage.clear());
  await page.goto('/campaigns/new/sales');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Enter your company name.', { exact: true })).toBeVisible();
  await page.getByLabel('Company name', { exact: true }).fill('Synthetic refresh studio');
  await page.getByLabel('What are you offering?').fill('Accessible web applications');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const raw = 'name,phone\nSynthetic,+12025550123\nDuplicate,+12025550123\nInvalid,abc';
  await page.getByLabel('Contacts', { exact: true }).fill(raw);
  await expect(page.getByText('1 valid', { exact: true })).toBeVisible();
  await expect(page.getByText('1 invalid', { exact: true })).toBeVisible();
  await expect(page.getByText('1 duplicate', { exact: true })).toBeVisible();
  await page.getByText('Review or fix 3 contacts', { exact: true }).click();
  await page.getByRole('button', { name: 'Remove contact 2', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Review or fix 3 contacts', { exact: true })).toBeVisible();
  // Wait for the actual stored value before reloading.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(localStorage).some(
          (v) => v.includes('Synthetic refresh studio') && v.includes('Invalid'),
        ),
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.getByLabel('Contacts', { exact: true })).toHaveValue(/Invalid/);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue(
    'Synthetic refresh studio',
  );
  await page.route('**/api/v1/providers', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), simulation: false } });
  });
  let requests = 0;
  // A silent WAV fixture exercises Web Audio decoding and caching under the real CSP.
  // No provider request or real call is made; this does not establish Gnani audio quality.
  const wav = Buffer.alloc(16044);
  wav.write('RIFF');
  wav.writeUInt32LE(16036, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(16000, 40);
  await page.route('**/api/v1/voice-preview', (route) => {
    requests++;
    return requests === 1
      ? route.fulfill({ status: 503, json: { error: 'Test fixture: sample unavailable' } })
      : route.fulfill({ contentType: 'audio/wav', body: wav });
  });
  await page.reload();
  const hear = page.getByRole('button', { name: 'Hear it', exact: true });
  await hear.click();
  await expect(
    page.getByText('Test fixture: sample unavailable', { exact: true }).first(),
  ).toBeVisible();
  await hear.click();
  await expect(hear).toBeEnabled();
  await expect(page.locator('.preview-desktop .field-error')).toHaveCount(0);
  await hear.click();
  await expect(hear).toBeEnabled();
  await expect(page.locator('.preview-desktop .field-error')).toHaveCount(0);
  expect(requests).toBe(2);
  await page.evaluate(() => localStorage.clear());
});
