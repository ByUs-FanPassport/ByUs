export function isLocalProductionData(
  appUrl: string | undefined,
  dataEnvironment: string | undefined,
): boolean {
  if (dataEnvironment !== "production" || !appUrl) return false;
  try {
    return new URL(appUrl).hostname === "localhost";
  } catch {
    return false;
  }
}

export function ProductionDataIndicator({
  visible,
}: {
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div
      className="productionDataIndicator"
      data-production-data="true"
      role="status"
      aria-label="Localhost is connected to Production data"
    >
      PROD DATA
    </div>
  );
}
