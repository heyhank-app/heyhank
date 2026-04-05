/**
 * Analytics / Telemetry — disabled for HeyHank (self-hosted).
 *
 * All functions are no-ops. The module is kept so that call sites
 * don't need to be changed (captureEvent, captureException, etc.).
 */

export function isAnalyticsEnabled(): boolean {
  return false;
}

export function getTelemetryPreferenceEnabled(): boolean {
  return false;
}

export function setTelemetryPreferenceEnabled(_enabled: boolean): void {
  // no-op — telemetry disabled for self-hosted
}

export function initAnalytics(): boolean {
  return false;
}

export function captureEvent(_event: string, _properties?: Record<string, unknown>): void {
  // no-op
}

export function captureException(_error: unknown, _properties?: Record<string, unknown>): void {
  // no-op
}

export function capturePageView(_path: string): void {
  // no-op
}
