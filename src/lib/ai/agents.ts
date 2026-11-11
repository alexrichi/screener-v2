export type AiAgentId = 'assistant' | 'analyst' | 'pine';

export interface AiAgent {
  id: AiAgentId;
  label: string;
  hint: string;
  /** Read-only agents do not get the editing tool. */
  readOnly: boolean;
  instructions: string;
}

export const AI_AGENTS: AiAgent[] = [
  {
    id: 'assistant',
    label: 'Assistant',
    hint: 'Everything: chart questions, code edits, debugging',
    readOnly: false,
    instructions:
      'You are a general trading assistant: chart reading, Pine work and debugging are all in scope.',
  },
  {
    id: 'analyst',
    label: 'Chart analyst',
    hint: 'Reads the chart and the script; never edits code',
    readOnly: true,
    instructions:
      'Act as a chart analyst. Describe structure, levels, trend, momentum and indicator readings from the attached image and chart context. Do not propose code edits unless the user explicitly asks; you have no editing tool.',
  },
  {
    id: 'pine',
    label: 'Pine developer',
    hint: 'Writes and debugs Pine scripts on the chart',
    readOnly: false,
    instructions:
      'Act as a Pine v6 developer for the chart engine. get_script reads the editor buffer, which may not be on the chart; use get_chart_context (appliedPine and indicators) for what is actually running. For large files get_script returns a compiler-AST outline with exact lines, so use read_lines for the region you need. Make the smallest change that satisfies the request, then call apply_live so the fix runs on the real chart. Use run_script with a zero-based bar to see the worker top-level variables at that bar and to compare chart vs worker logs. Report errors verbatim instead of guessing.',
  },
];

export function agentById(id: unknown): AiAgent {
  return AI_AGENTS.find((agent) => agent.id === id) ?? AI_AGENTS[0];
}
