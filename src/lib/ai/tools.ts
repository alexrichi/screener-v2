import { tool } from 'ai';
import { z } from 'zod';
import type { ChartContext, ScriptRunReport } from '../../types';
import type {
  DrawingApplyResult,
  DrawingInfo,
  DrawingPatch,
  DrawingRequest,
  DrawingToolInfo,
} from './drawings';
import { applyEdits } from './edits';
import { outlineScript } from './scriptOutline';
import type { AiScriptTarget } from './target';

/** Source above this is not sent whole; the model reads it in ranges. */
const INLINE_LIMIT = 40_000;
/** `read_lines` page size. */
const READ_LINES_LIMIT = 400;
const DEFAULT_READ_LINES = 200;

export interface LiveApplyResult {
  /** The on-chart script now runs the editor buffer. */
  ok: boolean;
  /** Charts that took it. */
  charts: number;
  error?: string;
}

export type DraftConflict = 'save' | 'discard' | 'cancel';

export interface NewScriptResult {
  created: boolean;
  needsDecision?: boolean;
  cancelled?: boolean;
  chars?: number;
  target?: AiScriptTarget;
  draft?: { title: string; chars: number; saved: boolean };
  options?: DraftConflict[];
  hint?: string;
  error?: string;
}

export interface AiToolRuntime {
  /** Bind the chat to the active script on first use, then keep that target. */
  target: () => AiScriptTarget;
  getScript: () => string;
  /** Start a fresh buffer, first resolving an unsaved draft with the user. */
  newScript: (input: {
    source: string;
    title?: string;
    conflict?: DraftConflict;
  }) => NewScriptResult;
  /** Replace the editor buffer; the user can still undo and apply from the panel. */
  applyScript: (source: string) => void;
  chartContext: () => ChartContext | null;
  runScript: (source: string, options?: { bar?: number }) => Promise<ScriptRunReport>;
  /** Apply the editor buffer to the active chart in place, keeping its settings. */
  applyLive: () => Promise<LiveApplyResult>;
  drawingTools: () => DrawingToolInfo[];
  listDrawings: () => DrawingInfo[];
  drawOnChart: (requests: DrawingRequest[]) => DrawingApplyResult;
  updateDrawing: (id: string, patch: DrawingPatch) => { ok: boolean; error?: string };
  removeDrawing: (id: string) => { ok: boolean };
  clearDrawings: () => { removed: number };
}

/**
 * App tools run in the renderer because that is where the editor and the chart
 * live. Every one of them talks to an existing seam, never to Vela internals.
 */
