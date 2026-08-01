import type { Metadata } from "next";

import { legalDocuments, resolveLegalLocale } from "@/components/legal-content";
import { LegalPage } from "@/components/legal-page";

// Operations draft: obtain legal review of both language versions before the production terms are finalized.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string | string[] }>;
}): Promise<Metadata> {
  const locale = resolveLegalLocale((await searchParams).locale);
  const document = legalDocuments.terms[locale];
  return { title: document.metadataTitle, description: document.metadataDescription };
}

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string | string[] }>;
}) {
  const locale = resolveLegalLocale((await searchParams).locale);
  return <LegalPage document={legalDocuments.terms[locale]} documentId="terms" locale={locale} />;
}
