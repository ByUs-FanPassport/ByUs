import { AuthorizedScheduleManager } from "@/components/admin/schedule-manager";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) { return <AuthorizedScheduleManager locale={(await searchParams).lang === "en" ? "en" : "ko"} />; }
