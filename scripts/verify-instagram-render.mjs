// Local production-render verification. Media/network responses are fixtures, NOT live IG evidence.
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const base = process.env.INSTAGRAM_RENDER_BASE_URL ?? 'http://localhost:4319';
if (new URL(base).hostname !== 'localhost') throw Error('Render tests must target localhost');
const expectedRef = 'xcppyedwusirqnfpbtit';
if (process.env.SUPABASE_DEV_PROJECT_REF !== expectedRef || new URL(process.env.SUPABASE_DEV_URL).hostname !== `${expectedRef}.supabase.co`) throw Error('Only known Dev Supabase is allowed');
const db = createClient(process.env.SUPABASE_DEV_URL, process.env.SUPABASE_DEV_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const output = fileURLToPath(new URL('../docs/integrations/instagram-render-proof/', import.meta.url));
await mkdir(output, { recursive: true });
const { data: celebrity, error } = await db.from('celebrities').select('id').eq('slug', 'katseye').single();
if (error) throw Error('Dev fixture celebrity unavailable');
const { data: existing, error: existingError } = await db.from('instagram_connections').select('celebrity_id').eq('celebrity_id', celebrity.id).maybeSingle();
if (existingError || existing) throw Error('Refusing to overwrite an existing Instagram connection slot');
const username = 'byus_connection_check';
const browser = await chromium.launch({ headless: true });
const evidence = { kind: 'Local production UI + Dev flow storage + intercepted Instagram fixtures; NO actual Instagram OAuth/media', checks: [] };
const rpc = async (name, args) => { const result = await db.rpc(name, args); if (result.error) throw Error(`Fixture operation ${name} failed`); return result.data; };
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const invite = secret();
    await rpc('instagram_issue_invite', { p_celebrity_id: celebrity.id, p_secret_hash: hash(invite), p_username: username, p_user_id: null });
    await page.goto(`${base}/connect/instagram/start?invite=${invite}`);
    await page.getByRole('button', { name: 'Instagram으로 연결하기' }).waitFor();
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Instagram으로 연결하기' }).evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${output}/start-${width}.png`, fullPage: true });
    // Fulfill the outbound authorization navigation in-browser: no test request goes to Meta.
    let oauthUrl;
    // CDP interception includes redirect hops, unlike Playwright route matching.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*instagram.com/*', requestStage: 'Request' }] });
    cdp.on('Fetch.requestPaused', async (event) => {
      const url = new URL(event.request.url);
      if (url.pathname.replace(/\/$/, '') === '/oauth/authorize') oauthUrl = url;
      await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
        body: Buffer.from('<title>OAuth navigation verified</title><p>Navigation intercepted by the test.</p>').toString('base64') });
    });
    await page.getByRole('button', { name: 'Instagram으로 연결하기' }).click();
    try { await page.waitForURL('https://www.instagram.com/oauth/authorize?*', {timeout:5000}); }
    catch { await page.screenshot({path:`${output}/navigation-failure.png`,fullPage:true}); console.log({pagePath:new URL(page.url()).pathname, heading:await page.locator('h1').textContent().catch(()=>null)}); throw Error('OAuth form navigation failed'); }
    assert.equal(oauthUrl.searchParams.get('scope'), 'instagram_business_basic');
    assert.equal(oauthUrl.searchParams.get('force_reauth'), 'true');
    evidence.checks.push(`start ${width}: keyboard focus, no overflow, CSP permits actual form→Instagram navigation (intercepted)`);
    // Exercise confirmation UI through actual DB state transitions, without a provider token.
    const cookies = await context.cookies(base);
    const browserCookie = cookies.find((item) => item.name === 'byus_ig_browser')?.value;
    assert.ok(browserCookie);
    const state = oauthUrl.searchParams.get('state');
    await rpc('instagram_transition', { p_operation: 'consume', p_secret_hash: hash(state), p_browser_hash: hash(browserCookie) });
    const pending = secret();
    await rpc('instagram_transition', { p_operation: 'pending', p_secret_hash: hash(state), p_browser_hash: hash(browserCookie), p_payload: {
      next_hash: hash(pending), identity: { id: '102000000000001', user_id: '178400000000001', username, account_type: 'BUSINESS' },
      token_ciphertext: 'render-fixture-no-real-token', token_issued_at: new Date().toISOString(), token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    } });
    await context.addCookies([{ name: 'byus_ig_pending', value: pending, url: base, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto(`${base}/connect/instagram/confirm`);
    await page.getByRole('heading', { name: '이 계정으로 연결할까요?' }).waitFor();
    await page.screenshot({ path: `${output}/confirm-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '연결 취소', exact: true }).click();
    await page.getByRole('heading', { name: '연결을 취소했어요' }).waitFor();
    evidence.checks.push(`confirmation ${width}: separate target/account, real native cancellation submitted`);
    await context.close();
  }
  const images = [
    await readFile(new URL('../apps/web/public/images/celebrities/katseye/hero-mobile.webp', import.meta.url)),
    await readFile(new URL('../apps/web/public/images/celebrities/katseye/live-upcoming-1.webp', import.meta.url)),
    await readFile(new URL('../apps/web/public/images/celebrities/katseye/hero-mobile.webp', import.meta.url)),
  ];
  const items = ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'].map((mediaType, index) => ({ id: String(index + 1), mediaType, mediaProductType: mediaType === 'VIDEO' ? 'REELS' : 'FEED', imageUrl: `https://cdninstagram.com/byus-render-${index}.webp`, permalink: `https://www.instagram.com/p/byusrender${index}/`, caption: ['오늘 함께한 순간을 남겨요', '새로운 무대에서 만나요', '우리의 소중한 하루'][index], timestamp: new Date().toISOString(), sourceAccount: { id: '178400000000001', username: 'katseyeworld' } }));
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    await page.route('**/api/celebrities/katseye/instagram', (route) => route.fulfill({ json: { items, updatedAt: new Date().toISOString() } }));
    await page.route('https://cdninstagram.com/byus-render-*.webp', (route) => route.fulfill({ contentType: 'image/webp', body: images[Number(/render-(\d)/.exec(route.request().url())[1])] }));
    await page.goto(`${base}/c/katseye?locale=ko`);
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '최근 활동', exact: true }) }).last();
    await section.waitFor();
    await section.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('img[src*="byus-render-"]')].every((img) => img.complete && img.naturalWidth > 0));
    assert.equal(await section.locator('a').count(), 3);
    assert.equal(await section.locator('svg').count(), 1);
    const boxes = await section.locator('img').evaluateAll((nodes) => nodes.map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
    assert.ok(boxes.every((box) => Math.abs(box.width / box.height - 9 / 16) < .005));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await section.locator('a').last().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const nodes=[...document.querySelectorAll('img[src*="byus-render-"]')]; return nodes.length===3 && nodes.every(n=>n.complete && n.naturalWidth>0); });
    if (width === 390) await section.screenshot({ path: `${output}/cards-${width}-end.png` });
    await section.locator('a').first().scrollIntoViewIfNeeded();
    await section.screenshot({ path: `${output}/cards-${width}.png` });
    await page.screenshot({ path: `${output}/fanpage-${width}.png`, fullPage: true });
    const popupPromise = context.waitForEvent('page');
    await context.route('https://www.instagram.com/p/byusrender0/', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Original link verified</title>' }));
    await section.locator('a').first().click();
    const popup = await popupPromise; await popup.waitForLoadState();
    assert.equal(new URL(popup.url()).origin, 'https://www.instagram.com');
    await popup.close();
    evidence.checks.push(`cards ${width}: three 9:16 images, video-only play mark, no page overflow, original permalink popup (intercepted)`);
    await context.close();
  }
  await writeFile(`${output}/verification.json`, JSON.stringify(evidence, null, 2));
  console.log('PASS: desktop/mobile start + confirm/cancel + CSP external form navigation + three media cards + original-link popup. All Meta responses were intercepted fixtures.');
} finally {
  await browser.close();
  // Only this run's initially absent slot is removed. Existing celebrity rows never change.
  const removed = await db.from('instagram_connections').delete().eq('celebrity_id', celebrity.id);
  if (removed.error) throw Error('Render fixture cleanup failed');
}
