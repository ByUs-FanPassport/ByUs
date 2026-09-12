import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startHarness } from './server.mjs';
const out='test-results/community-stamp-share-local'; await mkdir(out,{recursive:true});
const harness=await startHarness(4194), browser=await chromium.launch(), checks=[];
try {
 for(const locale of ['ko','en']) for(const width of [360,1440]) {
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],actions=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.__shares=[];window.__copies=[];
   Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.__shares.push(data);throw new DOMException('Cancelled','AbortError');}});
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copies.push(value);}}});
  });
  await page.route('**/api/live-events/calendar*',route=>route.fulfill({json:{month:'2026-09',timeZone:'Asia/Seoul',days:[]}}));
  await page.route('**/api/community-stamps**',async route=>{
   const action=new URL(route.request().url()).pathname.split('/')[3];
   if(route.request().method()==='POST'){
    actions.push({action,body:route.request().postDataJSON()});
    await new Promise(resolve=>setTimeout(resolve,150));
    return route.fulfill({json:action==='share-link'?{token:'a'.repeat(32)}:{creator:'elina'}});
   }
   return route.fulfill({json:{stamps:[],today:'2026-09-13'}});
  });
  await page.goto(`${harness.baseURL}/?view=sender&locale=${locale}`);
  const create=page.getByRole('button',{name:locale==='ko'?'공유 링크 만들기':'Create share link'});
  await create.click();
  await expect(page.getByRole('textbox',{name:locale==='ko'?'공유 링크':'Share link'})).toHaveValue(`${harness.baseURL}/s/${'a'.repeat(32)}?locale=${locale}`);
  assert.deepEqual(await page.evaluate(()=>window.__shares),[],'creating link does not open native share');
  await page.getByRole('button',{name:locale==='ko'?'복사':'Copy',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.__copies)).length,1);
  await page.getByRole('button',{name:locale==='ko'?'공유':'Share',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  assert.deepEqual(actions.map(a=>a.action),['share-link'],'copy and cancelled share never award or verify');
  await page.evaluate(()=>document.fonts.ready);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.evaluate(()=>[...document.querySelectorAll('input,button,section')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;})),'controls and card remain inside viewport even with overflow clipping');
  await page.screenshot({path:`${out}/${locale}-${width}-sender.png`,fullPage:true});
  await page.goto(`${harness.baseURL}/?view=recipient&locale=${locale}&auth=off`);
  const login=page.getByRole('link',{name:locale==='ko'?'로그인하고 최애 보기':'Sign in to view favorite'});
  await expect(login).toBeVisible();
  assert((await login.getAttribute('href')).includes(encodeURIComponent(`/s/${'a'.repeat(32)}?locale=${locale}`)));
  assert.deepEqual(actions.map(a=>a.action),['share-link'],'anonymous page view never awards');
  await page.screenshot({path:`${out}/${locale}-${width}-recipient-signed-out.png`,fullPage:true});
  await page.goto(`${harness.baseURL}/?view=recipient&locale=${locale}`);
  await expect(page.getByRole('button',{name:locale==='ko'?'최애 보기':'View favorite',exact:true})).toBeVisible();
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
  await page.evaluate(()=>document.fonts.ready);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(audit.violations.map(v=>v.id),[]);
  await page.screenshot({path:`${out}/${locale}-${width}-recipient.png`,fullPage:true});
  await page.getByRole('button',{name:locale==='ko'?'최애 보기':'View favorite',exact:true}).dblclick();
  await page.waitForURL(`**/c/elina?locale=${locale}`);
  assert.deepEqual(actions.map(a=>a.action),['share-link','share-visit'],'explicit confirmation sends one visit despite duplicate click');
  assert.deepEqual(actions[1].body,{token:'a'.repeat(32)});
  assert.deepEqual(errors,[]);
  checks.push(`${locale}/${width}: create separate from native gesture, copy/cancel/anonymous no award, signed-in explicit visit once, login returnTo, images, no overflow, axe`);
  await context.close();
 }
 await writeFile(`${out}/evidence.json`,JSON.stringify({boundary:'Actual production UI/CSS, synthetic auth and API on localhost. Database security is verified separately in disposable PostgreSQL; no real accounts or mint actions.',checks},null,2));
 console.log(checks.join('\n'));
} finally {await browser.close();await harness.server.close();}
