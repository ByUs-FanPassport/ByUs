import { AuthorizedFanpageRequestManager } from "@/components/admin/fanpage-request-manager";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) { return <AuthorizedFanpageRequestManager locale={(await searchParams).lang === "en" ? "en" : "ko"} />; }
