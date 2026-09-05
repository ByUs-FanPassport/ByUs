import {expect,test} from '@playwright/test';

// Opt-in read-only public UI proof; fixture routes may only exist in a local QA checkout.
const slugs = process.env.CREATOR_ROSTER_SLUGS?.split(',').filter(Boolean) ?? [];
const fixture = process.env.CREATOR_ROSTER_FIXTURE;
for (const width of [320, 375, 414, 768, 1440]) {
  for (const view of ['home','directory'] as const) {
    test(`creator roster ${view} at ${width}px`, async ({page}, info) => {
      test.skip(slugs.length === 0, 'Set CREATOR_ROSTER_SLUGS to the expected published or local fixture roster');
      await page.setViewportSize({width,height:1100});
      const path = fixture ? `${fixture}?view=${view}&locale=ko` : view === 'home' ? '/?locale=ko' : '/celebrities?locale=ko';
      await page.goto(path);
      const content = view === 'home' ? page.locator('#celebrities') : page.locator('#celebrity-directory-content');
      await expect(content.getByRole('heading',{name:'함께 만날 크리에이터'})).toHaveCount(0);
      for (const slug of slugs) await expect(content.locator(`a[href="/c/${slug}?locale=ko"]`).first()).toBeVisible();
      await page.evaluate(()=>document.fonts.ready);
      for (const img of await content.locator('img').all()) await img.scrollIntoViewIfNeeded();
      await content.locator('img').first().scrollIntoViewIfNeeded();
      await expect.poll(()=>content.locator('img').evaluateAll(images=>images.every(img=>(img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth>0))).toBe(true);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(content.locator('article')).toHaveCount(slugs.length);
      await expect(content.locator('[data-supporting]')).toHaveCount(0);
      const cards = content.locator('article');
      const measures = await cards.evaluateAll(nodes => nodes.map(node => {
        const box = node.getBoundingClientRect();
        const img = node.querySelector('img')!;
        const image = (img.closest('[data-portrait], [data-group-photo]') ?? img).getBoundingClientRect();
        return {width:box.width, imageWidth:image.width, imageHeight:image.height};
      }));
      for(const measure of measures) {
        expect(Math.abs(measure.width-measures[0].width)).toBeLessThan(2);
        expect(Math.abs(measure.imageWidth-measures[0].imageWidth)).toBeLessThan(2);
        expect(Math.abs(measure.imageHeight-measures[0].imageHeight)).toBeLessThan(2);
      }
      for (const [index, slug] of ['changha','elina','yuna'].entries())
        await expect(cards.nth(index).locator(`a[href="/c/${slug}?locale=ko"]`).first()).toHaveCount(1);
      if(view==='home') {
        const rail = content.locator('#home-creator-rail');
        await expect(content.locator('nav span')).toHaveCount(0);
        for (const measure of measures) {
          expect(Math.abs(measure.imageWidth - measure.imageHeight)).toBeLessThan(1);
          expect(measure.imageWidth).toBeLessThanOrEqual(240);
        }
        await rail.evaluate(el => el.scrollTo({left:0,behavior:'instant'}));
        const previous = content.getByRole('button',{name:'이전 최애'});
        const next = content.getByRole('button',{name:'다음 최애'});
        await expect(previous).toBeDisabled();
        await expect(next).toBeEnabled();
        const initialHeight = await content.evaluate(el => el.getBoundingClientRect().height);
        const tops = await cards.evaluateAll(nodes => nodes.map(n=>n.getBoundingClientRect().top));
        expect(Math.max(...tops)-Math.min(...tops)).toBeLessThan(2);
        await next.click();
        await expect(previous).toBeEnabled();
        await rail.evaluate(el => el.scrollTo({left:el.scrollWidth,behavior:'instant'}));
        await expect(next).toBeDisabled();
        await expect(cards.last()).toBeInViewport();
        expect(Math.abs(await content.evaluate(el=>el.getBoundingClientRect().height)-initialHeight)).toBeLessThan(2);
        await content.screenshot({path:info.outputPath('roster-end.png')});
        await previous.click();
        await expect(next).toBeEnabled();
        await rail.evaluate(el => el.scrollTo({left:0,behavior:'instant'}));
        await expect(previous).toBeDisabled();
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
