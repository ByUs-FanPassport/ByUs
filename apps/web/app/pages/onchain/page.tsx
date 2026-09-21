import { parseAppLocale } from "@/i18n/locales";
import { messages as localizedMessages } from "@/i18n/catalogs/app__pages__onchain__page";
import { translate } from "@/i18n/messages";
import type { Metadata } from "next";

import { OnchainPublicPage } from "@/components/onchain/onchain-public-page";
import { publicMetadata } from "@/seo/metadata";
import { getPublicOnchainResult } from "@/server/onchain/public-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Props = { searchParams: Promise<{ locale?: string | string[] }> };

function resolveLocale(locale?: string | string[]) {
  return parseAppLocale(locale);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const locale = resolveLocale((await searchParams).locale);
  return publicMetadata({
    path: "/pages/onchain",
    locale,
    title: locale === "ko" ? "ByUs 온체인 기록 | ByUs" : translate(locale, localizedMessages.me9ce14ecd1e0, "ByUs onchain records | ByUs"),
    description: locale === "ko" ? "GIWA Sepolia에 기록된 ByUs 팬 행동 지표와 검증 근거를 확인하세요." : translate(locale, localizedMessages.m3a31c7871cfc, "Review ByUs fan action metrics and verification evidence recorded on GIWA Sepolia."),
  });
}

export default async function Page({ searchParams }: Props) {
  const locale = resolveLocale((await searchParams).locale);
  return <OnchainPublicPage locale={locale} result={await getPublicOnchainResult()} />;
}
