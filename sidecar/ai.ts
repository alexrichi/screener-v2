import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

/**
 * The AI proxy: the renderer speaks one OpenAI-compatible endpoint, the sidecar
 * owns the provider key and stores it outside the repo. Nothing here knows about
 * tools or chat history.
 */
export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Whisper-compatible model for voice input; empty disables the mic. */
  transcribeModel: string;
}

export interface AiStatus {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  transcriptionModel: string | null;
  /** The key is never sent back to the renderer, only its presence. */
  keySet: boolean;
  source: 'env' | 'file' | null;
  /** Where the file config lives; null when env variables provide it. */
  configFile: string | null;
}

const BODY_LIMIT = 32 * 1024 * 1024;

export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const baseUrl = (env.AI_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: (env.AI_API_KEY ?? '').trim(),
    model: (env.AI_MODEL ?? '').trim(),
    transcribeModel: (env.AI_TRANSCRIBE_MODEL ?? '').trim(),
  };
}

/**
 * `%APPDATA%\screener-v2\ai.json` on Windows, `~/.config/screener-v2/ai.json`
 * elsewhere. Keep the directory in sync with Electron's `app.getPath('userData')`;
 * a different name makes the dev sidecar and the packaged app read different files.
 */
export function aiConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AI_CONFIG_FILE) return env.AI_CONFIG_FILE;
  const base = env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'screener-v2', 'ai.json');
}

function readStoredConfig(): AiConfig | null {
  try {
    const raw = JSON.parse(readFileSync(aiConfigFile(), 'utf8')) as Partial<AiConfig>;
    if (typeof raw.baseUrl !== 'string' || !raw.baseUrl.trim()) return null;
    return {
      baseUrl: raw.baseUrl.trim().replace(/\/+$/, ''),
      apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
      model: typeof raw.model === 'string' ? raw.model : '',
      transcribeModel: typeof raw.transcribeModel === 'string' ? raw.transcribeModel : '',
    };
  } catch {
    return null;
  }
}

let stored: AiConfig | null | undefined;
let modelCache: { baseUrl: string; at: number; models: string[] } | null = null;
const MODEL_CACHE_MS = 5 * 60_000;

/** Environment variables win; the settings file is the fallback. */
export function currentAiConfig(): { config: AiConfig; source: 'env' | 'file' } | null {
  const fromEnv = readAiConfig();
  if (fromEnv) return { config: fromEnv, source: 'env' };
  if (stored === undefined) stored = readStoredConfig();
  return stored ? { config: stored, source: 'file' } : null;
}

export function aiStatus(): AiStatus {
  const active = currentAiConfig();
  if (!active) {
    return {
      configured: false,
      baseUrl: null,
      model: null,
      transcriptionModel: null,
      keySet: false,
      source: null,
      configFile: aiConfigFile(),
    };
  }
  return {
    configured: true,
    baseUrl: active.config.baseUrl,
    model: active.config.model || null,
    transcriptionModel: active.config.transcribeModel || null,
    keySet: active.config.apiKey.length > 0,
    source: active.source,
    configFile: active.source === 'file' ? aiConfigFile() : null,
  };
}

export function normalizeAiConfig(
  input: Record<string, unknown>,
  previous: AiConfig | null,
): AiConfig {
  const baseUrl = String(input.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Base URL is required');
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }
  const model = String(input.model ?? '').trim();
  if (!model) throw new Error('Model is required');
  // A blank key keeps the stored one; the field is write-only in the UI.
  const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : undefined;
  // Replacing a saved key requires the explicit flag the settings form sends.
  // A stray config POST (a test, a script) must not silently drop the key.
  if (key && previous?.apiKey && key !== previous.apiKey && input.replaceKey !== true) {
    throw new Error('A key is already saved; confirm replacing it');
  }
  const transcribe =
    typeof input.transcriptionModel === 'string'
      ? input.transcriptionModel.trim()
      : previous?.transcribeModel ?? '';
  return {
    baseUrl,
    model,
    apiKey: key === undefined ? previous?.apiKey ?? '' : key,
    transcribeModel: transcribe,
  };
}

