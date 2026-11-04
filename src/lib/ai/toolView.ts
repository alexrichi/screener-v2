export type ToolStatus = 'running' | 'ok' | 'error';

export interface ToolSection {
  label: string;
  text: string;
  mono?: boolean;
}

export interface ToolView {
  title: string;
  summary: string;
  status: ToolStatus;
  sections: ToolSection[];
  /** Errors open themselves; successful calls stay compact. */
  defaultOpen: boolean;
}

export const TOOL_LABELS: Record<string, string> = {
  get_chart_context: 'Chart context',
  get_script: 'Read script',
  read_lines: 'Read lines',
  edit_code: 'Patch script',
  apply_script: 'Replace script',
  run_script: 'Run script',
  apply_live: 'Apply to chart',
};

const MAX_TEXT = 8000;
const MAX_PATCH = 1200;

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const fmt = (value: number): string => new Intl.NumberFormat('en-US').format(value);
const clip = (value: string, limit = MAX_TEXT): string =>
  value.length > limit ? `${value.slice(0, limit)}\n… ${value.length - limit} more chars` : value;

function section(label: string, text: string, mono = true): ToolSection[] {
  return text.trim() ? [{ label, text: clip(text), mono }] : [];
}

function scriptView(output: Record<string, unknown>): ToolView {
  const chars = asNumber(output.chars) ?? 0;
  const lines = asNumber(output.lines) ?? 0;
  const truncated = output.truncated === true;
  const outline = asArray(output.outline).flatMap((entry) => {
    const row = record(entry);
    if (!row) return [];
    return [`L${asNumber(row.line) ?? '?'}  ${asText(row.kind)}  ${asText(row.text)}`];
  });
  const source = asText(output.source);
  return {
    title: 'Read script',
    summary: truncated
      ? `${fmt(lines)} lines · outline (too large to send whole)`
      : `${fmt(lines)} lines · ${fmt(chars)} chars`,
    status: 'ok',
    defaultOpen: false,
    sections: [
      ...(source ? section('Source', source) : []),
      ...(outline.length > 0 ? [{ label: 'Outline', text: outline.join('\n'), mono: true }] : []),
    ],
  };
}

function readLinesView(input: Record<string, unknown>, output: Record<string, unknown>): ToolView {
  const from = asNumber(output.from) ?? asNumber(input.from) ?? 0;
  const to = asNumber(output.to) ?? asNumber(input.to) ?? 0;
  const total = asNumber(output.total) ?? 0;
  return {
    title: 'Read lines',
    summary: `Lines ${fmt(from)}–${fmt(to)} of ${fmt(total)}`,
    status: 'ok',
    defaultOpen: false,
    sections: section('Code', asText(output.text)),
  };
}

function editView(input: Record<string, unknown>, output: Record<string, unknown>): ToolView {
  const applied = output.applied === true;
  const patches = asArray(input.edits).flatMap((entry, index) => {
    const edit = record(entry);
    if (!edit) return [];
    const oldText = asText(edit.oldStr);
    const newText = asText(edit.newStr);
    return [
      `#${index + 1}\n- ${clip(oldText, MAX_PATCH).split('\n').join('\n- ')}\n+ ${clip(
        newText,
        MAX_PATCH,
      )
        .split('\n')
        .join('\n+ ')}`,
    ];
  });
  return {
    title: 'Patch script',
    summary: applied
      ? `${patches.length} edit${patches.length === 1 ? '' : 's'} · ${asText(input.summary) || 'applied'}`
      : `Rejected · ${asText(output.reason) || 'anchor not found'}`,
    status: applied ? 'ok' : 'error',
    defaultOpen: !applied,
    sections: [
      ...(applied ? [] : section('Reason', asText(output.reason), false)),
      ...(patches.length > 0 ? [{ label: 'Patch', text: patches.join('\n\n'), mono: true }] : []),
    ],
  };
}

function replaceView(output: Record<string, unknown>): ToolView {
  const applied = output.applied === true;
  return {
    title: 'Replace script',
    summary: applied
      ? `${fmt(asNumber(output.chars) ?? 0)} chars`
      : `Rejected · ${asText(output.reason) || 'not applied'}`,
    status: applied ? 'ok' : 'error',
    defaultOpen: !applied,
    sections: applied ? [] : section('Reason', asText(output.reason), false),
  };
}

