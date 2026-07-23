import { PassportIssuanceScreen } from "@/features/passport/ui/passport-issuance-dialog";

export default async function PassportIssuancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PassportIssuanceScreen passportId={id} />;
}
