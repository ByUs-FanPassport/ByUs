import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { startHarness } from "./server.mjs";
const out = path.resolve("test-results/banner-local"); await mkdir(out, { recursive: true });
const harness = process.env.BANNER_LOCAL_URL ? { baseURL: process.env.BANNER_LOCAL_URL, close: async () => {} } : await startHarness();
const asset = { id: "90000000-0000-4000-8000-000000000003", url: "/images/celebrities/elina/hero-beach.jpg", width: 1360, height: 680, revision: 1, mimeType: "image/jpeg" };
const copy = (locale) => ({ title: locale === "ko" ? "엘리나 정기 방송" : "Regular LIVE with Elina", description: locale === "ko" ? "매주 금요일 오후 8시" : "Every Friday at 8 PM", ctaLabel: locale === "ko" ? "일정 보기" : "View schedule", href: "/live/calendar?celebrity=elina", alt: "Elina", desktopImage: asset, mobileImage: null });
const initial = { items: [{ id: "90000000-0000-4000-8000-000000000001", kind: "regular_live", celebrityId: "90000000-0000-4000-8000-000000000002", publicationStatus: "draft", sortOrder: 0, revision: 1, localizations: { ko: copy("ko"), en: copy("en") } }], celebrities: [{ id: "90000000-0000-4000-8000-000000000002", slug: "elina", nameKo: "엘리나", nameEn: "Elina" }] };
const browser = await chromium.launch(); const checks = [];
try {
 for (const locale of ["ko", "en"]) for (const width of [360,1440]) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const data = structuredClone(initial); const commands = []; const errors=[];
  page.on("pageerror", e=>errors.push(e.message));
  await page.route("**/api/admin/home-banners", async route => {
   if (route.request().method() === "POST") {
    const c = route.request().postDataJSON(); commands.push(c);
    const item = data.items.find(i=>i.id===c.id);
    if (c.action === "save") { const target = item ?? { id: crypto.randomUUID(), revision:0, sortOrder:data.items.length, publicationStatus:"draft" }; Object.assign(target, {kind:c.kind,celebrityId:c.celebrityId,localizations:Object.fromEntries(Object.entries(c.localizations).map(([lang,v])=>[lang,{title:v.title,description:v.description,ctaLabel:v.ctaLabel,href:v.href,alt:v.alt,desktopImage:v.desktopAssetId?asset:null,mobileImage:v.mobileAssetId?asset:null}]))}); target.revision++; if(!item)data.items.push(target); }
    if(c.action === "publication"){item.publicationStatus=c.publicationStatus;item.revision++;}
    if(c.action === "reorder"){data.items=c.items.map((v,index)=>({...data.items.find(i=>i.id===v.id),sortOrder:index,revision:v.expectedRevision+1}));}
   }
   await route.fulfill({json:data});
  });
  await page.goto(`${harness.baseURL}/admin/home-banners?locale=${locale}`);
  await expect(page.getByRole("heading",{name:locale === "ko"?"홈 배너 관리":"Home banner manager",exact:true})).toBeVisible();
  const titles = page.getByRole("textbox",{name:locale === "ko"?"제목":"Title",exact:true}); await expect(titles).toHaveCount(2);
  await titles.first().fill("엘리나 정기 방송 안내");
  await page.getByRole("button",{name:locale === "ko"?"초안 저장":"Save draft",exact:true}).click();
  await expect(page.getByText(locale === "ko"?"배너를 저장했습니다.":"Banner saved.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:locale === "ko"?"공개":"Publish",exact:true}).click();
  await expect(page.getByRole("button",{name:locale === "ko"?"비공개로 전환":"Unpublish",exact:true})).toBeVisible();
  assert.equal(data.items[0].publicationStatus,"published");
  await page.getByRole("button",{name:locale === "ko"?"비공개로 전환":"Unpublish",exact:true}).click();
  await expect(page.getByRole("button",{name:locale === "ko"?"공개":"Publish",exact:true})).toBeVisible();
  assert.equal(data.items[0].publicationStatus,"draft");
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,`admin-${locale}-${width}.png`),fullPage:true});
  assert.deepEqual(errors,[]);checks.push(`${locale}/${width}: bilingual fields, save, publish, unpublish, no overflow/page errors; ${commands.length} synthetic commands`);
  await page.close();
 }
 await writeFile(path.join(out,"admin-evidence.json"),JSON.stringify({boundary:"Real HomeBannerManager/CSS with loopback-only mocked admin session/API. SQL/auth verified separately.",checks},null,2));console.log(checks.join("\n"));
}finally{await browser.close();await harness.close();}
