import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentLocale } from './document-locale';
import { LocaleProvider, useAppLocale } from './locale-provider';

const route = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => '/live/elina', useSearchParams: () => new URLSearchParams(route.query) }));
function CurrentLocale() { return <output>{useAppLocale().locale}</output>; }
afterEach(() => {
  vi.restoreAllMocks(); route.query = '';
  window.history.replaceState(null, '', '/');
  document.cookie = 'byus_page_locale=; Max-Age=0; Path=/';
});
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
  it('cleans legacy links without losing query, anchor or language', () => {
    route.query = 'locale=en&locale=ko&attendanceCode=KEEP&returnTo=%2Flive%2Felina%23code';
    window.history.replaceState({ router: 'keep' }, '', `/elina?${route.query}#fans`);
    render(<LocaleProvider initialLocale="en"><DocumentLocale /><CurrentLocale /></LocaleProvider>);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/elina?attendanceCode=KEEP&returnTo=%2Flive%2Felina%23code#fans');
    expect(window.history.state).toEqual({ byusLocale: 'en' });
    expect(document.cookie).toContain('byus_page_locale=en');
    window.history.replaceState({ router: 'keep', byusLocale: 'ko' }, '', '/elina');
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })));
    expect(document.documentElement.lang).toBe('ko');
    expect(document.cookie).toContain('byus_page_locale=ko');
  });
  it('uses the destination admin language when traversing history from a fan page', () => {
    render(<LocaleProvider initialLocale="en"><DocumentLocale /><CurrentLocale /></LocaleProvider>);
    window.history.replaceState({ byusLocale: 'en' }, '', '/admin?lang=ko&locale=en');
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })));
    expect(document.documentElement.lang).toBe('ko');
    expect(window.location.search).toBe('?lang=ko&locale=en');
  });
});
