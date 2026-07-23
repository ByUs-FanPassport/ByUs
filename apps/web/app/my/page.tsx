import { MyScreen } from "@/features/my/ui/my-screen";

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  return <MyScreen locale={locale} />;
}
