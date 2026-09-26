import { z } from "zod";
import { notFound } from "next/navigation";
import { FanAppFrame, FanContentContainer } from "@/components/fan-shell/fan-app-shell";
import { FanPostDetail } from "@/features/fan-posts/ui/fan-post-detail";
import { parseAppLocale } from "@/i18n/locales";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string; postId: string }>; searchParams: Promise<{ locale?: string }> }) {
  const [{ postId }, query] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(postId).success) notFound();
  const locale = parseAppLocale(query.locale);
  return <FanAppFrame locale={locale} mainId="fan-post-main"><FanContentContainer as="main" id="fan-post-main" tabIndex={-1} style={{ paddingBlock: 32 }}><FanPostDetail postId={postId} locale={locale} /></FanContentContainer></FanAppFrame>;
}