export function createAppTools(runtime: AiToolRuntime) {
  return {
    get_chart_context: tool({
      description:
        'Read the active chart: symbol, timeframe, layout, chart count, on-chart indicators, the applied Pine-panel script (appliedPine) and the visible window. Use this to check what is actually on the chart; the editor buffer may differ.',
      inputSchema: z.object({}),
      execute: async () => runtime.chartContext() ?? { error: 'No chart is open' },
    }),

    get_script: tool({
      description:
        'Read the Pine editor buffer. This is not necessarily the script applied to the chart: check get_chart_context for appliedPine and the on-chart indicators before saying a script is running. Small scripts come whole; large ones come as an engine-AST outline with line numbers so you can pull exact ranges with read_lines. The outline includes declarations, functions, types, inputs, plots and request.security calls with their exact lines. Call this before editing.',
      inputSchema: z.object({}),
      execute: async () => {
        const target = runtime.target();
        const source = runtime.getScript();
        const outline = outlineScript(source);
        const truncated = source.length > INLINE_LIMIT;
        const chart = runtime.chartContext();
        return {
          scope: 'editor',
          target,
          appliedPine: chart?.appliedPine ?? null,
          onChartIndicators: chart?.indicators ?? [],
          chars: source.length,
          lines: outline.lines,
          truncated,
          source: truncated ? null : source,
          outline: outline.entries,
          outlineTruncated: outline.truncated,
          hint: truncated
            ? 'Too large to send whole. Use read_lines(from, to) for the region you need, then edit_code with small patches.'
            : undefined,
        };
      },
    }),

    read_lines: tool({
      description:
        'Read a line range of the open script. Returns raw text without line-number prefixes, so it can be copied into edit_code unchanged.',
      inputSchema: z.object({
        from: z.number().int().min(1).describe('First line, 1-based.'),
        to: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(`Last line, inclusive. Defaults to ${DEFAULT_READ_LINES} lines.`),
      }),
      execute: async ({ from, to }) => {
        const lines = runtime.getScript().split(/\r?\n/);
        const start = Math.min(Math.max(1, from), Math.max(1, lines.length));
        const end = Math.min(
          Math.max(start, to ?? start + DEFAULT_READ_LINES - 1),
          Math.min(lines.length, start + READ_LINES_LIMIT - 1),
        );
        return {
          from: start,
          to: end,
          total: lines.length,
          text: lines.slice(start - 1, end).join('\n'),
        };
      },
    }),

    edit_code: tool({
      description:
        'Patch the editor with exact replacements instead of re-sending the whole script. Each oldStr must occur exactly once. Use this for any fix in a large script.',
      inputSchema: z.object({
        summary: z.string().describe('One line: what changes and why.'),
        edits: z
          .array(
            z.object({
              oldStr: z.string().min(1).describe('Exact current text, copied from read_lines.'),
              newStr: z.string().describe('Replacement text; empty deletes the block.'),
            }),
          )
          .min(1)
          .max(10),
      }),
      execute: async ({ summary, edits }) => {
        const before = runtime.getScript();
        const result = applyEdits(before, edits);
        if (!result.ok) return { applied: false, reason: result.error };
        runtime.applyScript(result.code);
        return {
          applied: true,
          target: runtime.target(),
          summary,
          edits: edits.length,
          beforeChars: before.length,
          afterChars: result.code.length,
        };
      },
    }),

    new_script: tool({
      description:
        'Start a NEW Pine indicator or strategy in a fresh editor buffer. Use this instead of apply_script whenever the user asks for a new script. If the editor holds unsaved changes this returns needsDecision with draft {title, chars, saved} and options save/discard/cancel: ask the user which one they want, then call new_script again with the same source and conflict set to their choice. Save keeps the draft in the Library, discard drops it, cancel aborts. After created=true the new source is in the buffer; apply it with apply_live.',
      inputSchema: z.object({
        source: z.string().min(1).describe('Complete Pine v6 source for the new script.'),
        title: z
          .string()
          .optional()
          .describe('Short title if the user named the script; otherwise the declaration supplies it.'),
        conflict: z
          .enum(['save', 'discard', 'cancel'])
          .optional()
          .describe(
            'How to handle the unsaved draft. Omit on the first call; pass the user choice on the next one.',
          ),
      }),
      execute: async ({ source, title, conflict }) =>
        runtime.newScript({ source, title, conflict }),
    }),

    apply_script: tool({
      description:
        'Replace the whole editor buffer with new Pine source. Use only when the user asked to rewrite the current script; to start a new indicator or strategy call new_script so an unsaved draft is never overwritten. Large scripts must be patched with edit_code.',
      inputSchema: z.object({
        source: z.string().min(1).describe('Complete Pine v6 script source.'),
      }),
      execute: async ({ source }) => {
        if (source.length > INLINE_LIMIT) {
          return {
            applied: false,
            reason: `Source is ${source.length} chars. Patches via edit_code avoid the output limit.`,
          };
        }
        runtime.applyScript(source);
        return { applied: true, target: runtime.target(), chars: source.length };
      },
    }),

    run_script: tool({
      description:
        'Run Pine twice and return both full results: on the active chart (the source of truth) and in a disposable worker over the same sidecar bars. The worker uses the same engine, runs in isolation, captures log.info/warning/error lines, and is terminated on timeout, so it never blocks the UI. The worker also returns the top-level variables at the requested zero-based bar (or the last bar). Compare the two when they disagree. The probe removes itself; it does not update the on-chart indicator.',
      inputSchema: z.object({
        source: z
          .string()
          .optional()
          .describe('Pine source to test. Omit to run the script currently in the editor.'),
        bar: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Zero-based bar for the worker variable snapshot. Omit for the last bar.'),
      }),
      execute: async ({ source, bar }) =>
        runtime.runScript(source ?? runtime.getScript(), { bar }),
    }),

    apply_live: tool({
      description:
        'Apply the editor buffer to the active chart in place: same indicator, same legend row, same input and prop values, new code. Call this after edit_code to verify the fix on the real chart; on failure the previous code keeps running and the error is returned.',
      inputSchema: z.object({}),
      execute: async () => runtime.applyLive(),
    }),

    list_drawing_tools: tool({
      description:
        'List every native drawing type the chart can place, with the anchor count it needs. Call this before draw_on_chart: types differ (hline and vline take 1 point, trendline and box 2, channels 3, harmonic patterns 5-7).',
      inputSchema: z.object({}),
      execute: async () => {
        const tools = runtime.drawingTools();
        return { count: tools.length, tools };
      },
    }),

    list_drawings: tool({
      description:
        'List the native user drawings already on the active chart, with their ids, types, anchors and text. Call this before updating, removing or adding drawings that could duplicate one.',
      inputSchema: z.object({}),
      execute: async () => {
        const context = runtime.chartContext();
        const drawings = runtime.listDrawings();
        return {
          symbol: context?.symbol ?? null,
          timeframe: context?.timeframe ?? null,
          count: drawings.length,
          drawings,
        };
      },
    }),

    draw_on_chart: tool({
      description:
        'Place native drawings on the active chart (trend lines, horizontal lines, boxes, fibs, patterns, annotations - every type list_drawing_tools reports). Anchors are { time: epoch milliseconds, price }; get the visible window from get_chart_context first. Use only when the user asks to draw or mark something. It never changes or removes existing drawings; the result returns the created ids and per-item errors.',
      inputSchema: z.object({
        drawings: z
          .array(
            z.object({
              type: z.string().describe('A drawing type from list_drawing_tools.'),
              points: z
                .array(
                  z.object({
                    time: z.number().finite().describe('Anchor time in epoch milliseconds (UTC).'),
                    price: z.number().finite().describe('Anchor price.'),
                  }),
                )
                .min(1)
                .max(12)
                .describe('Anchors in the order the type expects.'),
              text: z.string().max(300).optional().describe('Label text, when the type shows one.'),
              style: z
                .object({
                  lineColor: z.string().optional(),
                  lineWidth: z.number().min(1).max(8).optional(),
                  lineStyle: z.string().optional().describe('solid, dashed or dotted.'),
                  fillColor: z.string().optional(),
                  fillOpacity: z.number().min(0).max(1).optional(),
                  arrowLeft: z.boolean().optional(),
                  arrowRight: z.boolean().optional(),
                  extendLeft: z.boolean().optional(),
                  extendRight: z.boolean().optional(),
                })
                .optional(),
              props: z
                .record(z.string(), z.unknown())
                .optional()
                .describe('Per-type extras, for example fib levels.'),
            }),
          )
          .min(1)
          .max(20),
      }),
      execute: async ({ drawings }) => runtime.drawOnChart(drawings as DrawingRequest[]),
    }),

    update_drawing: tool({
      description:
        'Move, restyle or relabel one existing native drawing by id. Read ids with list_drawings. Omitted fields keep their current values; points replace the whole anchor list and must satisfy the type anchor count.',
      inputSchema: z.object({
        id: z.string().describe('Drawing id from list_drawings.'),
        points: z
          .array(z.object({ time: z.number().finite(), price: z.number().finite() }))
          .min(1)
          .max(12)
          .optional(),
        text: z.string().max(300).optional(),
        style: z
          .object({
            lineColor: z.string().optional(),
            lineWidth: z.number().min(1).max(8).optional(),
            lineStyle: z.string().optional(),
            fillColor: z.string().optional(),
            fillOpacity: z.number().min(0).max(1).optional(),
            arrowLeft: z.boolean().optional(),
            arrowRight: z.boolean().optional(),
            extendLeft: z.boolean().optional(),
            extendRight: z.boolean().optional(),
          })
          .optional(),
        props: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async ({ id, points, text, style, props }) => {
        const patch: DrawingPatch = {};
        if (points) patch.points = points;
        if (text !== undefined) patch.text = text;
        if (style) patch.style = style;
        if (props) patch.props = props;
        return runtime.updateDrawing(id, patch);
      },
    }),

    remove_drawing: tool({
      description:
        'Remove one native drawing by id. Only when the user explicitly asks to delete it; the removal is a chart undo step.',
      inputSchema: z.object({
        id: z.string().describe('Drawing id from list_drawings.'),
      }),
      execute: async ({ id }) => runtime.removeDrawing(id),
    }),

    clear_drawings: tool({
      description:
        'Remove every native user drawing on the active chart as one undo step. Destructive: only when the user explicitly asks to clear the chart.',
      inputSchema: z.object({}),
      execute: async () => runtime.clearDrawings(),
    }),
  };
}

export type AppTools = ReturnType<typeof createAppTools>;