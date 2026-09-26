function parts(value: number, timeZone: string): number[] {
  const values = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  return ["year", "month", "day", "hour", "minute"].map(type => Number(values.find(part => part.type === type)?.value));
}
export function localScheduleTime(instant: string, timeZone: string): string {
  const [year, month, day, hour, minute] = parts(Date.parse(instant), timeZone);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${year}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}`;
}
/** Reject nonexistent/ambiguous wall times instead of silently shifting an event. */
export function scheduleInstant(local: string, timeZone: string): string {
  const match = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error("INVALID_LOCAL_TIME");
  const wanted = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = wanted;
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wall).toISOString().slice(0, 16) !== local) throw new Error("INVALID_LOCAL_TIME");
  const candidates = new Set<number>();
  for (const shift of [-36, -12, 12, 36]) {
    const probe = wall + shift * 3_600_000;
    const [y, mo, d, h, mi] = parts(probe, timeZone);
    const offset = Date.UTC(y, mo - 1, d, h, mi) - probe;
    const candidate = wall - offset;
    if (parts(candidate, timeZone).every((value, index) => value === wanted[index])) candidates.add(candidate);
  }
  if (candidates.size !== 1) throw new Error("INVALID_LOCAL_TIME");
  return new Date([...candidates][0]).toISOString();
}
