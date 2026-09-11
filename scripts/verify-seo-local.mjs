import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';

const origin = process.env.SEO_TEST_ORIGIN || 'http://localhost:3108';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Local verification only');
const output = new URL('../artifacts/seo-20260911/', import.meta.url);
await mkdir(output, { recursive: true });
const report = { origin, pages: [], crawlers: [], private: [], images: [], sitemapUrls: 0 };
const agent = 'kakaotalk-scrap/1.0';
const paths = ['/', '/live', '/celebrities', '/c/ifewknow', '/live/ifew-100-days-tiktok-20260912', '/guide', '/pages/ifew-fan-guide', '/pages/elina-fan-guide', '/pages/us-fanmeetings'];
for (const path of paths) {
  for (const locale of ['ko', 'en']) {
    const response = await fetch(`${origin}${path}?locale=${locale}&utm_source=seo-check`, { headers: { 'user-agent': agent } });
    assert.equal(response.status, 200, `${path} ${locale}`);
    const html = await response.text();
    const doc = new JSDOM(html).window.document;
    const meta = (key) => doc.head.querySelector(`meta[property="${key}"],meta[name="${key}"]`)?.content;
    const canonical = doc.head.querySelector('link[rel="canonical"]')?.href;
    assert.equal(canonical, `https://byus.kr${path}?locale=${locale}`);
    assert.equal(meta('og:url'), canonical);
    assert.equal(meta('og:type'), 'website');
    assert.equal(meta('og:site_name'), 'ByUs');
    assert.equal(meta('twitter:card'), 'summary_large_image');
    assert.equal(meta('og:locale'), locale === 'en' ? 'en_US' : 'ko_KR');
    assert.equal(doc.documentElement.lang, locale);
    assert(meta('description'));
    assert(meta('og:image'));
    assert.equal(meta('twitter:image'), meta('og:image'));
    assert(meta('og:image:alt'));
    assert(!meta('robots')?.includes('noindex'));
    if (path === '/' || path === '/guide') {
      const schemas = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((node) => JSON.parse(node.textContent));
      if (path === '/') assert(schemas.some((schema) => schema['@graph']?.some((entity) => entity['@type'] === 'WebSite')));
      if (path === '/guide') {
        const faq = schemas.find((schema) => schema['@type'] === 'FAQPage');
        assert.equal(faq?.mainEntity.length, 6);
        for (const question of faq.mainEntity) {
          assert(doc.body.textContent.includes(question.name));
          assert(doc.body.textContent.includes(question.acceptedAnswer.text));
        }
      }
    }
    for (const other of ['ko', 'en']) assert.equal(doc.head.querySelector(`link[hreflang="${other}"]`)?.href, `https://byus.kr${path}?locale=${other}`);
    if (path.startsWith('/live/')) {
      assert(doc.querySelector('h1')?.textContent?.trim(), 'LIVE title must be in initial HTML');
      assert(doc.body.textContent.includes('KST'), 'LIVE timezone must be in initial HTML');
      assert(doc.body.textContent.toLowerCase().includes('tiktok'));
    }
    report.pages.push({ path, locale, title: doc.title, canonical, image: meta('og:image') });
    if (locale === 'ko' && ['/', '/pages/ifew-fan-guide'].includes(path)) {
      const localImage = new URL(meta('og:image'));
      const imageResponse = await fetch(`${origin}${localImage.pathname}${localImage.search}`);
      assert.equal(imageResponse.status, 200);
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      const info = await sharp(bytes).metadata();
      assert(info.width <= 1200);
      assert(bytes.length < 1024 * 1024, 'Share image should be under 1 MiB');
      const name = path === '/' ? 'default-share.png' : `ifew-share.${info.format}`;
      await writeFile(new URL(name, output), bytes);
      report.images.push({ name, bytes: bytes.length, width: info.width, height: info.height, format: info.format });
    }
  }
}
for (const userAgent of ['facebookexternalhit/1.1', 'Twitterbot', 'TelegramBot', 'Yeti', 'OAI-SearchBot']) {
  const response = await fetch(`${origin}/?locale=ko`, { headers: { 'user-agent': userAgent } });
  assert.equal(response.status, 200);
  const doc = new JSDOM(await response.text()).window.document;
  assert(doc.head.querySelector('meta[property="og:image"]'), userAgent);
  report.crawlers.push(userAgent);
}
const robots = await fetch(`${origin}/robots.txt`);
assert.equal(robots.status, 200);
assert(robots.headers.get('content-type').includes('text/plain'));
assert((await robots.text()).includes('Sitemap: https://byus.kr/sitemap.xml'));
const sitemap = await fetch(`${origin}/sitemap.xml`);
assert.equal(sitemap.status, 200);
const xml = await sitemap.text();
const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
const urls = [...doc.querySelectorAll('url > loc')].map((node) => node.textContent);
assert(urls.length >= 12);
assert.equal(new Set(urls).size, urls.length);
assert(!urls.some((url) => /rehearsal|\/my|\/admin|\/verify|\/passports/.test(url)));
assert(urls.every((url) => /^https:\/\/byus\.kr\/.*\?locale=(ko|en)$/.test(url)));
report.sitemapUrls = urls.length;
await writeFile(new URL('sitemap.xml', output), xml);
for (const path of ['/my', '/admin', '/passports', '/settings', '/notifications', '/live/ifew-100-days-tiktok-20260912-rehearsal']) {
  const response = await fetch(`${origin}${path}`, { headers: { 'user-agent': agent } });
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  const document = new JSDOM(await response.text()).window.document;
  assert(document.querySelector('meta[name="robots"]')?.content.includes('noindex'));
  report.private.push({ path, status: response.status, noindex: true });
}
for (const path of ['/api/me/rewards', '/api/admin/session', '/api/passports']) {
  const response = await fetch(`${origin}${path}`);
  assert.equal(response.status, 401, `Unauthenticated ${path}`);
}
for (const path of ['/live/nonexistent-seo-check', '/c/nonexistent-seo-check']) {
  const response = await fetch(`${origin}${path}`, { headers: { 'user-agent': agent } });
  assert.equal(response.status, 404, path);
}
await writeFile(new URL('verification.json', output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
