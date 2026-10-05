/**
 * Live model discovery.
 *
 * The bundled pi catalog ships a generated, fixed list of models per provider
 * (pi-ai `providers/*.models.js`). That list is wrong the moment the provider
 * adds or retires a model, and it ignores what a specific API key may actually
 * reach. This module replaces that catalog with what the provider reports for
 * the credential the user entered.
 *
 * It also backs two related features on top of the same code path:
 *
 *   - custom providers (#5): a user-defined OpenAI-compatible endpoint + key.
 *   - local models (#6): Ollama / LM Studio / llama.cpp / vLLM over OpenAI's
 *     `/v1/models`, on-device (localhost) or on the LAN.
 *
 * Every provider registers a `refreshModels` callback through pi's extension
 * API. pi replaces its model list with whatever we return, so the UI shows the
 * key's real models and nothing else. When a fetch fails we return the bundled
 * list unchanged rather than an empty list, so a flaky network never makes a
 * working provider look broken.
 */

import type { Credential, Model } from "@earendil-works/pi-ai";

/** Shape pi expects from `ProviderConfigInput["models"]`. */
type ModelDefinition = {
	id: string;
	name: string;
	api?: string;
	baseUrl?: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
};

/** Pulls the bearer/PAT value out of whichever credential pi resolved. */
function credentialKey(credential: Credential | undefined): string | undefined {
	if (!credential) return undefined;
	if (credential.type === "api_key") return credential.key || undefined;
	// OAuth: the access token authorizes the same `/models` endpoints.
	return (credential as { access?: string }).access || undefined;
}

// ---------------------------------------------------------------------------
// Per-provider endpoints
//
// Only providers that actually publish a model list are included. Anthropic
// and Google have no such endpoint, so they keep their curated catalog rather
// than showing a guessed number.

type Descriptor = {
	/** Path appended to the provider's base URL. */
	path?: string;
	/** Absolute URL, when the list endpoint is not under the API base. */
	url?: string;
	/** Header carrying the key. Most providers use bearer. */
	header?: string;
	/** Prefix for the header value, e.g. GitHub-style "Bearer ". */
	prefix?: string;
	/** Some providers list the key as a query parameter instead. */
	query?: string;
	/** Extra headers this endpoint requires. */
	headers?: Record<string, string>;
	/** Response may be `{ data: [...] }` or a bare array. Either is fine. */
};

/**
 * Providers known to expose `GET /models`. Anything missing here keeps pi's
 * bundled catalog: listing a wrong count is worse than listing the curated one.
 */
const LIST_ENDPOINTS: Record<string, Descriptor> = {
	openrouter: { path: "/models" },
	openai: { path: "/models" },
	groq: { path: "/models" },
	cerebras: { path: "/models" },
	deepseek: { path: "/models" },
	xai: { path: "/models" },
	mistral: { path: "/models" },
	together: { path: "/models" },
	fireworks: { path: "/models" },
	huggingface: { path: "/models" },
	nvidia: { path: "/models" },
	baseten: { path: "/models" },
	opencode: { path: "/models" },
	vercel: { path: "/v1/models" },
	moonshotai: { path: "/models" },
	minimax: { path: "/models" },
	zai: { path: "/models/available" },
	kimi: { path: "/models" },
	"ant-ling": { path: "/models" },
	cloudflare: { path: "/models" },
};

const DEFAULT_CONTEXT = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

function toNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * OpenRouter-style payloads carry rich per-model metadata. Everything else is
 * usually just `{ id }`, so we fall back to the bundled entry for that id to
 * keep context window, reasoning support and pricing where the provider gave
 * them to us.
 */
