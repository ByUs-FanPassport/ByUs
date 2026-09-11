import { MyRafflesScreen } from "@/features/benefit/ui/my-raffles-screen";

export default async function MyRafflesPage({ searchParams }: { searchParams: Promise<{ locale?: string }> }) {
  const locale = (await searchParams).locale === "en" ? "en" : "ko";
  return <MyRafflesScreen locale={locale} />;
}
