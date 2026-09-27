// Hand-written so the TS frontend imports this ESM package without allowJs; keep in step with sentry.js.

export type Service = 'backend' | 'database' | 'server' | 'auto' | 'electron' | 'frontend';

export interface Tags {
  service: Service;
  platform: string;
}

export interface OptionsOverrides {
  dsn?: string;
  version?: string;
  environment?: string;
}

export interface SentryOptions {
  dsn: string | undefined;
  release: string;
  environment: string;
  sampleRate: number;
  sendDefaultPii: false;
  beforeSend: typeof scrub;
  beforeBreadcrumb: typeof scrubBreadcrumb;
  initialScope: { tags: Tags };
}

export const SERVICES: readonly Service[];

// Generic so each SDK's own Event/Breadcrumb type passes through; null means drop.
export function scrub<T>(event: T, hint?: unknown): T | null;
export function scrubBreadcrumb<T>(crumb: T, hint?: unknown): T | null;
export function tags(service: Service): Tags;
export function enabled(dsn?: string): boolean;
export function options(service: Service, overrides?: OptionsOverrides): SentryOptions;
