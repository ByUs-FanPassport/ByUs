import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseURL = process.env.TICKET_HARNESS_URL ?? 'http://127.0.0.1:4197';
const output = 'work/ticket-typography-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const failures = [];
try {
  for (const width of [360, 390, 1440]) {
    for (const locale of ['ko', 'en']) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.route('**/api/celebrities/elina/cheers?*', route => route.fulfill({ json: { total: 0, comments: [], nextCursor: null } }));
      await page.goto(`${baseURL}/typography?locale=${locale}`, { waitUntil: 'domcontentloaded' });
      const guide = page.getByRole('region', { name: locale === 'ko' ? '응모권 모으기' : 'Collect raffle tickets', exact: true });
      await guide.getByText(locale === 'ko' ? '장 보유' : 'tickets', { exact: true }).waitFor();
      const balance = guide.locator('strong').filter({ has: page.locator('small') });
      const sameLine = await balance.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element.firstChild);
        const number = range.getBoundingClientRect();
        const unit = element.querySelector('small').getBoundingClientRect();
        return unit.x >= number.right - 1 && unit.top < number.bottom && unit.bottom > number.top;
      });
      const textarea = page.getByRole('textbox', { name: locale === 'ko' ? '응원 남기기' : 'Leave a cheer' });
      const fonts = await textarea.evaluate(element => ({ input: getComputedStyle(element).fontSize, placeholder: getComputedStyle(element, '::placeholder').fontSize }));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (!sameLine) failures.push(`${width}/${locale}: ticket number and unit wrap`);
      if (fonts.placeholder !== '14px') failures.push(`${width}/${locale}: placeholder is ${fonts.placeholder}`);
      assert.equal(fonts.input, '16px');
      assert.equal(overflow, false);
      await page.screenshot({ path: `${output}/balance-${locale}-${width}.png` });
      await textarea.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/placeholder-${locale}-${width}.png` });
      await textarea.fill(locale === 'ko' ? '오늘도 응원해요!' : 'Cheering you on!');
      assert.equal(await textarea.inputValue(), locale === 'ko' ? '오늘도 응원해요!' : 'Cheering you on!');
      assert.equal(await page.getByRole('button', { name: locale === 'ko' ? '응원 보내기' : 'Post cheer' }).isEnabled(), true);
      results.push({ width, locale, sameLine, ...fonts, overflow });
      await page.close();
    }
  }
  console.log(JSON.stringify({ results, failures }, null, 2));
  assert.deepEqual(failures, []);
} finally { await browser.close(); }
