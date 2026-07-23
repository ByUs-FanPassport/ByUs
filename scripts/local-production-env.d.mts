export const PRODUCTION_SUPABASE_PROJECT_REF: string;
export const LOCAL_APP_URL: string;
export const DEMO_PRIVY_ENVIRONMENT: "development";

export type EnvironmentValues = Record<string, string>;

export function parseEnvironmentFile(source: string): EnvironmentValues;
export function readEnvironmentFile(path: string): Promise<EnvironmentValues>;
export function productionLocalEnvironment(
  source: Record<string, string | undefined>,
): EnvironmentValues;
export function serializeEnvironment(source: EnvironmentValues): string;
export function assertProductionLocalEnvironment(
  source: Record<string, string | undefined>,
): EnvironmentValues;
