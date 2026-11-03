import { useEffect, useMemo, useRef } from 'react';
import {
  Code2,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Layers,
  Play,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type { SavedIndicator } from '../lib/indicatorLibrary';
import { Input } from '../ui/primitives';
import { cn } from '../ui/cn';

interface Props {
  items: SavedIndicator[];
  currentId: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  revealId: string | null;
  revealNonce: number;
  onNew: () => void;
  onEdit: (item: SavedIndicator) => void;
  onAdd: (item: SavedIndicator, allCells: boolean) => void;
  onScan: (item: SavedIndicator) => void;
  onRename: (item: SavedIndicator) => void;
  onDuplicate: (item: SavedIndicator) => void;
  onDelete: (item: SavedIndicator) => void;
  onExport: (item: SavedIndicator) => void;
  onExportAll: () => void;
  onImportFile: (file: File) => void;
}

function updatedLabel(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LibraryPanel({
  items,
  currentId,
  query,
  onQueryChange,
  revealId,
  revealNonce,
  onNew,
  onEdit,
  onAdd,
  onScan,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
  onExportAll,
  onImportFile,
}: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    if (!needle) return sorted;
    return sorted.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.source.toLowerCase().includes(needle),
    );
  }, [items, query]);

  useEffect(() => {
    if (!revealId) return;
    itemRefs.current.get(revealId)?.scrollIntoView({ block: 'nearest' });
  }, [revealId, revealNonce, visible]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search saved indicators…"
            className="pl-7"
          />
        </div>
        <button
          type="button"
          title="New indicator"
          aria-label="New indicator"
          onClick={onNew}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FilePlus2 className="size-3.5" />
        </button>
        <button
          type="button"
          title="Import .pine or library JSON"
          aria-label="Import"
          onClick={() => fileRef.current?.click()}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Upload className="size-3.5" />
        </button>
        <button
          type="button"
          title="Export library"
          aria-label="Export library"
          onClick={onExportAll}
          disabled={items.length === 0}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <Download className="size-3.5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pine,.json,application/json,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportFile(file);
            event.target.value = '';
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
            <Code2 className="size-6 opacity-40" />
            <p className="text-[12px]">
              {items.length === 0
                ? 'No saved indicators yet. Write a script in Pine and save it.'
                : 'No indicators match your search.'}
            </p>
            {items.length === 0 ? (
              <button
                type="button"
                onClick={onNew}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/35 bg-primary-soft px-2.5 py-1.5 text-[11px] text-foreground hover:bg-primary/20"
              >
                <FilePlus2 className="size-3.5" />
                New indicator
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {visible.map((item) => {
              const active = item.id === currentId;
              return (
                <li
                  key={item.id}
                  ref={(element) => {
                    if (element) itemRefs.current.set(item.id, element);
                    else itemRefs.current.delete(item.id);
                  }}
                  className={cn(
                    'group px-2 py-2 transition-colors',
                    active ? 'bg-primary-soft' : 'hover:bg-accent/50',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        className="block max-w-full truncate text-left text-[12px] font-semibold text-foreground hover:underline"
                        title={item.name}
                      >
                        {item.name}
                      </button>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{updatedLabel(item.updatedAt)}</span>
                        <span>·</span>
                        <span className="font-mono">v{item.version}</span>
                        <span>·</span>
                        <span>{item.source.split('\n').length} lines</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                      <button
                        type="button"
                        title="Edit"
                        aria-label={`Edit ${item.name}`}
                        onClick={() => onEdit(item)}
                        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Code2 className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Add to active chart"
                        aria-label={`Add ${item.name} to active chart`}
                        onClick={() => onAdd(item, false)}
                        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Layers className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Scan"
                        aria-label={`Scan ${item.name}`}
                        onClick={() => onScan(item)}
                        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Play className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  {item.notes ? (
                    <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                      {item.notes}
                    </p>
                  ) : null}
                  <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => onAdd(item, true)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Apply all
                    </button>
                    <button
                      type="button"
                      onClick={() => onRename(item)}
                      className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate(item)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Copy className="size-2.5" />
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => onExport(item)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <FolderOpen className="size-2.5" />
                      .pine
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item)}
                      className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-negative/10 hover:text-negative"
                    >
                      <Trash2 className="size-2.5" />
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
