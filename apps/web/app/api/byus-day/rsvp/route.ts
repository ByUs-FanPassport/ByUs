import { rsvpFailure } from "@/server/byus-day/rsvp-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return rsvpFailure("RSVP_CLOSED");
}
