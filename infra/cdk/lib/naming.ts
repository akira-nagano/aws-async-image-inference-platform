import type { EnvironmentName } from "./config";

export const SYSTEM_ID = "ImgFlow";
export const SYSTEM_SLUG = "imgflow";

export function stackName(environment: EnvironmentName): string {
  return `${SYSTEM_ID}-${environment}`;
}

export function resourceDisplayName(environment: EnvironmentName, component: string): string {
  return `${SYSTEM_SLUG}-${environment}-${component}`;
}
