import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams({ locale: query.locale === "en" ? "en" : "ko" });
  if (query.step === "confirm") params.set("step", "confirm");
  if (query.resume === "start") params.set("resume", "start");
  if (typeof query.error === "string" && ["ACCOUNT_MISMATCH", "CANCELLED", "CONNECTION_FAILED"].includes(query.error)) params.set("error", query.error);
  redirect(`/connect/instagram?${params}`);
}
