import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseURL = process.env.TICKET_HARNESS_URL ?? 'http://127.0.0.1:4197';
const output = 'work/ticket-summary-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [360, 1440]) {
    for (const locale of ['ko', 'en']) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${baseURL}/home?locale=${locale}`, { waitUntil: 'domcontentloaded' });
      const summary = page.getByRole('region', { name: locale === 'ko' ? '내 응모권' : 'My tickets', exact: true });
      await summary.waitFor();
      await page.getByText(locale === 'ko' ? '오늘 출석 완료' : 'Checked in today', { exact: true }).waitFor();
      assert.equal(await summary.getByRole('link').count(), 1);
      const box = await summary.boundingBox();
      const content = await page.getByTestId('home-content').boundingBox();
      const gap = content.y - box.y - box.height;
      assert.equal(gap, width === 360 ? 24 : 32);
      assert.ok(box.height <= (width === 360 ? 120 : 80), `Summary too tall: ${box.height}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await page.screenshot({ path: `${output}/summary-${locale}-${width}.png` });
      // The collapsed summary still leads to every earning method in the full guide.
      const link = summary.getByRole('link');
      assert.equal(await link.getAttribute('href'), `/c/elina/tickets?locale=${locale}`);
      await page.goto(`${baseURL}/history?locale=${locale}`, { waitUntil: 'domcontentloaded' });
      await page.getByText(locale === 'ko' ? 'Instagram 멤버십' : 'Instagram membership', { exact: true }).waitFor();
      await page.getByText(locale === 'ko' ? '패스포트 공유' : 'Share Passport', { exact: true }).waitFor();
      assert.deepEqual(errors, []);
      results.push({ locale, width, summaryHeight: box.height, gap, overflow: false });
      await page.close();
    }
  }
  for (const scenario of ['guest', 'error', 'loading']) {
    const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
    await page.goto(`${baseURL}/home?locale=ko&scenario=${scenario}`, { waitUntil: 'domcontentloaded' });
    const state = scenario === 'guest' ? page.getByRole('heading', { name: '응모권 모으기' }) : page.getByRole(scenario === 'error' ? 'alert' : 'status');
    await state.waitFor();
    const panel = page.locator('main section').first();
    assert.ok((await panel.boundingBox()).height <= 150);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360);
    await page.screenshot({ path: `${output}/summary-${scenario}-360.png` });
    await page.close();
  }
  console.log(JSON.stringify({ results, states: ['guest', 'error', 'loading'], fullGuidePreserved: true }, null, 2));
} finally {
  await browser.close();
}
