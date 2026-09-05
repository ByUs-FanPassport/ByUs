import {expect,test} from '@playwright/test';

// Opt-in read-only public UI proof; fixture routes may only exist in a local QA checkout.
const slugs = process.env.CREATOR_ROSTER_SLUGS?.split(',').filter(Boolean) ?? [];
const fixture = process.env.CREATOR_ROSTER_FIXTURE;
for (const width of [390, 1440]) {
  for (const view of ['home','directory'] as const) {
    test(`creator roster ${view} at ${width}px`, async ({page}, info) => {
      test.skip(slugs.length === 0, 'Set CREATOR_ROSTER_SLUGS to the expected published or local fixture roster');
      await page.setViewportSize({width,height:1100});
      const path = fixture ? `${fixture}?view=${view}&locale=ko` : view === 'home' ? '/?locale=ko' : '/celebrities?locale=ko';
      await page.goto(path);
      const content = view === 'home' ? page.locator('#celebrities') : page.locator('#celebrity-directory-content');
      await expect(content.getByRole('heading',{name:'함께 만날 크리에이터'})).toBeVisible();
      for (const slug of slugs) await expect(content.locator(`a[href="/c/${slug}?locale=ko"]`).first()).toBeVisible();
      await page.evaluate(()=>document.fonts.ready);
      for (const img of await content.locator('img').all()) await img.scrollIntoViewIfNeeded();
      await content.locator('img').first().scrollIntoViewIfNeeded();
      await expect.poll(()=>content.locator('img').evaluateAll(images=>images.every(img=>(img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth>0))).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if(view==='home') await expect(content.locator('article')).toHaveCount(3);
      else {
        await expect(content.locator('article')).toHaveCount(slugs.length);
        await expect(content.locator('article[data-supporting="true"]')).toHaveCount(slugs.length-3);
      }
      await content.screenshot({path:info.outputPath('roster.png')});
      if(view==='directory') {
        await page.getByRole('searchbox',{name:'이름으로 찾기'}).fill('이퓨');
        await expect(content.locator('article')).toHaveCount(1);
        await expect(content.locator('[data-supporting="true"]')).toHaveCount(0);
        await expect(content.getByRole('heading',{name:'함께 만날 크리에이터'})).toHaveCount(0);
      }
    });
  }
}
