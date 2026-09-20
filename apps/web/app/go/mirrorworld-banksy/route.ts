import { GET as sharedLink } from "../../t/[id]/route";
import { MIRRORWORLD_BANKSY_LINK_ID } from "@/features/analytics/domain/banksy-campaign";
export const dynamic = "force-dynamic";

// Preserve the published address while using administrator-controlled attribution.
export function GET(request: Request) {
  return sharedLink(request, { params: Promise.resolve({ id: MIRRORWORLD_BANKSY_LINK_ID }) });
}
export const HEAD = GET;
