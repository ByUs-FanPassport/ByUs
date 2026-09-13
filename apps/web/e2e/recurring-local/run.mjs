import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHarness } from "./server.mjs";
const output=path.resolve("test-results/recurring-local");await mkdir(output,{recursive:true});
const server=await startHarness();const browser=await chromium.launch();
const result={boundary:"Actual monthly calendar, detail, catalog and admin components; local synthetic recurring data, guest identity, placeholder existing creator image. No production writes or physical-device claim.",checks:[],screenshots:[]};
try{
 for(const locale of ['ko','en'])for(const width of [360,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:"reduce"});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [name,url] of [['calendar',`/live/calendar?month=2026-10&locale=${locale}`],['detail',`/live/ifew-recurring-0?locale=${locale}`],['catalog',`/live?locale=${locale}`],['admin',`/admin?locale=${locale}`],['manager',`/admin/lives?locale=${locale}`]]){
   await page.goto(server.baseURL+url);await page.evaluate(()=>document.fonts.ready);
   if(name==='calendar'){await expect(page.locator('a[href*="/live/ifew-recurring-2"]')).toHaveCount(1);await expect(page.locator('a[href*="month=2026-11"]').first()).toBeVisible();}
   if(name==='detail'){await expect(page.getByText(locale==='ko'?'정기 방송 · 종료 시간 미정':'Recurring LIVE · End time unconfirmed',{exact:true})).toBeVisible();assert.equal(await page.locator('a[href*="calendar.google.com"]').count(),0);assert.equal(await page.locator('#fan-code').count(),0);await expect(page.getByRole('link',{name:locale==='ko'?'방송 채널':'Broadcast channel',exact:true})).toBeVisible();}
   if(name==='catalog') await expect(page.getByText(/End time unconfirmed|종료 시간 미정/).first()).toBeVisible();
   if(name==='manager') {await page.getByRole('button',{name:/이퓨 정기 방송|IfeW recurring LIVE/}).click();await expect(page.getByLabel('Ends (KST)',{exact:true})).toHaveValue('');await expect(page.getByLabel('Attendance closes (KST)',{exact:true})).toHaveValue('');await expect(page.getByLabel('Attendance closes (KST)',{exact:true})).toBeEnabled();}
   if(name==='admin') {await expect(page.getByText(locale==='ko'?'정기 규칙 확인':'Regular rule found',{exact:true})).toBeVisible();assert.equal(await page.getByRole('button',{name:/Approve rule|규칙 승인/}).count(),0);}
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}/${locale}/${width} overflow`);
   const file=path.join(output,`${name}-${locale}-${width}.png`);await page.screenshot({path:file,fullPage:true});result.screenshots.push(file);
  }
  assert.deepEqual(errors,[]);result.checks.push(`${locale}/${width}: month navigation and sixth-week real slug, unknown end, no fake calendar end or attendance, catalog/admin render`);await page.close();
 }
 await writeFile(path.join(output,'evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await server.close();}
