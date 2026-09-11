import { AdminOverview } from "../../../components/admin/operations-dashboard";

export default async function SystemPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const { lang } = await searchParams;
  return <AdminOverview locale={lang === "en" ? "en" : "ko"} />;
}
