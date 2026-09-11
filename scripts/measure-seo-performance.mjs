import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const origin = process.env.SEO_TEST_ORIGIN || 'http://localhost:3108';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Local measurement only');
const phase = process.env.SEO_PERFORMANCE_PHASE || 'baseline';
if (!/^[a-z0-9-]+$/.test(phase)) throw new Error('Invalid phase');
const folder = `artifacts/seo-20260911/performance-${phase}`;
await mkdir(folder, { recursive: true });
const all = [];
const pages = [['home','/?locale=ko'], ['guide','/pages/ifew-fan-guide?locale=ko'], ['live','/live/ifew-100-days-tiktok-20260912?locale=ko']];
const selected = process.env.SEO_PERFORMANCE_PAGES?.split(',') ?? pages.map(([name]) => name);
if (selected.some((name) => !pages.some(([known]) => known === name))) throw new Error('Unknown measurement page');
for (const [name, path] of pages.filter(([name]) => selected.includes(name))) {
  for (let run = 1; run <= 3; run++) {
    const output = `${folder}/${name}-${run}.json`;
    const args = ['--yes', 'lighthouse@13.4.1', `${origin}${path}`, '--only-categories=performance,seo', '--form-factor=mobile', '--screenEmulation.mobile=true', '--screenEmulation.width=390', '--screenEmulation.height=844', '--screenEmulation.deviceScaleFactor=2', '--throttling-method=simulate', '--throttling.rttMs=150', '--throttling.throughputKbps=1638.4', '--throttling.cpuSlowdownMultiplier=4', '--chrome-flags=--headless --no-sandbox', '--max-wait-for-load=45000', '--no-enable-error-reporting', '--output=json', `--output-path=${output}`, '--save-assets', '--quiet'];
    await new Promise((resolve, reject) => {
      const child = spawn('npx', args, { stdio: ['ignore','inherit','inherit'], env: { ...process.env, CHROME_PATH: chromium.executablePath() } });
      child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Lighthouse ${name}/${run}: ${code}`)));
    });
    const r = JSON.parse(await readFile(output, 'utf8'));
    if (r.runtimeError) throw new Error(`${name}: ${r.runtimeError.message}`);
    const result = { name, run, url: r.finalDisplayedUrl, lighthouse: r.lighthouseVersion, performance: r.categories.performance.score, seo: r.categories.seo.score, lcpMs: r.audits['largest-contentful-paint'].numericValue, cls: r.audits['cumulative-layout-shift'].numericValue, tbtMs: r.audits['total-blocking-time'].numericValue, fcpMs: r.audits['first-contentful-paint'].numericValue, transferBytes: r.audits['total-byte-weight'].numericValue, warnings: r.runWarnings };
    all.push(result); console.log(JSON.stringify(result));
    await writeFile(`${folder}/runs.json`, JSON.stringify(all, null, 2));
  }
}
const median = (values) => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const summary = selected.map((name)=>{
  const rows=all.filter((r)=>r.name===name);
  return { name, samples:rows.length, metrics:Object.fromEntries(['performance','seo','lcpMs','cls','tbtMs','fcpMs','transferBytes'].map((key)=>{const values=rows.map((r)=>r[key]);return [key,{median:median(values),min:Math.min(...values),max:Math.max(...values)}];})) };
});
await writeFile(`${folder}/summary.json`, JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
