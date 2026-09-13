import { notFound, permanentRedirect } from "next/navigation";
import type { Route } from "next";
import { creatorHomeHref, isCreatorHandle } from "@/features/creator/domain/creator-navigation";
import { creatorRafflesHref } from "@/features/benefit/domain/raffle-navigation";
import { sanitizeAuthIntentId } from "@/components/login-intent";

export const dynamic = "force-dynamic";

export default async function LegacyCelebrityPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, values] = await Promise.all([params, searchParams]);
  if (!isCreatorHandle(slug)) notFound();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  // These tabs already lead to a dedicated catalog, not to the home page.
  if (query.get("tab") === "raffles" || query.get("tab") === "benefits") {
    const locale = query.get("locale") === "en" ? "en" : "ko";
    const intent = sanitizeAuthIntentId(query.get("authIntent"));
    permanentRedirect(`${creatorRafflesHref(slug, locale)}${intent ? `&authIntent=${intent}` : ""}` as Route);
  }
  permanentRedirect(`${creatorHomeHref(slug)}${query.size ? `?${query}` : ""}` as Route);
}
