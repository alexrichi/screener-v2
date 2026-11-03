import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, ExternalLink, LineChart, Plus, Search } from 'lucide-react';
import type { IndicatorRow } from '../types';
import {
  LIBRARY_ITEMS,
  familyLabel,
  filterLibrary,
  libraryImageUrl,
  libraryPageUrl,
  type LibraryItem,
} from '../lib/luxalgoLibrary';
import { Badge, Button, Input, Segmented, Spinner } from '../ui/primitives';
import { Modal } from '../ui/overlays';
import { cn } from '../ui/cn';

type Tab = 'chart' | 'luxalgo';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: IndicatorRow[];
  onAdd: (index: number) => void;
  onAddSaved: (id: string) => void;
  onAddLibrary: (item: LibraryItem) => Promise<void>;
}

function byName(a: IndicatorRow, b: IndicatorRow): number {
  return a.name.localeCompare(b.name);
}

export function IndicatorWindow({
  open,
  onOpenChange,
  rows,
  onAdd,
  onAddSaved,
  onAddLibrary,
}: Props) {
  const [tab, setTab] = useState<Tab>('chart');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Record<string, true>>({});
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('chart');
    setQuery('');
    setLimit(24);
    setErrors({});
    setAdded({});
    setBusy(null);
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setQuery('');
    setLimit(24);
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const chartRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        (row.category ?? '').toLowerCase().includes(needle) ||
        (row.language ?? '').toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const scripts = useMemo(
    () => chartRows.filter((row) => !row.native).sort(byName),
    [chartRows],
  );
  const builtins = useMemo(
    () => chartRows.filter((row) => row.native).sort(byName),
    [chartRows],
  );

  const libraryMatches = useMemo(() => filterLibrary(LIBRARY_ITEMS, query), [query]);
  const libraryList = libraryMatches.slice(0, limit);
  const presentNames = useMemo(
    () => new Set(rows.filter((row) => row.present && !row.native).map((row) => row.name)),
    [rows],
  );

  const addLibrary = async (item: LibraryItem) => {
    setBusy(item.codeId);
    setErrors((prev) => {
      if (!(item.codeId in prev)) return prev;
      const next = { ...prev };
      delete next[item.codeId];
      return next;
    });
    try {
      await onAddLibrary(item);
      setAdded((prev) => ({ ...prev, [item.codeId]: true }));
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        [item.codeId]: error instanceof Error ? error.message : 'Could not load the script',
      }));
    } finally {
      setBusy(null);
    }
  };

  const chartRow = (item: IndicatorRow) => (
    <button
      key={`${item.native ? 'native' : 'script'}:${item.name}:${item.index}`}
      type="button"
      title={`Add ${item.name} to the active chart`}
      onClick={() => (item.savedId ? onAddSaved(item.savedId) : onAdd(item.index))}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left',
        'border border-transparent transition-colors hover:border-border hover:bg-accent/50',
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded border border-border bg-muted/40 text-muted-foreground">
        {item.native ? <LineChart className="size-3.5" /> : <Code2 className="size-3.5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-foreground">{item.name}</span>
          {item.beta ? <Badge>Beta</Badge> : null}
          {item.present ? <Badge tone="positive">On chart</Badge> : null}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {item.native ? 'Built-in' : item.category ?? item.language ?? 'Script'}
        </span>
      </span>
      <Plus className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );

  const libraryCard = (item: LibraryItem) => {
    const present = added[item.codeId] === true || presentNames.has(item.name);
    const loading = busy === item.codeId;
    const error = errors[item.codeId];
    const image = libraryImageUrl(item.imageUrl);
    return (
      <div key={item.codeId} className="group relative">
        <button
          type="button"
          disabled={present || loading}
          onClick={() => void addLibrary(item)}
          title={
            present
              ? `${item.name} is already on the chart`
              : `Add ${item.name} to the active chart`
          }
          className={cn(
            'block w-full overflow-hidden rounded-md border border-border/60 bg-muted/15 text-left transition-colors',
            'hover:border-border hover:bg-accent/40 disabled:cursor-default',
            'disabled:hover:border-border/60 disabled:hover:bg-muted/15',
          )}
        >
          <span className="relative block aspect-video w-full overflow-hidden bg-muted/40">
            {image ? (
              <img
                src={image}
                alt=""
                decoding="async"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              />
            ) : null}
            {loading ? (
              <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                <Spinner className="size-4" />
              </span>
            ) : null}
          </span>
          <span className="block px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-1">
              <span className="line-clamp-2 min-h-[26px] text-[11px] font-medium leading-[13px] text-foreground">
                {item.name}
              </span>
              {present ? (
                <Badge tone="positive" className="shrink-0">
                  On chart
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
              {familyLabel(item.family)} · {item.date}
            </span>
            {error ? (
              <span className="mt-0.5 block text-[9px] leading-tight text-negative">{error}</span>
            ) : null}
          </span>
        </button>
        <a
          href={libraryPageUrl(item.slug)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${item.name} in the LuxAlgo Library`}
          className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-md border border-border/60 bg-background/85 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          <ExternalLink className="size-3" />
        </a>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Indicators"
      description="Add an indicator to the active chart"
      className="w-[min(92vw,560px)]"
    >
      <div className="grid gap-3">
        <Segmented<Tab>
          value={tab}
          onChange={switchTab}
          options={[
            { value: 'chart', label: 'Chart' },
            { value: 'luxalgo', label: 'LuxAlgo' },
          ]}
          className="justify-self-start"
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(24);
            }}
            placeholder={
              tab === 'chart' ? 'Search indicators…' : 'Search the LuxAlgo Library…'
            }
            className="pl-7"
          />
        </div>

        {tab === 'chart' ? (
          chartRows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-4 py-8 text-center text-muted-foreground">
              <Search className="size-5 opacity-40" />
              <p className="text-[12px]">
                {rows.length === 0
                  ? 'No indicators available for this chart yet.'
                  : 'No indicators match your search.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {scripts.length > 0 ? (
                <section className="grid gap-1">
                  <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    My scripts
                  </h3>
                  {scripts.map(chartRow)}
                </section>
              ) : null}
              {builtins.length > 0 ? (
                <section className="grid gap-1">
                  <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Built-in
                  </h3>
                  {builtins.map(chartRow)}
                </section>
              ) : null}
              {scripts.length === 0 && builtins.length > 0 && !query ? (
                <p className="px-1 text-[10px] text-muted-foreground">
                  Save a script in the Pine panel to add it here.
                </p>
              ) : null}
            </div>
          )
        ) : libraryMatches.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center text-muted-foreground">
            <Search className="size-5 opacity-40" />
            <p className="text-[12px]">No Library indicators match your search.</p>
          </div>
        ) : (
          <div className="grid gap-2">
            <p className="px-1 text-[10px] text-muted-foreground">
              {query
                ? `${libraryMatches.length} matches`
                : `${libraryMatches.length} indicators · newest first`}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {libraryList.map(libraryCard)}
            </div>
            {libraryMatches.length > libraryList.length ? (
              <Button
                variant="ghost"
                className="justify-self-center"
                onClick={() => setLimit((value) => value + 24)}
              >
                Show more
              </Button>
            ) : null}
            <p className="px-1 text-[10px] text-muted-foreground">
              Scripts keep their original licence and author credit.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
