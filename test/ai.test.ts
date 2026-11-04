import { describe, expect, it } from 'vitest';
import {
  aiConfigFile,
  audioEndpoint,
  chatEndpoint,
  modelsEndpoint,
  normalizeAiConfig,
  parseModelIds,
  withModel,
} from '../sidecar/ai';
import { providerIdFor, presetById } from '../src/lib/ai/providers';
import { toolsForAgent } from '../src/lib/ai/tools';

describe('AI sidecar config', () => {
  it('trims the base URL and keeps the stored key when the field is blank', () => {
    const config = normalizeAiConfig(
      { baseUrl: ' https://openrouter.ai/api/v1/ ', model: ' google/gemini-2.5-flash ' },
      {
        baseUrl: 'https://old.example/v1',
        model: 'old',
        apiKey: 'sk-keep',
        transcribeModel: 'whisper-1',
      },
    );
    expect(config).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-2.5-flash',
      apiKey: 'sk-keep',
      transcribeModel: 'whisper-1',
    });
  });

  it('replaces the key when one is typed', () => {
    const config = normalizeAiConfig(
      { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen', apiKey: ' sk-new ' },
      null,
    );
    expect(config.apiKey).toBe('sk-new');
  });

  it('requires the explicit flag before replacing a saved key', () => {
    const previous = {
      baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      model: 'deepseek-v4.1-flash',
      apiKey: 'sk-keep',
      transcribeModel: '',
    };
    expect(() =>
      normalizeAiConfig(
        { baseUrl: previous.baseUrl, model: previous.model, apiKey: 'sk-new' },
        previous,
      ),
    ).toThrow(/already saved/i);
    expect(
      normalizeAiConfig(
        {
          baseUrl: previous.baseUrl,
          model: previous.model,
          apiKey: 'sk-new',
          replaceKey: true,
        },
        previous,
      ).apiKey,
    ).toBe('sk-new');
  });

  it('rejects a base URL that is not http(s)', () => {
    expect(() =>
      normalizeAiConfig({ baseUrl: 'file:///etc/passwd', model: 'm' }, null),
    ).toThrow(/http/);
    expect(() => normalizeAiConfig({ baseUrl: '', model: 'm' }, null)).toThrow(/required/);
    expect(() =>
      normalizeAiConfig({ baseUrl: 'https://x.test/v1', model: '  ' }, null),
    ).toThrow(/Model/);
  });

  it('lets the composer pick a model and keeps the configured one for default', () => {
    expect(withModel({ model: 'default' }, 'deepseek-v4.1-flash').model).toBe(
      'deepseek-v4.1-flash',
    );
    expect(withModel({ model: 'glm-5.3-flash' }, 'deepseek-v4.1-flash').model).toBe(
      'glm-5.3-flash',
    );
    expect(withModel({}, 'deepseek-v4.1-flash').model).toBe('deepseek-v4.1-flash');
  });

  it('reads model ids from the OpenAI-compatible catalog shapes', () => {
    expect(parseModelIds({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })).toEqual(['a', 'b']);
    expect(parseModelIds({ models: [{ name: 'glm-5.3' }] })).toEqual(['glm-5.3']);
    expect(parseModelIds(['b', 'a'])).toEqual(['a', 'b']);
    expect(parseModelIds(null)).toEqual([]);
  });

  it('points the catalog at the provider root, not the chat base', () => {
    expect(modelsEndpoint('https://opencode.ai/inference/go/openai/v1')).toBe(
      'https://opencode.ai/inference/go/v1/models',
    );
    expect(modelsEndpoint('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/models',
    );
  });

  it('stores the settings file in the user profile, not the repo', () => {
    const file = aiConfigFile({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } as NodeJS.ProcessEnv);
    expect(file).toBe('C:\\Users\\me\\AppData\\Roaming\\screener-v2\\ai.json');
    expect(aiConfigFile({ AI_CONFIG_FILE: 'D:\\tmp\\ai.json' } as NodeJS.ProcessEnv)).toBe(
      'D:\\tmp\\ai.json',
    );
  });

  it('appends /chat/completions once and swaps the placeholder model', () => {
    expect(chatEndpoint('https://api.test/v1')).toBe('https://api.test/v1/chat/completions');
    expect(chatEndpoint('https://api.test/v1/chat/completions')).toBe(
      'https://api.test/v1/chat/completions',
    );
    expect(withModel({ model: 'default', messages: [] }, 'real-model')).toEqual({
      model: 'real-model',
      messages: [],
    });
  });

  it('routes transcription to /audio/transcriptions', () => {
    expect(audioEndpoint('https://api.test/v1')).toBe(
      'https://api.test/v1/audio/transcriptions',
    );
    expect(audioEndpoint('https://api.test/v1/chat/completions')).toBe(
      'https://api.test/v1/audio/transcriptions',
    );
  });
});

describe('AI provider presets', () => {
  it('maps a stored base URL back to its preset and falls back to custom', () => {
    expect(providerIdFor('https://api.openai.com/v1/')).toBe('openai');
    expect(providerIdFor('https://opencode.ai/inference/go/openai/v1')).toBe('opencode-go');
    expect(providerIdFor('http://127.0.0.1:11434/v1')).toBe('ollama');
    expect(providerIdFor('https://example.test/v1')).toBe('custom');
    expect(providerIdFor(null)).toBe('custom');
    expect(presetById('openai')?.baseUrl).toBe('https://api.openai.com/v1');
    expect(presetById('nope')).toBeUndefined();
  });
});

describe('AI agent tools', () => {
  it('hides every editing tool from a read-only agent', () => {
    const tools = {
      get_chart_context: 1,
      get_script: 2,
      read_lines: 3,
      edit_code: 4,
      apply_script: 5,
      run_script: 6,
      apply_live: 7,
    };
    expect(Object.keys(toolsForAgent(tools, true))).toEqual([
      'get_chart_context',
      'get_script',
      'read_lines',
      'run_script',
    ]);
    expect(toolsForAgent(tools, false)).toBe(tools);
  });
});
