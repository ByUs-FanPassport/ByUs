import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useEffect, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DocumentLocale } from "./document-locale";
import { LocaleProvider } from "./locale-provider";
import { ByUsPrivyProvider } from "./privy-provider";
import { PublicContentState } from "./public-content-state";

const state = vi.hoisted(() => ({ query: 'locale=en', pathname: '/', mounts: 0, header: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname, useSearchParams: () => new URLSearchParams(state.query) }));
vi.mock('./avatar-session-bridge', () => ({ AvatarSessionBridge: ({children}: {children: ReactNode}) => children }));
vi.mock('@privy-io/react-auth', () => ({ PrivyProvider: function TestProvider({children, config}: {children: ReactNode; config: {appearance: {landingHeader: string}}}) {
  useEffect(() => { state.mounts += 1; }, []);
  state.header = config.appearance.landingHeader;
  return children;
} }));

describe('document and authentication locale', () => {
  it('renders English loading content in the server output', () => {
    const html = renderToString(<LocaleProvider initialLocale="en"><PublicContentState state="loading" scope="home" /></LocaleProvider>);
    expect(html).toContain("Loading today");
    expect(html).not.toContain('불러오고');
  });
  it('updates document, loading, and custom SDK copy without remounting authentication', () => {
    state.query = 'locale=en'; state.pathname = '/'; state.mounts = 0;
    const Tree = () => <LocaleProvider initialLocale="en"><ByUsPrivyProvider appId="test"><DocumentLocale /><PublicContentState state="loading" scope="home" /></ByUsPrivyProvider></LocaleProvider>;
    const view = render(<Tree />);
    expect(state.header).toBe('Get started with ByUs');
    expect(document.documentElement.lang).toBe('en');
    state.query = 'locale=ko';
    view.rerender(<Tree />);
    expect(state.header).toBe('ByUs 시작하기');
    expect(document.documentElement.lang).toBe('ko');
    expect(screen.getByRole('heading').textContent).toContain('불러오고');
    state.query = 'locale=en';
    view.rerender(<Tree />);
    expect(state.header).toBe('Get started with ByUs');
    expect(state.mounts).toBe(1);
  });
  it('uses the callback cookie on client navigation and lets an explicit query win', () => {
    document.cookie = "byus_locale=en; Path=/";
    state.pathname = '/settings/kakao/callback'; state.query = '';
    const Tree = () => <LocaleProvider initialLocale="ko"><DocumentLocale /><PublicContentState state="loading" scope="home" /></LocaleProvider>;
    const view = render(<Tree />);
    expect(document.documentElement.lang).toBe('en');
    state.query = 'locale=ko'; view.rerender(<Tree />);
    expect(document.documentElement.lang).toBe('ko');
    document.cookie = "byus_locale=; Max-Age=0; Path=/";
  });

});
