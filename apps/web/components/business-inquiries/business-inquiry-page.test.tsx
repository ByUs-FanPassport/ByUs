import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreatorPage, { generateMetadata as creatorMetadata } from "@/app/pages/creator-onboarding/page";
import PartnerPage, { generateMetadata as partnerMetadata } from "@/app/pages/partners/page";
import { buildSitemap } from "@/seo/sitemap";
import { BusinessInquiryPage } from "./business-inquiry-page";
import { businessPageContent, businessPagePaths } from "./content";

afterEach(() => vi.unstubAllGlobals());

describe("business inquiry pages", () => {
  it.each([
    ["creator", "ko"], ["creator", "en"],
    ["partner", "ko"], ["partner", "en"],
  ] as const)("submits %s inquiries in %s through the correct endpoint", async (kind, locale) => {
    const request = vi.fn().mockResolvedValue(Response.json({ status: "accepted" }, { status: 202 }));
    vi.stubGlobal("fetch", request);
    const { container } = render(<BusinessInquiryPage kind={kind} locale={locale} />);
    const t = businessPageContent[kind][locale];
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: locale === "ko" ? "Switch to English" : "한국어로 보기" })).toHaveAttribute("href", `${businessPagePaths[kind]}?locale=${locale === "ko" ? "en" : "ko"}`);
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: t.cta })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { level: 2 })).not.toHaveTextContent(/미국 팬미팅|U.S. fan meeting/);
    const name = within(dialog).getByRole("textbox", { name: locale === "ko" ? /이름|담당자명/ : /Name \/ contact person|Contact name/ });
    const company = within(dialog).getByRole("textbox", { name: kind === "creator" ? (locale === "ko" ? "활동명 / 팀·브랜드명" : "Public name / team / brand") : (locale === "ko" ? "회사 / 브랜드명" : "Company / brand") });
    expect(company).toBeRequired();
    fireEvent.change(name, { target: { value: "Contact" } });
    fireEvent.change(company, { target: { value: kind === "creator" ? "Independent creator" : "Brand team" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: locale === "ko" ? "회신 이메일" : "Reply email" }), { target: { value: "contact@example.com" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: locale === "ko" ? "문의 내용" : "Project details" }), { target: { value: "A fan activity proposal" } });
    if (kind === "partner") fireEvent.change(within(dialog).getByRole("combobox", { name: locale === "ko" ? "협업 분야" : "Collaboration type" }), { target: { value: "live" } });
    else expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: locale === "ko" ? "문의 접수하기" : "Send inquiry" }));
    expect(await screen.findByRole("heading", { name: locale === "ko" ? "문의가 접수됐어요" : "Your inquiry has been received" })).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`/api/inquiries/${kind}`);
    const message = kind === "partner" ? `${locale === "ko" ? "협업 분야: 라이브커머스" : "Collaboration type: Live shopping"}\n\nA fan activity proposal` : "A fan activity proposal";
    expect(JSON.parse(init.body)).toEqual({ idempotencyKey: expect.any(String), locale, name: "Contact", company: kind === "creator" ? "Independent creator" : "Brand team", email: "contact@example.com", message, consent: true });
  });

  it.each(["ko", "en"] as const)("keeps partner categories within the message limit and gives changed proposals a new retry key in %s", async (locale) => {
    const request = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ error: { code: "INQUIRY_UNAVAILABLE" } }, { status: 503 })));
    vi.stubGlobal("fetch", request);
    render(<BusinessInquiryPage kind="partner" locale={locale} />);
    fireEvent.click(screen.getAllByRole("button", { name: businessPageContent.partner[locale].cta })[0]);
    const dialog = await screen.findByRole("dialog");
    const form = within(dialog);
    fireEvent.change(form.getByRole("textbox", { name: locale === "ko" ? "담당자명" : "Contact name" }), { target: { value: "Contact" } });
    fireEvent.change(form.getByRole("textbox", { name: locale === "ko" ? "회사 / 브랜드명" : "Company / brand" }), { target: { value: "Brand" } });
    fireEvent.change(form.getByRole("textbox", { name: locale === "ko" ? "회신 이메일" : "Reply email" }), { target: { value: "contact@example.com" } });
    const message = form.getByRole("textbox", { name: locale === "ko" ? "문의 내용" : "Project details" });
    expect(message).toHaveAttribute("maxLength", "3900");
    fireEvent.change(message, { target: { value: "A".repeat(3900) } });
    fireEvent.click(form.getByRole("checkbox"));
    const category = form.getByRole("combobox");
    const send = form.getByRole("button", { name: locale === "ko" ? "문의 접수하기" : "Send inquiry" });
    expect(category).toHaveValue("other");
    for (const value of ["other", "other", "commerce", "live", "merchandise", "advertising", "benefits"]) {
      fireEvent.change(category, { target: { value } });
      fireEvent.click(send);
      await screen.findByRole("alert");
    }
    const payloads = request.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(payloads).toHaveLength(7);
    expect(payloads[0].idempotencyKey).toBe(payloads[1].idempotencyKey);
    expect(new Set(payloads.slice(1).map((payload) => payload.idempotencyKey)).size).toBe(6);
    expect(new Set(payloads.slice(1).map((payload) => payload.message)).size).toBe(6);
    for (const payload of payloads) {
      expect(payload.message.length).toBeLessThanOrEqual(4000);
      expect(payload.message).toMatch(/\n\nA{3900}$/);
    }
  });

  it.each([
    ["creator", CreatorPage, creatorMetadata],
    ["partner", PartnerPage, partnerMetadata],
  ] as const)("keeps %s page, metadata, and sitemap locales aligned", async (kind, Page, metadata) => {
    const searchParams = Promise.resolve({ locale: "en" });
    render(await Page({ searchParams }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(businessPageContent[kind].en.hero.replace(/\n/g, " "));
    const result = await metadata({ searchParams });
    expect(result.title).toContain(businessPageContent[kind].en.title);
    expect(result.alternates?.canonical).toBe(`https://byus.kr${businessPagePaths[kind]}?locale=en`);
    for (const locale of ["fr", ["en", "ko"], undefined]) {
      expect((await metadata({ searchParams: Promise.resolve({ locale }) })).alternates?.canonical).toBe(`https://byus.kr${businessPagePaths[kind]}?locale=ko`);
    }
    const urls = buildSitemap([]).map((item) => item.url);
    expect(urls).toContain(`https://byus.kr${businessPagePaths[kind]}?locale=ko`);
    expect(urls).toContain(`https://byus.kr${businessPagePaths[kind]}?locale=en`);
  });
});
