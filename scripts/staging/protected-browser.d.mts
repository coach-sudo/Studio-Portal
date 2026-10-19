import type { BrowserContext } from "@playwright/test";
type State = Awaited<ReturnType<BrowserContext["storageState"]>>;
export function deploymentOrigin(value: string): string;
export function privatePath(value: string): string;
export function perimeterState(
  state: State,
  origin: string,
  now?: number,
): State;
