import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { sidecarBaseUrl } from '../../venues/sidecar';

/**
 * The sidecar owns the provider, key and model id. The renderer only speaks the
 * OpenAI-compatible surface it exposes, so no secret reaches the browser.
 */
export const AI_MODEL_ID = 'default';

/** Composer reasoning level; `auto` leaves the provider default alone. */
export type AiReasoning = 'auto' | 'none' | 'low' | 'medium' | 'high';

export const AI_REASONING_LEVELS: AiReasoning[] = ['auto', 'none', 'low', 'medium', 'high'];

export function isAiReasoning(value: unknown): value is AiReasoning {
  return typeof value === 'string' && (AI_REASONING_LEVELS as string[]).includes(value);
}

let sessionHeader = 'ses_screener';

/** OpenCode Go asks for a stable conversation id on every request. */
export function setAiSession(sessionId: string): void {
  sessionHeader = `ses_${sessionId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

const provider = createOpenAICompatible({
  name: 'screener-sidecar',
  baseURL: `${sidecarBaseUrl()}/ai/v1`,
  apiKey: 'sidecar',
  fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('x-opencode-session', sessionHeader);
    return fetch(input, { ...init, headers });
  },
});

/** `default` means the sidecar's configured model; a concrete id overrides it. */
export function aiModelFor(model?: string | null) {
  const id = model?.trim();
  return provider.chatModel(id && id !== AI_MODEL_ID ? id : AI_MODEL_ID);
}

export const aiModel = aiModelFor(null);

/** The provider catalog, keyed by the sidecar so the key stays private. */
export async function fetchAiModels(): Promise<string[]> {
  const response = await fetch(`${sidecarBaseUrl()}/ai/models`, {
    headers: { 'x-opencode-session': sessionHeader },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Sidecar ${response.status}`;
    throw new Error(detail);
  }
  const models =
    body && typeof body === 'object' && Array.isArray((body as { models?: unknown }).models)
      ? ((body as { models: unknown[] }).models)
      : [];
  return models.filter((model): model is string => typeof model === 'string' && model.length > 0);
}

export interface AiStatus {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  /** Whisper-compatible model id, or null when voice input is off. */
  transcriptionModel: string | null;
  keySet: boolean;
  source: 'env' | 'file' | null;
  /** The sidecar's settings file, shown in Settings to diagnose path mismatches. */
  configFile: string | null;
}

async function request(path: string, init?: RequestInit): Promise<AiStatus> {
  const response = await fetch(`${sidecarBaseUrl()}${path}`, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Sidecar ${response.status}`;
    throw new Error(detail);
  }
  return body as AiStatus;
}

export async function fetchAiStatus(): Promise<AiStatus> {
  return request('/ai/status');
}

/** The key is write-only: the sidecar answers with its presence, never the value. */
export async function saveAiConfig(input: {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Required when replacing a key that is already stored. */
  replaceKey?: boolean;
  transcriptionModel?: string;
}): Promise<AiStatus> {
  return request('/ai/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function clearAiConfig(): Promise<AiStatus> {
  return request('/ai/config', { method: 'DELETE' });
}

/** The sidecar forwards the clip to `<base>/audio/transcriptions`. */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const response = await fetch(`${sidecarBaseUrl()}/ai/transcribe`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/webm' },
    body: blob,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Sidecar ${response.status}`;
    throw new Error(detail);
  }
  return String((body as { text?: unknown })?.text ?? '');
}
