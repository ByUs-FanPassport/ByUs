import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startHarness } from './server.mjs';
const out='test-results/community-stamps-local'; await mkdir(out,{recursive:true});
const harness=await startHarness(); const browser=await chromium.launch(); const checks=[];
try {
 for(const locale of ['ko','en']) for(const width of [360,1440]) {
 const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'}); const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let stamps=[];const actions=[];const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await page.route('**/api/live-events/calendar*',route=>{const month=new URL(route.request().url()).searchParams.get('month');const [y,m]=month.split('-').map(Number);const days=Array.from({length:new Date(Date.UTC(y,m,0)).getUTCDate()},(_,i)=>({date:`${month}-${String(i+1).padStart(2,'0')}`,events:[]}));return route.fulfill({json:{month,timeZone:'Asia/Seoul',days}});});
 await page.route('**/api/community-stamps**',async route=>{
  const action=new URL(route.request().url()).pathname.split('/')[3];
  let result={stamps,today};
  if(route.request().method()==='POST') {
   actions.push(action);
   if(action==='welcome') {stamps=[{id:'11111111-1111-4111-8111-111111111111',kind:'welcome',celebritySlug:null,issuedAt:'2026-09-13T00:00:00Z',mint:{status:'queued',txHash:null,tokenId:null}}];result={awarded:true};}
   else if(action==='check-in') {stamps.push({id:'22222222-2222-4222-8222-222222222222',kind:'daily_checkin',celebritySlug:'elina',issuedAt:new Date().toISOString(),mint:{status:'queued',txHash:null,tokenId:null}});result={awarded:true};}
   else if(action==='invite-code') result={code:'A1B2C3D4E5F60718293A4B5C',redeemed:false};
   else result={awarded:true};
  }
  await route.fulfill({json:result});
 });
 await page.goto(`${harness.baseURL}/?locale=${locale}`);
 await expect(page.getByRole('heading',{name:locale==='ko'?'스탬프 모으기':'Collect Stamps'})).toBeVisible();
 await expect(page.getByRole('button',{name:locale==='ko'?'가입 스탬프 받기':'Get welcome Stamp'})).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'no horizontal overflow');
 await page.screenshot({path:`${out}/${locale}-${width}-fresh.png`,fullPage:true});
 await page.getByRole('button',{name:locale==='ko'?'가입 스탬프 받기':'Get welcome Stamp'}).click();
 await expect(page.getByRole('button',{name:locale==='ko'?'스탬프 보기':'View Stamp'})).toBeVisible();
 await page.getByRole('button',{name:locale==='ko'?'스탬프 보기':'View Stamp'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:locale==='ko'?'친구 초대하기':'Invite a friend'}).click();
 await expect(page.getByText('A1B2C3D4E5F60718293A4B5C',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:locale==='ko'?'복사':'Copy',exact:true}).click();
 assert.deepEqual(actions,['welcome','invite-code'],'copy does not award');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), '24-character invite code fits');
 await page.screenshot({path:`${out}/${locale}-${width}-earned-invite.png`,fullPage:true});
 await page.getByRole('button',{name:locale==='ko'?'오늘 출석하기':'Check in today',exact:true}).click();
 await expect(page.getByRole('button',{name:locale==='ko'?'오늘 출석 완료':'Checked in today',exact:true})).toBeDisabled();
 await expect(page.locator('[data-checked-in=true]')).toHaveCount(1);
 await page.screenshot({path:`${out}/${locale}-${width}-checkin.png`,fullPage:true});
 const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();assert.deepEqual(audit.violations.map(v=>v.id),[]);
 assert.deepEqual(errors,[]);checks.push(`${locale}/${width}: artwork, overflow, award refresh, dialog Escape, copy no award, axe`);await context.close();
 }
 await writeFile(`${out}/evidence.json`,JSON.stringify({boundary:'Actual community stamp component and CSS, loopback fixture auth/API. No real accounts, database or chain actions.',checks},null,2));console.log(checks.join('\n'));
} finally {await browser.close();await harness.server.close();}
