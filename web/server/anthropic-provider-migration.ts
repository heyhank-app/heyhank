// Anthropic API Key Provider Migration
// One-time migration: moves the legacy anthropicApiKey from settings.json
// into the provider system (providers.json) under the "anthropic" provider.
// This runs on server startup to handle the transition from legacy settings
// to the unified provider management system.

import { getSettings, updateSettings } from "./settings-manager.js";
import { getProviderConfig, upsertProviderConfig } from "./provider-manager.js";

/** Migrate legacy Anthropic API key from settings to the provider system.
 *  This is a one-time operation: once the key is moved, the legacy field is cleared. */
export function migrateAnthropicApiKeyToProvider(): void {
  const settings = getSettings();

  // Nothing to migrate if no legacy key
  const legacyKey = settings.anthropicApiKey?.trim();
  if (!legacyKey) return;

  // Check if anthropic provider already has a key configured
  const existing = getProviderConfig("anthropic");
  if (existing && existing.envValues.ANTHROPIC_API_KEY?.trim()) {
    // Provider already configured — just clear the legacy field
    console.log(
      "[anthropic-migration] Provider already configured, clearing legacy settings field.",
    );
    updateSettings({ anthropicApiKey: "" });
    return;
  }

  // Migrate key into provider system
  const model = settings.anthropicModel?.trim() || "";
  upsertProviderConfig("anthropic", {
    enabled: true,
    envValues: { ANTHROPIC_API_KEY: legacyKey },
    ...(model ? { customModel: model } : {}),
  });

  // Also set as internalAiProvider if not already set
  if (!settings.internalAiProvider?.trim()) {
    updateSettings({ anthropicApiKey: "", internalAiProvider: "anthropic" });
  } else {
    updateSettings({ anthropicApiKey: "" });
  }

  console.log(
    "[anthropic-migration] Migrated legacy Anthropic API key to provider system.",
  );
}
