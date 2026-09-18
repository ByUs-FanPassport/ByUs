import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentLocale } from './document-locale';
import { LocaleProvider, useAppLocale } from './locale-provider';

const route = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => '/live/elina', useSearchParams: () => new URLSearchParams(route.query) }));
function CurrentLocale() { return <output>{useAppLocale().locale}</output>; }
afterEach(() => { vi.restoreAllMocks(); route.query = ''; });
describe('browser locale fallback', () => {
  it.each([['ko-KR', 'ko'], ['en-US', 'en'], ['ja-JP', 'en'], ['', 'en']])('uses %s only when the URL omits a language', (language, expected) => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
    const view = render(<LocaleProvider initialLocale="en"><DocumentLocale /><CurrentLocale /></LocaleProvider>);
    expect(document.documentElement.lang).toBe(expected);
    expect(view.getByRole('status').textContent).toBe(expected);
    route.query = expected === 'en' ? 'locale=ko' : 'locale=en';
    view.rerender(<LocaleProvider initialLocale="en"><DocumentLocale /><CurrentLocale /></LocaleProvider>);
    expect(document.documentElement.lang).toBe(expected === 'en' ? 'ko' : 'en');
  });
});
