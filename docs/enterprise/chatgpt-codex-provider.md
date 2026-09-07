# ChatGPT (Codex OAuth) model discovery

The `chatgpt` provider's **同步上游模型 / Sync upstream models** action requests the live Codex catalog with a real Codex CLI `client_version`. OpenAI gates both model visibility and protocol flags by that version, so the runtime tracks releases instead of sending an artificially large number.

Version resolution order:

1. `CHATGPT_CODEX_CLIENT_VERSION`, a valid semver operator override (for example `0.153.4`). Invalid values are ignored.
2. The process cache (six hours, with concurrent lookups shared).
3. npm's latest `@openai/codex` release.
4. GitHub's latest `openai/codex` release (`rust-vX.Y.Z`).
5. The bundled floor, currently `0.153.4`.

Every result, including an override, is clamped to at least the bundled floor. Each remote version lookup has a five-second deadline; failed discovery falls back without blocking model sync indefinitely. `DEBUG=lobe-model-runtime:chatgpt:*` shows the selected version and source without credentials.

Each runtime caches the live catalog's Responses Lite flags and reasoning levels for one hour. Chat refreshes an expired catalog, sharing concurrent requests; failures use the last available flags or the static protocol fallback and back off for one hour. An explicit sync can retry immediately. Synced cards retain `settings.chatgptResponsesLite`. Hidden and `supported_in_api: false` entries are excluded; unknown model IDs are retained. Supported effort levels, including `ultra`, keep their control even when upstream introduces additional unknown levels.

**New models arrive DISABLED in the admin catalog.** An administrator must enable them before users can select them. Sync preserves existing models' enabled state and does not remove previously imported rows merely because upstream stops listing them.