function fromRich(entry: any, api: string, fallback?: Model<any>): ModelDefinition | undefined {
	const id = String(entry?.id ?? "").trim();
	if (!id) return undefined;

	const pricing = entry?.pricing ?? {};
	// OpenRouter quotes prices as strings, per token.
	const price = (v: unknown) => {
		const n = typeof v === "string" ? Number(v) : v;
		return typeof n === "number" && Number.isFinite(n) ? n : 0;
	};
	const architecture = entry?.architecture ?? {};
	const modality = String(architecture?.modality ?? entry?.input_modalities?.[0] ?? "text").toLowerCase();
	const input: ("text" | "image")[] = modality.includes("image") || entry?.input_modalities?.includes?.("image") ? ["text", "image"] : ["text"];

	// `supported_parameters` is how OpenRouter advertises reasoning tools.
	const params = Array.isArray(entry?.supported_parameters) ? entry.supported_parameters : [];
	const reasoning = params.includes("reasoning") || params.includes("include_reasoning") || !!fallback?.reasoning;
	const contextWindow = toNumber(entry?.context_length ?? entry?.context_window, fallback?.contextWindow ?? DEFAULT_CONTEXT);
	const maxTokens = toNumber(entry?.top_provider?.max_completion_tokens, fallback?.maxTokens ?? DEFAULT_MAX_TOKENS);

	const cost =
		pricing.input !== undefined || pricing.prompt !== undefined
			? {
					input: price(pricing.prompt ?? pricing.input),
					output: price(pricing.completion ?? pricing.output),
					cacheRead: price(pricing.input_cache_read ?? pricing.cache_read),
					cacheWrite: price(pricing.input_cache_write ?? pricing.cache_write),
				}
			: (fallback?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

	return {
		id,
		name: String(entry?.name ?? fallback?.name ?? id),
		api: entry?.api ?? api,
		reasoning,
		input: input.length ? input : (fallback?.input ?? ["text"]),
		cost,
		contextWindow,
		maxTokens,
	};
}

/**
 * Normalizes a `{ id }`-only entry using the bundled catalog for detail.
 * `api` defaults to the provider's own API flavour so the model streams.
 */
function fromId(entry: any, providerId: string, api: string, fallback?: Model<any>): ModelDefinition | undefined {
	const raw = entry?.id ?? entry?.name;
	const id = String(raw ?? "").trim();
	if (!id) return undefined;
	return {
		id,
		name: String(entry?.name ?? fallback?.name ?? id),
		api,
		reasoning: fallback?.reasoning ?? false,
		input: fallback?.input ?? ["text"],
		cost: fallback?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: fallback?.contextWindow ?? DEFAULT_CONTEXT,
		maxTokens: fallback?.maxTokens ?? DEFAULT_MAX_TOKENS,
	};
}

/**
 * Fetches a provider's live model list and maps it onto pi's model shape.
 *
 * Returns the bundled list untouched on any failure, so registration stays
 * usable offline and a transient error never empties the picker.
 */
export async function fetchLiveModels(options: {
	providerId: string;
	baseUrl: string;
	api: string;
	descriptor?: Descriptor;
	credential?: Credential;
	signal?: AbortSignal;
	/** Bundled entries, used to fill in detail for sparse API responses. */
	fallbacks?: readonly Model<any>[];
}): Promise<ModelDefinition[]> {
	const { providerId, baseUrl, api, credential, signal, fallbacks = [] } = options;
	const descriptor = options.descriptor ?? {};
	// Bundled entries, matched loosely: a fallback that omits `provider` is
	// still usable, since dropping it would empty the picker on any failure.
	const fallback = fallbacks.filter((m) => m && (m.provider === undefined || m.provider === providerId));
	const fallbackById = new Map(fallback.map((m) => [m.id, m]));

	// Bail out before touching the network: an unconfigured provider has no
	// business listing models, and an aborted refresh must not start late.
	const key = credentialKey(credential);
	if (!descriptor.url && !descriptor.path) return [];
	if (signal?.aborted) return fallback.map((m) => m as ModelDefinition);

	const url = descriptor.url ?? `${baseUrl.replace(/\/+$/, "")}${descriptor.path}`;
	const headers: Record<string, string> = { accept: "application/json", ...(descriptor.headers ?? {}) };
	if (key) headers[descriptor.header ?? "authorization"] = `${descriptor.prefix ?? "Bearer "}${key}`;

	const target = descriptor.query && key ? `${url}?${descriptor.query}=${encodeURIComponent(key)}` : url;

	try {
		const response = await fetch(target, { headers, signal });
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
		const body: any = await response.json();
		const raw: any[] = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];

		const mapped = raw
			.map((entry) => {
				const known = fallbackById.get(String(entry?.id ?? ""));
				const rich = entry?.pricing || entry?.context_length || entry?.supported_parameters || entry?.architecture;
				return rich ? fromRich(entry, api, known) : fromId(entry, providerId, api, known);
			})
			.filter((m): m is ModelDefinition => !!m);

		// Deduplicate by id; some endpoints repeat entries per modality.
		const seen = new Set<string>();
		const unique = mapped.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
		// An empty successful response means we misread the payload shape.
		// Keep the bundled catalog rather than reporting zero models.
		return unique.length ? unique : fallback.map((m) => m as ModelDefinition);
	} catch (error) {
		if (signal?.aborted) return fallback.map((m) => m as ModelDefinition);
		// Offline, 401, rate-limited, or an endpoint that does not exist:
		// the bundled list is still a usable answer.
		return fallback.map((m) => m as ModelDefinition);
	}
}

/** Providers whose live list pi should refresh, and how to reach it. */
export function descriptorFor(providerId: string): Descriptor | undefined {
	if (LIST_ENDPOINTS[providerId]) return LIST_ENDPOINTS[providerId];
	// Custom providers (including local endpoints) are all OpenAI-compatible
	// and list their models the same way.
	return { path: "/models" };
}

/**
 * A model is shown with a "free" tag when it costs nothing to run. A provider
 * that quotes no pricing at all is treated as free rather than unknown, since
 * that is what the user experiences with a local or open-weights server.
 */
export function isFree(model: ModelDefinition): boolean {
	return model.cost.input === 0 && model.cost.output === 0;
}