/** One anchor in chart data space: epoch milliseconds and price. */
export interface DrawingPointInput {
  time: number;
  price: number;
}

/** What the agent asks the host to place on the active chart. */
export interface DrawingRequest {
  /** A Vela drawing type key from `drawingTools()`. */
  type: string;
  points: DrawingPointInput[];
  text?: string;
  style?: Partial<{
    lineColor: string;
    lineWidth: number;
    lineStyle: string;
    fillColor: string;
    fillOpacity: number;
    arrowLeft: boolean;
    arrowRight: boolean;
    extendLeft: boolean;
    extendRight: boolean;
  }>;
  props?: Record<string, unknown>;
}

export interface DrawingToolInfo {
  type: string;
  group: string;
  label: string;
  /** Anchors the type needs at minimum. */
  min: number;
  /** Anchors the type accepts at most. */
  max: number;
  /** One role per anchor handle, in anchor order. */
  slots: string[];
}

export interface DrawingInfo {
  id: string;
  type: string;
  anchors: DrawingPointInput[];
  text: string | null;
  locked: boolean;
  visible: boolean;
}

export interface DrawingApplyResult {
  created: string[];
  errors: string[];
}

/** A partial change to an existing drawing; omitted fields stay as they are. */
export interface DrawingPatch {
  points?: DrawingPointInput[];
  text?: string;
  style?: DrawingRequest['style'];
  props?: Record<string, unknown>;
}

/**
 * Rejects a request before it reaches Vela. The host passes the type's anchor
 * schema; the agent-facing messages name the type and the expected count so a
 * retry is obvious.
 */
export function validateDrawingRequest(
  request: Pick<DrawingRequest, 'type' | 'points'>,
  schema: { min: number; max: number } | null | undefined,
): string | null {
  if (!schema) return `Unknown drawing type "${request.type}"`;
  if (!Array.isArray(request.points)) return 'points must be an array';
  const count = request.points.length;
  if (count < schema.min || count > schema.max) {
    const expected =
      schema.min === schema.max ? `${schema.min}` : `${schema.min}-${schema.max}`;
    return `${request.type} needs ${expected} points, got ${count}`;
  }
  for (const point of request.points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.price)) {
      return 'Each point needs a finite time (ms) and price';
    }
  }
  return null;
}