/**
 * ponytail: plaintext JSON at 0600 in the user profile. Encrypt it with the OS
 * keychain (Electron `safeStorage`) if the file ever leaves this machine.
 */
export function saveAiConfig(input: Record<string, unknown>): AiStatus {
  const previous = currentAiConfig();
  if (previous?.source === 'env') {
    throw new Error('AI_BASE_URL is set in the environment; unset it to edit the model here');
  }
  const config = normalizeAiConfig(input, previous?.config ?? null);
  const file = aiConfigFile();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  stored = config;
  return aiStatus();
}

export function clearAiConfig(): AiStatus {
  const previous = currentAiConfig();
  if (previous?.source === 'env') {
    throw new Error('AI_BASE_URL is set in the environment; unset it to disable AI');
  }
  rmSync(aiConfigFile(), { force: true });
  stored = null;
  return aiStatus();
}

/** A base already pointing at `/chat/completions` is used as given. */
export function chatEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

export function audioEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return base.endsWith('/audio/transcriptions') ? base : `${base}/audio/transcriptions`;
}

/**
 * The renderer sends `default` to use the configured model, or a concrete id
 * picked in the composer. The sidecar still owns the provider and key.
 */
export function withModel(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const requested = typeof body.model === 'string' ? body.model.trim() : '';
  return { ...body, model: requested && requested !== 'default' ? requested : model };
}

export function modelsEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  // OpenCode Go publishes its catalog one level above the OpenAI-compatible base:
  // /inference/go/openai/v1/chat/completions -> /inference/go/v1/models.
  if (/opencode\.ai\/inference\/go\/openai\/v1$/i.test(base)) {
    return base.replace(/\/openai\/v1$/i, '/v1/models');
  }
  return `${base}/models`;
}

/** OpenAI-compatible `/models` payloads, plus the string-array variants. */
export function parseModelIds(payload: unknown): string[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? Array.isArray((payload as { data?: unknown }).data)
        ? ((payload as { data: unknown[] }).data)
        : Array.isArray((payload as { models?: unknown }).models)
          ? ((payload as { models: unknown[] }).models)
          : []
      : [];
  const ids = rows.flatMap((row) => {
    if (typeof row === 'string') return [row.trim()];
    if (!row || typeof row !== 'object') return [];
    const entry = row as { id?: unknown; name?: unknown; model?: unknown };
    const id =
      typeof entry.id === 'string'
        ? entry.id
        : typeof entry.name === 'string'
          ? entry.name
          : typeof entry.model === 'string'
            ? entry.model
            : '';
    return id.trim() ? [id.trim()] : [];
  });
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, limit = BODY_LIMIT): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new Error('AI request body is too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const text = (await readBody(req)).toString('utf8');
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('AI request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

async function chat(req: http.IncomingMessage, res: http.ServerResponse, config: AiConfig): Promise<void> {
  const body = await readJson(req);
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  const upstream = await fetch(chatEndpoint(config.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      // Gateways such as OpenCode Go ask clients to identify themselves and to
      // route a conversation consistently.
      'user-agent': 'screener-v2/0.1',
      ...(typeof req.headers['x-opencode-session'] === 'string'
        ? { 'x-opencode-session': req.headers['x-opencode-session'] }
        : {}),
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify(withModel(body, config.model)),
    signal: abort.signal,
  });

  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 2000);
    send(res, upstream.status, {
      error: `Model provider responded ${upstream.status}`,
      detail,
    });
    return;
  }
  if (!upstream.body) {
    send(res, 502, { error: 'Model provider returned an empty body' });
    return;
  }

  res.writeHead(200, {
    'content-type': upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'x-accel-buffering': 'no',
  });
  Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>).pipe(res);
}

