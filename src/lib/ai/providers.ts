export interface AiProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  /** Local servers usually need no key. */
  keyless?: boolean;
}

/**
 * Every preset speaks the OpenAI-compatible surface the sidecar proxies.
 * Anthropic is absent on purpose: it has no such endpoint and would need the
 * native SDK plus an OpenAI-to-Anthropic translation layer.
 */
export const AI_PROVIDERS: AiProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  {
    id: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { id: 'xai', label: 'xAI', baseUrl: 'https://api.x.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: 'together', label: 'Together', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
  },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', keyless: true },
  { id: 'lmstudio', label: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1', keyless: true },
];

const normalize = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

/** Which preset the stored base URL came from, if any. */
export function providerIdFor(baseUrl: string | null | undefined): string {
  if (!baseUrl) return 'custom';
  const wanted = normalize(baseUrl);
  return AI_PROVIDERS.find((preset) => normalize(preset.baseUrl) === wanted)?.id ?? 'custom';
}

export function presetById(id: string): AiProviderPreset | undefined {
  return AI_PROVIDERS.find((preset) => preset.id === id);
}
