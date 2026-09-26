import { AuthorizedScheduleSuggestionManager } from "@/components/admin/schedule-suggestion-manager";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) { return <AuthorizedScheduleSuggestionManager locale={(await searchParams).lang === "en" ? "en" : "ko"} />; }