/** Returns true when the request belongs to the AI surface. */
export async function handleAi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
): Promise<boolean> {
  if (!path.startsWith('/ai')) return false;

  if (path === '/ai/status') {
    send(res, 200, aiStatus());
    return true;
  }
  if (path === '/ai/config') {
    if (req.method === 'POST') {
      try {
        send(res, 200, saveAiConfig(await readJson(req)));
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }
    if (req.method === 'DELETE') {
      try {
        send(res, 200, clearAiConfig());
      } catch (error) {
        send(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }
    send(res, 405, { error: 'Method not allowed' });
    return true;
  }
  if (path === '/ai/transcribe') {
    if (req.method !== 'POST') {
      send(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const active = currentAiConfig();
    if (!active) {
      send(res, 503, { error: 'AI is not configured' });
      return true;
    }
    if (!active.config.transcribeModel) {
      send(res, 501, {
        error: 'Voice input is not configured',
        detail: 'Add a transcription model in Settings (for example whisper-1).',
      });
      return true;
    }
    try {
      const audio = await readBody(req, 25 * 1024 * 1024);
      if (audio.length === 0) {
        send(res, 400, { error: 'Empty audio clip' });
        return true;
      }
      const type = String(req.headers['content-type'] ?? 'audio/webm').split(';')[0];
      const extension = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio)], { type }), `speech.${extension}`);
      form.append('model', active.config.transcribeModel);
      const upstream = await fetch(audioEndpoint(active.config.baseUrl), {
        method: 'POST',
        headers: active.config.apiKey ? { authorization: `Bearer ${active.config.apiKey}` } : {},
        body: form,
      });
      const text = await upstream.text();
      if (!upstream.ok) {
        send(res, upstream.status, {
          error: `Transcription provider responded ${upstream.status}`,
          detail: text.slice(0, 1000),
        });
        return true;
      }
      let parsed: { text?: unknown } = {};
      try {
        parsed = JSON.parse(text) as { text?: unknown };
      } catch {
        /* some servers answer bare text */
      }
      send(res, 200, { text: typeof parsed.text === 'string' ? parsed.text : text.slice(0, 4000) });
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (path === '/ai/models') {
    if (req.method !== 'GET') {
      send(res, 405, { error: 'Method not allowed' });
      return true;
    }
    const active = currentAiConfig();
    if (!active) {
      send(res, 200, { models: [] });
      return true;
    }
    const cached =
      modelCache &&
      modelCache.baseUrl === active.config.baseUrl &&
      Date.now() - modelCache.at < MODEL_CACHE_MS
        ? modelCache
        : null;
    if (cached) {
      send(res, 200, { models: cached.models });
      return true;
    }
    try {
      const upstream = await fetch(modelsEndpoint(active.config.baseUrl), {
        headers: {
          accept: 'application/json',
          'user-agent': 'screener-v2/0.1',
          ...(typeof req.headers['x-opencode-session'] === 'string'
            ? { 'x-opencode-session': req.headers['x-opencode-session'] }
            : {}),
          ...(active.config.apiKey ? { authorization: `Bearer ${active.config.apiKey}` } : {}),
        },
      });
      const text = (await upstream.text()).slice(0, 1_000_000);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* some providers answer plain text */
      }
      const models = upstream.ok ? parseModelIds(parsed) : [];
      if (upstream.ok) {
        modelCache = { baseUrl: active.config.baseUrl, at: Date.now(), models };
      }
      send(res, 200, {
        models,
        error: upstream.ok ? undefined : `Model list responded ${upstream.status}`,
      });
    } catch (error) {
      send(res, 200, {
        models: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  if (path !== '/ai/v1/chat/completions') {
    send(res, 404, { error: `Unknown AI route "${path}"` });
    return true;
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'Method not allowed' });
    return true;
  }
  const active = currentAiConfig();
  if (!active) {
    send(res, 503, {
      error: 'AI is not configured',
      detail: 'Add a base URL and model in Settings, or set AI_BASE_URL for the sidecar.',
    });
    return true;
  }
  try {
    await chat(req, res, active.config);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return true;
    }
    send(res, 502, { error: error instanceof Error ? error.message : String(error) });
  }
  return true;
}
