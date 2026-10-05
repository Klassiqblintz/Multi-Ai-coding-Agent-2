/**
 * User-defined providers.
 *
 * Covers both a plain "paste an endpoint and a key" provider (#5) and a local
 * inference server (#6): they differ only in the base URL, so both are stored
 * as an OpenAI-compatible provider entry here.
 *
 * Definitions live in `andropi/providers.json` next to the other app state.
 * Keys are stored there in plaintext, matching how the bundled runtime already
 * keeps credentials in `auth.json`; the file is excluded from backups and
 * never leaves the device except through the user's own export.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CustomProvider = {
	/** Provider id, also the key pi registers it under. */
	id: string;
	name: string;
	/** OpenAI-compatible endpoint, e.g. https://api.example.com/v1 */
	baseUrl: string;
	/** Optional key. Local servers usually accept any placeholder value. */
	apiKey?: string;
	/** API flavour; defaults to OpenAI-compatible chat completions. */
	api?: string;
};

export type CustomProviderFile = { providers: CustomProvider[] };

/**
 * Providers that must not be shadowed by a custom definition. Overriding a
 * built-in would disable its OAuth flow and its curated catalog for no gain,
 * and the id would then collide with pi's own registration.
 */
const RESERVED = new Set([
	"anthropic",
	"openai",
	"google",
	"openrouter",
	"groq",
	"mistral",
	"xai",
	"deepseek",
	"cerebras",
	"together",
	"fireworks",
	"huggingface",
	"nvidia",
	"amazon-bedrock",
	"github-copilot",
]);

function storagePath(stateDir: string) {
	return join(stateDir, "providers.json");
}

export function loadCustomProviders(stateDir: string): CustomProvider[] {
	try {
		const path = storagePath(stateDir);
		if (!existsSync(path)) return [];
		const parsed = JSON.parse(readFileSync(path, "utf8")) as CustomProviderFile;
		return Array.isArray(parsed?.providers) ? parsed.providers.filter(valid) : [];
	} catch {
		// A malformed file must not stop the app from starting; the user can
		// re-add the provider from settings.
		return [];
	}
}

function valid(entry: unknown): entry is CustomProvider {
	const e = entry as CustomProvider;
	return !!e && typeof e.id === "string" && !!e.id && typeof e.baseUrl === "string" && /^https?:\/\//i.test(e.baseUrl);
}

export function saveCustomProviders(stateDir: string, providers: CustomProvider[]) {
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(storagePath(stateDir), `${JSON.stringify({ providers }, null, 2)}\n`);
}

/** Normalizes a URL for use as a provider base: no trailing slash, no `/models`. */
export function normalizeBaseUrl(raw: string): string {
	return raw.trim().replace(/\/+$/, "");
}

/**
 * Turns free-text input into a provider id. Keeps letters, digits and dashes
 * so ids stay usable as a credential-store key and as pi's provider id.
 */
export function slugify(raw: string): string {
	return (
		raw
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "custom"
	);
}

/**
 * True when `id` may be used for a new custom provider. Built-in ids are
 * protected so a custom entry can never break a working provider.
 */
export function isUsableId(id: string, existing: readonly CustomProvider[]): boolean {
	return !!id && !RESERVED.has(id) && !existing.some((p) => p.id === id);
}

/**
 * Whether the endpoint looks local. Used only to label the provider in the UI;
 * both local and remote endpoints are treated identically at runtime.
 */
export function isLocalEndpoint(baseUrl: string): boolean {
	return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(baseUrl);
}