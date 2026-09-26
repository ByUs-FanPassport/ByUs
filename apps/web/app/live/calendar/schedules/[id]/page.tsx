import { ScheduleDetail } from "@/features/schedules/ui/schedule-detail";
import { parseAppLocale } from "@/i18n/locales";
import { notFound } from "next/navigation";
import { uuid } from "@/features/schedules/domain/participation";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ locale?: string }> }) { const { id } = await params; if (!uuid.safeParse(id).success) notFound(); return <ScheduleDetail id={id} locale={parseAppLocale((await searchParams).locale)} />; }
