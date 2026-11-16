/** The script and chart an AI tool call is allowed to touch. */
export interface AiScriptTarget {
  /** Pine editor tab that owns the script buffer. */
  pineTabId: string;
  /** Library item id when the buffer is a saved script; empty for a draft. */
  savedId: string;
  name: string;
  /** Workspace tab whose active chart is the run/apply target. */
  workspaceTabId: string;
}