/** One run's full result: errors, logs, plots and vars stay visible to the model and the user. */
function runSections(label: string, summary: Record<string, unknown>): ToolSection[] {
  const error = asText(summary.error);
  const method = asText(summary.method);
  const stack = asText(summary.stack);
  const warnings = asArray(summary.warnings).map((entry) => asText(entry)).filter(Boolean);
  const logs = asArray(summary.logs).map((entry) => asText(entry)).filter(Boolean);
  const plots = record(summary.plots) ?? {};
  const vars = record(summary.vars) ?? {};
  const bars = asNumber(summary.bars) ?? 0;
  const maxBarsBack = asNumber(summary.maxBarsBack);
  const plotLines = Object.entries(plots).map(
    ([key, value]) => `${key} = ${value === null ? 'na' : String(value)}`,
  );
  const varLines = Object.entries(vars).map(([key, value]) => `${key} = ${String(value)}`);
  const kind = summary.strategy === true ? 'strategy' : 'indicator';
  const context = `${asText(summary.symbol) || 'chart'} · ${
    asText(summary.timeframe) || '?'
  } · ${fmt(bars)} bars${maxBarsBack === null ? '' : ` · max_bars_back ${fmt(maxBarsBack)}`}`;
  return [
    ...(error ? section(`${label} error`, `${asText(summary.errorName) || 'Error'}: ${error}`, false) : []),
    ...(method ? section(`${label} method`, method, false) : []),
    ...(stack ? section(`${label} stack`, stack) : []),
    ...(warnings.length > 0 ? section(`${label} warnings`, warnings.join('\n'), false) : []),
    ...(logs.length > 0 ? section(`${label} logs`, logs.join('\n'), false) : []),
    ...(plotLines.length > 0 ? section(`${label} plots`, plotLines.join('\n')) : []),
    ...(varLines.length > 0 ? section(`${label} vars`, varLines.join('\n')) : []),
    { label: `${label} context`, text: `${kind} · ${context}`, mono: false },
  ];
}

function runView(output: Record<string, unknown>): ToolView {
  const live = record(output.live) ?? {};
  const worker = record(output.worker) ?? {};
  const liveOk = live.ok === true;
  const workerOk = worker.ok === true;
  const method = asText(live.method);
  const firstError = (asText(live.error) || asText(worker.error)).split('\n')[0] ?? '';
  const summary = liveOk
    ? `live ok · ${workerOk ? 'worker ok' : 'worker failed'}`
    : `live failed${method ? ` in ${method}` : ''} · ${workerOk ? 'worker ok' : 'worker failed'}: ${firstError.slice(0, 100)}`;
  return {
    title: 'Run script',
    summary,
    status: liveOk && workerOk ? 'ok' : 'error',
    defaultOpen: !liveOk || !workerOk,
    sections: [
      ...runSections('Live', live),
      ...runSections('Worker', worker),
    ],
  };
}

function applyLiveView(output: Record<string, unknown>): ToolView {
  const ok = output.ok === true;
  const charts = asNumber(output.charts) ?? 0;
  return {
    title: 'Apply to chart',
    summary: ok
      ? `live ok · ${charts} chart${charts === 1 ? '' : 's'}`
      : `Rejected · ${asText(output.error) || 'not applied'}`,
    status: ok ? 'ok' : 'error',
    defaultOpen: !ok,
    sections: ok ? [] : section('Reason', asText(output.error), false),
  };
}

function chartView(output: Record<string, unknown>): ToolView {
  const indicators = asArray(output.indicators).map((entry) => asText(entry)).filter(Boolean);
  const visible = record(output.visible);
  return {
    title: 'Chart context',
    summary: `${asText(output.symbol) || 'chart'} · ${asText(output.timeframe) || '?'} · ${
      indicators.length
    } indicator${indicators.length === 1 ? '' : 's'}`,
    status: 'ok',
    defaultOpen: false,
    sections: [
      ...(indicators.length > 0
        ? [{ label: 'Indicators', text: indicators.join('\n'), mono: false }]
        : []),
      ...(visible
        ? [
            {
              label: 'Visible',
              text: `${new Date(asNumber(visible.from) ?? 0).toISOString()} → ${new Date(
                asNumber(visible.to) ?? 0,
              ).toISOString()}`,
              mono: true,
            },
          ]
        : []),
    ],
  };
}

export function toolView(part: {
  name: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}): ToolView {
  const title = TOOL_LABELS[part.name] ?? part.name;
  if (part.state === 'input-streaming' || part.state === 'input-available') {
    return {
      title,
      summary: 'running…',
      status: 'running',
      defaultOpen: false,
      sections: [],
    };
  }
  if (part.state === 'output-error') {
    return {
      title,
      summary: 'failed',
      status: 'error',
      defaultOpen: true,
      sections: section('Error', part.errorText ?? 'Tool failed', false),
    };
  }
  const input = record(part.input) ?? {};
  const output = record(part.output) ?? {};
  switch (part.name) {
    case 'get_chart_context':
      return chartView(output);
    case 'get_script':
      return scriptView(output);
    case 'read_lines':
      return readLinesView(input, output);
    case 'edit_code':
      return editView(input, output);
    case 'apply_script':
      return replaceView(output);
    case 'run_script':
      return runView(output);
    case 'apply_live':
      return applyLiveView(output);
    default:
      return {
        title,
        summary: 'done',
        status: 'ok',
        defaultOpen: false,
        sections: section('Result', JSON.stringify(part.output, null, 2) ?? '', true),
      };
  }
}
