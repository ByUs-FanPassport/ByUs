const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = '/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911';
const req = createRequire(root + '/package.json');
const { chromium } = req('@playwright/test');
const sharp = req('sharp');
const out = path.resolve(__dirname, '..');
(async () => {
 const local = [];
 async function walk(dir) { for(const e of fs.readdirSync(dir, {withFileTypes:true})) { const p=path.join(dir,e.name); if(e.isDirectory()) await walk(p); else if(/\.(jpg|jpeg|png|webp|avif)$/i.test(p)) {try {const m=await sharp(p).metadata();local.push({src:p.slice((root+'/apps/web/public').length),width:m.width,height:m.height,ratio:Number((m.width/m.height).toFixed(4)),format:m.format,bytes:fs.statSync(p).size});}catch(e){local.push({src:p,error:e.message});}} }}
 await walk(root+'/apps/web/public/images');
 fs.writeFileSync(out+'/local-assets.json',JSON.stringify(local,null,2));
 const browser=await chromium.launch({headless:true});
 const records=[];
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000},deviceScaleFactor:1,locale:'ko-KR',reducedMotion:'reduce'});
  // This isolated verification context starts with zero pages; no user tabs are touched.
  const existing=context.pages(); const page=existing[0] || await context.newPage();
  for(const [name,route] of [['home','/'],['ifew','/c/ifewknow'],['jenny','/c/jenny-jeong'],['live','/live/ifew-100-days-tiktok-20260912'],['guide','/pages/ifew-fan-guide']]) {
   const resp=await page.goto('http://127.0.0.1:3217'+route,{waitUntil:'domcontentloaded',timeout:45000});
   await page.waitForFunction(()=>Array.from(document.images).filter(i=>i.getBoundingClientRect().top<innerHeight).every(i=>i.complete),{timeout:10000}).catch(()=>{});
   await page.evaluate(()=>document.fonts.ready); 
   await page.screenshot({path:out+`/evidence/${name}-${width}.png`,fullPage:false});
   const data=await page.evaluate(()=>({title:document.title,url:location.pathname,images:Array.from(document.images).map(i=>{const r=i.getBoundingClientRect(),s=getComputedStyle(i),p=i.parentElement.getBoundingClientRect();let src=i.currentSrc||i.src;try{const u=new URL(src);src=u.pathname==='/_next/image'?u.searchParams.get('url'):u.origin===location.origin?u.pathname:src;}catch{}return {alt:i.alt,src,naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight,box:{x:r.x,y:r.y,width:r.width,height:r.height},parentBox:{width:p.width,height:p.height},fit:s.objectFit,position:s.objectPosition,transform:s.transform,display:s.display,visible:r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0,loaded:i.complete&&i.naturalWidth>0};})}));
   records.push({name,width,status:resp.status(),...data});
   console.log(name,width,resp.status(),data.images.length,'images');
  }
  await context.close();
 }
 await browser.close();
 fs.writeFileSync(out+'/render-measurements.json',JSON.stringify(records,null,2));
 // Measure public remote image originals observed in the actual local renders.
 const remote=[]; const seen=new Set();
 for(const rec of records) for(const i of rec.images) if(/^https:/.test(i.src)&&!seen.has(i.src)){seen.add(i.src);try{const r=await fetch(i.src,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('HTTP '+r.status);const b=Buffer.from(await r.arrayBuffer());const m=await sharp(b).metadata();remote.push({src:i.src,width:m.width,height:m.height,ratio:Number((m.width/m.height).toFixed(4)),format:m.format,bytes:b.length});}catch(e){remote.push({src:i.src,error:e.message});}}
 fs.writeFileSync(out+'/observed-remote-assets.json',JSON.stringify(remote,null,2));
 console.log('local',local.length,'remote',remote.length);
})().catch(e=>{console.error(e);process.exit(1)});
