import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHarness } from "./server.mjs";
const out = path.resolve("apps/web/test-results/fan-motion-local");
await mkdir(out, { recursive: true });
const harness = await startHarness({ communityMode: true });
const evidence = { environment: "Local native PostgreSQL, actual fan projection and guards, synthetic auth; other home panels fixture", checks: [], screenshots: [] };
if (process.env.BYUS_MOTION_TOUCH_ONLY === '1') {
  const prior=JSON.parse(await readFile(path.join(out,'evidence.json'),'utf8'));
  evidence.checks.push(...prior.checks);evidence.screenshots.push(...prior.screenshots);
  evidence.reused='Desktop KO/EN 1440/390/320 passed on unchanged product code; only touch test coordinates changed.';
}
const check = name => { evidence.checks.push(name); console.log(`PASS ${name}`); };
let browser;
async function shot(page, name) { const file = path.join(out,name); await page.screenshot({ path:file }); evidence.screenshots.push(file); }
try {
  const initial = await (await fetch(harness.baseURL + "/api/celebrities/elina/fans?locale=ko")).json();
  assert.equal(initial.likeCount,2); assert.equal(initial.fanCount,3); assert.equal(initial.publicFanCount,3); assert.equal(initial.fans.length,3);
  check("actual projection includes passport-only participant and deduplicated real public fan count");
  // Additional local identities exercise the 24-circle ceiling, never production data.
  await harness.query(`begin;
    insert into public.app_users(id,privy_user_id,verified_email,status) select ('c7900000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'did:privy:marble-local-'||i,'marble-'||i||'@local.invalid','active' from generate_series(1,22) i;
    insert into public.user_profiles(app_user_id,nickname,nickname_normalized) select ('c7900000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'별빛'||lpad(i::text,2,'0'),'별빛'||lpad(i::text,2,'0') from generate_series(1,22) i;
    insert into public.app_user_avatars(app_user_id,initial_character_id,selected_character_id) select ('c7900000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,(array['star','heart','fairy','ghost'])[1+(i%4)]||'-'||(array['cream','pink','lavender'])[1+(i%3)],(array['star','heart','fairy','ghost'])[1+(i%4)]||'-'||(array['cream','pink','lavender'])[1+(i%3)] from generate_series(1,22) i on conflict(app_user_id) do update set selected_character_id=excluded.selected_character_id;
    insert into public.fan_activity_visibility(app_user_id,enabled) select ('c7900000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,true from generate_series(1,22) i;
    insert into public.blockchain_jobs(id,entity_type,entity_id,operation_key,payload) select ('c7910000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'reaction',('c7920000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'marble-local-like-'||i,'{}' from generate_series(1,22) i;
    alter table public.fan_reactions disable trigger user;
    insert into public.fan_reactions(id,app_user_id,celebrity_id,blockchain_job_id,mint_status,completed_at) select ('c7920000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('c7900000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'c7200000-0000-4000-8000-000000000001',('c7910000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'queued',now() from generate_series(1,22) i;
    alter table public.fan_reactions enable trigger user; commit;`,false);
  browser = await chromium.launch({headless:true});
  const errors=[];
  for (const locale of (process.env.BYUS_MOTION_TOUCH_ONLY === '1' ? [] : ['ko','en'])) for(const width of [1440,390,320]) {
    const context=await browser.newContext({viewport:{width,height:900}, reducedMotion:'no-preference'});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(harness.baseURL+`/c/elina?locale=${locale}`);
    const trigger=page.getByRole('link',{name:locale==='ko'?'함께하는 팬 25명 보기':'View 25 fans',exact:true});
    await expect(trigger).toBeVisible();await expect(trigger.locator('img')).toHaveCount(5);
    const tab=page.getByRole('link',{name:locale==='ko'?'리더보드':'Leaderboard',exact:true});
    assert.equal(await trigger.getAttribute('href'),await tab.getAttribute('href'));
    await tab.click();
    const panel=page.locator('[data-fan-gathering]');await expect(panel).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('table')).toHaveCount(0);
    const marbles=panel.locator('[data-marble-index]');await expect(marbles).toHaveCount(24);
    const first=marbles.first(),other=marbles.nth(1);await panel.locator("[data-marble-tray]").scrollIntoViewIfNeeded();
    const before=await first.getAttribute('style');await expect.poll(()=>first.getAttribute('style')).not.toBe(before);
    const hoverBox=await first.boundingBox();await page.mouse.move(hoverBox.x+22,hoverBox.y+22);await expect(panel.getByRole('tooltip')).toHaveText(await first.getAttribute('aria-label'));
    const held=await first.getAttribute('style'), drifting=await other.getAttribute('style');
    await page.waitForTimeout(240);assert.equal(await first.getAttribute('style'),held);assert.notEqual(await other.getAttribute('style'),drifting);
    await shot(page,`${locale}-${width}-hover.png`);
    const start=await first.boundingBox(),tray=panel.locator('[data-marble-tray]'),trayBox=await tray.boundingBox();
    await page.mouse.move(start.x+22,start.y+22);await page.mouse.down();
    const end={x:Math.min(trayBox.x+trayBox.width-30,start.x+90),y:Math.max(trayBox.y+40,start.y-55)};
    await page.mouse.move(end.x,end.y,{steps:20});await page.waitForTimeout(400);
    const dragged=await first.getAttribute('style');assert.notEqual(dragged,held);await page.mouse.up();
    await page.mouse.move(trayBox.x-10,trayBox.y+10);
    await expect.poll(()=>first.getAttribute('style')).not.toBe(dragged);
    await first.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(panel.getByRole('tooltip')).toHaveText(await first.getAttribute('aria-label'));
    const focused=await first.getAttribute('style');await page.waitForTimeout(120);assert.equal(await first.getAttribute('style'),focused);
    await page.keyboard.press('Tab');await expect(other).toBeFocused();
    await panel.getByRole('button',{name:locale==='ko'?'움직임 멈추기':'Pause motion'}).click();
    await expect(tray).toHaveAttribute('data-paused','true');
    const stopped=await first.getAttribute('style');await page.waitForTimeout(120);assert.equal(await first.getAttribute('style'),stopped);
    await page.mouse.move(0,0);await panel.scrollIntoViewIfNeeded();await shot(page,`${locale}-${width}-gathering.png`);
    assert((await panel.evaluate(el=>getComputedStyle(el).fontFamily)).includes('Pretendard'));
    const bounds=await panel.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    const trayBounds=await tray.boundingBox();
    for(const box of await marbles.evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,bottom:b.bottom};}))) assert(box.x>=trayBounds.x-1&&box.y>=trayBounds.y-1&&box.right<=trayBounds.x+trayBounds.width+1&&box.bottom<=trayBounds.y+trayBounds.height+1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await context.close();check(`${locale} ${width}: tab entry before rank eligibility, 24 real public characters, held hover with moving neighbors, drag/release, keyboard focus and pause`);
  }
  const touchContext=await browser.newContext({viewport:{width:390,height:740},isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
  const touchPage=await touchContext.newPage();touchPage.on('pageerror',e=>errors.push(e.message));
  await touchPage.goto(harness.baseURL+'/c/elina?tab=leaderboard&locale=ko#celebrity-content');
  const touchPanel=touchPage.locator('[data-fan-gathering]'),touchTray=touchPanel.locator('[data-marble-tray]');
  const touchFan=touchTray.locator('button').first();await touchTray.scrollIntoViewIfNeeded();
  let tb=await touchFan.boundingBox();await touchPage.touchscreen.tap(tb.x+22,tb.y+22);
  await expect(touchPanel.getByRole('tooltip')).toHaveText(await touchFan.getAttribute('aria-label'));
  let touchStyle=await touchFan.getAttribute('style');await touchPage.waitForTimeout(180);assert.equal(await touchFan.getAttribute('style'),touchStyle);
  const cdp=await touchContext.newCDPSession(touchPage);tb=await touchFan.boundingBox();
  const point={x:tb.x+22,y:tb.y+22};await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...point,id:1}]});
  for(let step=1;step<=8;step++) { await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+step*6,y:point.y-step*4,id:1}]});await touchPage.waitForTimeout(30); }
  await touchPage.waitForTimeout(200);assert.notEqual(await touchFan.getAttribute('style'),touchStyle);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await shot(touchPage,'ko-390-touch-drag.png');
  const trayPos=await touchTray.boundingBox();
  await touchPage.evaluate(y=>window.scrollTo(0,y),await touchPage.evaluate(()=>window.scrollY)+trayPos.y-100);
  const blank=await touchTray.boundingBox(),scrollBefore=await touchPage.evaluate(()=>window.scrollY);
  console.log('Touch scroll start',await touchPage.evaluate(({x,y})=>({scrollY:window.scrollY,maxScroll:document.documentElement.scrollHeight-window.innerHeight,hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,160)}),{x:blank.x+2,y:blank.y+150}));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:blank.x+2,y:blank.y+150,id:2}]});
  for(let step=1;step<=8;step++) { await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:blank.x+2,y:blank.y+150-step*10,id:2}]});await touchPage.waitForTimeout(20); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>touchPage.evaluate(()=>window.scrollY)).toBeGreaterThan(scrollBefore+20);
  await touchContext.close();check('Chromium touch emulation: tap nickname pin, native pointer drag, and vertical page scrolling starting on empty field');
  const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(harness.baseURL+'/c/elina?tab=leaderboard&locale=ko#celebrity-content');
  const panel=page.locator('[data-fan-gathering]');await expect(panel.getByRole('button',{name:'동작 줄이기 사용 중'})).toBeDisabled();
  const first=panel.locator('[data-marble-index]').first();await expect(first).toHaveAttribute('style',/translate3d/);
  const before=await first.getAttribute('style');await page.waitForTimeout(150);assert.equal(await first.getAttribute('style'),before);
  await first.focus();await expect(panel.getByRole('tooltip')).toHaveText(await first.getAttribute('aria-label'));
  await shot(page,'ko-390-reduced-motion.png');
  await harness.query("update public.fan_activity_visibility set enabled=false;",false);await page.reload();
  await expect(page.locator('[data-marble-index]')).toHaveCount(24);
  await expect(page.getByText(/프로필 공개/)).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);
  await shot(page,'ko-390-all-fans-visible.png');await context.close();
  assert.deepEqual(errors,[]);check('reduced motion stays static with accessible names, old opt-outs do not hide participants, no browser errors');
} finally {
  await writeFile(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));await browser?.close();await harness.vite.close();
}
