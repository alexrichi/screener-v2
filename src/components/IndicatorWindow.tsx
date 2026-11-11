import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Dialog } from '@base-ui/react';
import { toast } from 'sonner';
import {
  Code2,
  Compass,
  ExternalLink,
  History,
  Layers,
  LineChart,
  Plus,
  Search,
  Shuffle,
  Star,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { IndicatorRow } from '../types';
import {
  LIBRARY_ITEMS,
  familyLabel,
  libraryImageUrl,
  libraryPageUrl,
  type LibraryItem,
} from '../lib/luxalgoLibrary';
import {
  buildPickerEntries,
  builtinFamilies,
  filterEntries,
  libraryFamilies,
  markRecent,
  toggleFavorite,
  type PickerEntry,
  type PickerPrefs,
} from '../lib/indicatorPicker';
import { Badge, Button, Input, Spinner } from '../ui/primitives';
import { cn } from '../ui/cn';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: IndicatorRow[];
  onAdd: (index: number) => void;
  onAddSaved: (id: string) => void;
  onAddLibrary: (item: LibraryItem) => Promise<void>;
  onImportFile: (file: File) => Promise<void>;
  onOpenSource: (id: string) => void;
  onDelete: (id: string) => void;
  prefs: PickerPrefs;
  onPrefsChange: Dispatch<SetStateAction<PickerPrefs>>;
}

type Section =
  | { type: 'discover' }
  | { type: 'favorites' }
  | { type: 'recent' }
  | { type: 'my-scripts' }
  | { type: 'builtin' }
  | { type: 'builtin-family'; family: string }
  | { type: 'library' }
  | { type: 'library-family'; family: string };

const PAGE_SIZE = 24;
const SEARCH_OTHER_LIMIT = 60;

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function dateLabel(value: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-1 pt-2.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
      {children}
    </div>
  );
}

function NavItem({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon?: LucideIcon;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors',
        active
          ? 'bg-primary-soft text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {Icon ? (
        <Icon className="size-3.5 shrink-0" />
      ) : (
        <span className="ml-0.5 size-1.5 shrink-0 rounded-full bg-current opacity-40" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? (
        <span className="shrink-0 font-mono text-[9px] tabular-nums opacity-60">{count}</span>
      ) : null}
    </button>
  );
}

function StarButton({
  favorite,
  label,
  onToggle,
  className,
}: {
  favorite: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={favorite ? `Remove ${label} from favorites` : `Favorite ${label}`}
      aria-pressed={favorite}
      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <Star className={cn('size-3.5', favorite && 'fill-current text-primary')} />
    </button>
  );
}

function LibraryCard({
  entry,
  present,
  selected,
  favorite,
  busy,
  onSelect,
  onFavorite,
  onAdd,
}: {
  entry: PickerEntry;
  present: boolean;
  selected: boolean;
  favorite: boolean;
  busy: boolean;
  onSelect: () => void;
  onFavorite: () => void;
  onAdd: () => void;
}) {
  const item = entry.item;
  if (!item) return null;
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-card/40 transition-colors',
        selected ? 'border-primary' : 'border-border/70 hover:border-border',
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <span className="relative block aspect-video w-full overflow-hidden bg-muted/40">
          {item.imageUrl ? (
            <img
              src={libraryImageUrl(item.imageUrl, 384)}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-muted-foreground/40">
              <LineChart className="size-6" />
            </span>
          )}
          {busy ? (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Spinner className="size-4" />
            </span>
          ) : null}
          {present ? (
            <span className="absolute bottom-1 left-1 rounded border border-primary/30 bg-primary-soft px-1 text-[9px] font-medium text-primary">
              On chart
            </span>
          ) : null}
        </span>
        <span className="block px-2 py-1.5">
          <span className="line-clamp-2 min-h-[26px] text-[11px] font-medium leading-[13px] text-foreground">
            {entry.name}
          </span>
          <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">
            {entry.family} · {dateLabel(item.date)}
          </span>
        </span>
      </button>
      <StarButton
        favorite={favorite}
        label={entry.name}
        onToggle={onFavorite}
        className="absolute right-1 top-1 border border-border/60 bg-background/85 backdrop-blur"
      />
      <button
        type="button"
        aria-label={`Add ${entry.name} to the active chart`}
        title={present ? `${entry.name} is already on the chart` : `Add ${entry.name}`}
        disabled={present || busy}
        onClick={(event) => {
          event.stopPropagation();
          onAdd();
        }}
        className="absolute bottom-1 right-1 inline-flex size-6 items-center justify-center rounded-md border border-border/60 bg-background/85 text-muted-foreground backdrop-blur hover:text-foreground disabled:opacity-40 lg:hidden"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function EntryRow({
  entry,
  present,
  selected,
  favorite,
  onSelect,
  onFavorite,
  onAdd,
  onSource,
  onDelete,
}: {
  entry: PickerEntry;
  present: boolean;
  selected: boolean;
  favorite: boolean;
  onSelect: () => void;
  onFavorite: () => void;
  onAdd: () => void;
  onSource?: () => void;
  onDelete?: () => void;
}) {
  const locked = present && entry.kind !== 'native';
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md border px-1 py-1 transition-colors',
        selected ? 'border-primary bg-primary-soft/40' : 'border-transparent hover:bg-accent/40',
      )}
    >
      <StarButton favorite={favorite} label={entry.name} onToggle={onFavorite} />
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center text-left">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-foreground">{entry.name}</span>
            {entry.beta ? <Badge>Beta</Badge> : null}
            {present ? <Badge tone="positive">On chart</Badge> : null}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">{entry.family}</span>
        </span>
      </button>
      {onSource || onDelete ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-1',
            selected ? 'visible' : 'invisible group-hover:visible group-focus-within:visible',
          )}
        >
          {onSource ? (
            <button
              type="button"
              aria-label={`Open source code for ${entry.name}`}
              title="Source code"
              onClick={(event) => {
                event.stopPropagation();
                onSource();
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Code2 className="size-3.5" />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              aria-label={`Delete script ${entry.name}`}
              title="Delete script"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-negative"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        aria-label={
          locked ? `${entry.name} is already on the chart` : `Add ${entry.name} to the active chart`
        }
        title={locked ? `${entry.name} is already on the chart` : `Add ${entry.name}`}
        disabled={locked}
        onClick={onAdd}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function DetailsPane({
  entry,
  present,
  favorite,
  busy,
  error,
  onFavorite,
  onAdd,
}: {
  entry: PickerEntry | null;
  present: boolean;
  favorite: boolean;
  busy: boolean;
  error?: string;
  onFavorite: () => void;
  onAdd: () => void;
}) {
  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-muted-foreground">
        Select an indicator to see its details.
      </div>
    );
  }
  const item = entry.item;
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {item ? (
        <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
          {item.imageUrl ? (
            <img
              src={libraryImageUrl(item.imageUrl, 384)}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
              className="aspect-video w-full object-cover"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-muted-foreground/40">
              <LineChart className="size-7" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-28 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground/40">
          {entry.kind === 'native' ? (
            <LineChart className="size-7" />
          ) : (
            <Code2 className="size-7" />
          )}
        </div>
      )}
      <div>
        <h3 className="text-[13px] font-semibold leading-4 text-foreground">{entry.name}</h3>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {entry.family}
          {item ? ` · ${dateLabel(item.date)}` : ''}
        </p>
      </div>
      {item ? (
        <p className="whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">
          {item.description}
        </p>
      ) : (
        <p className="text-[11px] leading-4 text-muted-foreground">
          {entry.kind === 'native'
            ? 'Built-in indicator computed by the chart engine.'
            : 'Script saved in your indicator library.'}
        </p>
      )}
      {item ? (
        <a
          href={libraryPageUrl(item.slug)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          View in the Library
          <ExternalLink className="size-3" />
        </a>
      ) : null}
      {error ? <p className="text-[10px] leading-4 text-negative">{error}</p> : null}
      <div className="mt-auto flex flex-col gap-1.5">
        <Button
          variant="primary"
          onClick={onAdd}
          disabled={busy || (present && entry.kind !== 'native')}
        >
          {busy ? <Spinner className="size-3.5" /> : null}
          {present && entry.kind !== 'native' ? 'On chart' : 'Add to chart'}
        </Button>
        <Button variant="secondary" onClick={onFavorite}>
          <Star className={cn('size-3.5', favorite && 'fill-current text-primary')} />
          {favorite ? 'Favorited' : 'Favorite'}
        </Button>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted/40 px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground">
      {children}
    </kbd>
  );
}

function CenterHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-[12px] font-semibold text-foreground">{title}</h3>
      {meta ? <span className="text-[10px] text-muted-foreground">{meta}</span> : null}
      {actions ? <div className="ml-auto flex items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export function IndicatorWindow({
  open,
  onOpenChange,
  rows,
  onAdd,
  onAddSaved,
  onAddLibrary,
  onImportFile,
  onOpenSource,
  onDelete,
  prefs,
  onPrefsChange,
}: Props) {
  const [section, setSection] = useState<Section>({ type: 'my-scripts' });
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [shuffleTick, setShuffleTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Record<string, true>>({});
  const searchRef = useRef<HTMLInputElement | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const entries = useMemo(() => buildPickerEntries(rows, LIBRARY_ITEMS), [rows]);
  const libraryEntries = useMemo(
    () => entries.filter((entry) => entry.kind === 'library'),
    [entries],
  );
  const nativeEntries = useMemo(
    () => entries.filter((entry) => entry.kind === 'native'),
    [entries],
  );
  const savedEntries = useMemo(
    () => entries.filter((entry) => entry.kind === 'saved'),
    [entries],
  );
  const favoriteSet = useMemo(() => new Set(prefs.favorites), [prefs.favorites]);
  const favoriteEntries = useMemo(
    () => entries.filter((entry) => favoriteSet.has(entry.key)),
    [entries, favoriteSet],
  );
  const recentEntries = useMemo(
    () =>
      prefs.recent
        .map((key) => entries.find((entry) => entry.key === key))
        .filter((entry): entry is PickerEntry => Boolean(entry)),
    [entries, prefs.recent],
  );
  const families = useMemo(() => libraryFamilies(LIBRARY_ITEMS), []);
  const builtin = useMemo(() => builtinFamilies(rows), [rows]);
  const searching = query.trim().length > 0;
  const searchMatches = useMemo(
    () => (searching ? filterEntries(entries, query) : []),
    [entries, query, searching],
  );
  const newest = useMemo(() => LIBRARY_ITEMS.slice(0, 3), []);
  const newestCodes = useMemo(() => new Set(newest.map((item) => item.codeId)), [newest]);
  const newestEntries = useMemo(
    () =>
      newest
        .map((item) => libraryEntries.find((entry) => entry.item?.codeId === item.codeId))
        .filter((entry): entry is PickerEntry => Boolean(entry)),
    [libraryEntries, newest],
  );
  const explore = useMemo(
    () => shuffle(libraryEntries.filter((entry) => !newestCodes.has(entry.item!.codeId))),
    [libraryEntries, newestCodes, shuffleTick],
  );

  useEffect(() => {
    if (!open) return;
    setSection({ type: 'my-scripts' });
    setQuery('');
    setLimit(PAGE_SIZE);
    setSelectedKey(null);
    setShuffleTick(0);
    setBusy(null);
    setErrors({});
    setAdded({});
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const presentOf = (entry: PickerEntry): boolean =>
    entry.present || Boolean(entry.item && added[entry.item.codeId]);

  const searchLibrary = searching
    ? searchMatches.filter((entry) => entry.kind === 'library').slice(0, limit)
    : [];
  const searchOther = searching
    ? searchMatches.filter((entry) => entry.kind !== 'library').slice(0, SEARCH_OTHER_LIMIT)
    : [];

  const favoritesLibrary = favoriteEntries
    .filter((entry) => entry.kind === 'library')
    .slice(0, limit);
  const favoritesOther = favoriteEntries
    .filter((entry) => entry.kind !== 'library')
    .slice(0, SEARCH_OTHER_LIMIT);
  const recentLibrary = recentEntries
    .filter((entry) => entry.kind === 'library')
    .slice(0, limit);
  const recentOther = recentEntries
    .filter((entry) => entry.kind !== 'library')
    .slice(0, SEARCH_OTHER_LIMIT);

  const activeEntries = (() => {
    if (section.type === 'discover') return [...newestEntries, ...explore.slice(0, limit)];
    if (section.type === 'favorites') return [...favoritesLibrary, ...favoritesOther];
    if (section.type === 'recent') return [...recentLibrary, ...recentOther];
    if (section.type === 'my-scripts') return savedEntries;
    if (section.type === 'builtin') return nativeEntries;
    if (section.type === 'builtin-family') {
      return nativeEntries.filter((entry) => entry.family === section.family);
    }
    if (section.type === 'library') return libraryEntries.slice(0, limit);
    return libraryEntries.filter((entry) => entry.item?.family === section.family).slice(0, limit);
  })();

  const visible = searching ? [...searchOther, ...searchLibrary] : activeEntries;
  const selected = visible.find((entry) => entry.key === selectedKey) ?? visible[0] ?? null;
  const selectedFavorite = selected ? favoriteSet.has(selected.key) : false;
  const sectionTotal = searching
    ? searchMatches.length
    : section.type === 'discover'
      ? LIBRARY_ITEMS.length
      : section.type === 'favorites'
        ? favoriteEntries.length
        : section.type === 'recent'
          ? recentEntries.length
          : section.type === 'my-scripts'
            ? savedEntries.length
            : section.type === 'builtin'
              ? nativeEntries.length
              : section.type === 'builtin-family'
                ? nativeEntries.filter((entry) => entry.family === section.family).length
                : section.type === 'library'
                  ? libraryEntries.length
                  : libraryEntries.filter((entry) => entry.item?.family === section.family).length;

  const selectSection = (next: Section) => {
    setSection(next);
    setQuery('');
    setLimit(PAGE_SIZE);
    setSelectedKey(null);
  };

  const toggleFav = (entry: PickerEntry) => {
    onPrefsChange((prev) => toggleFavorite(prev, entry.key));
  };

  const addEntry = async (entry: PickerEntry | null, keepOpen: boolean) => {
    if (!entry) return;
    if (entry.kind === 'native') {
      if (entry.index === undefined) return;
      onAdd(entry.index);
    } else if (entry.kind === 'saved') {
      if (!entry.savedId || presentOf(entry)) return;
      onAddSaved(entry.savedId);
    } else {
      const item = entry.item;
      if (!item || presentOf(entry) || busy) return;
      setBusy(item.codeId);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[item.codeId];
        return next;
      });
      try {
        await onAddLibrary(item);
        setAdded((prev) => ({ ...prev, [item.codeId]: true }));
      } catch (cause) {
        setErrors((prev) => ({
          ...prev,
          [item.codeId]: cause instanceof Error ? cause.message : 'Could not load the script',
        }));
        return;
      } finally {
        setBusy(null);
      }
    }
    onPrefsChange((prev) => markRecent(prev, entry.key));
    setSelectedKey(entry.key);
    if (!keepOpen) onOpenChange(false);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (visible.length === 0) return;
      event.preventDefault();
      const current = Math.max(
        0,
        visible.findIndex((entry) => entry.key === selected?.key),
      );
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = Math.min(visible.length - 1, Math.max(0, current + delta));
      const entry = visible[next];
      if (entry) setSelectedKey(entry.key);
      searchRef.current?.focus();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (target.closest('button, a')) return;
      event.preventDefault();
      void addEntry(selected, event.metaKey || event.ctrlKey);
      return;
    }
    if ((event.key === 'f' || event.key === 'F') && !typing) {
      event.preventDefault();
      if (selected) toggleFav(selected);
      return;
    }
    if (event.key === 'Escape') {
      onOpenChange(false);
    }
  };

  const importScript = async (file: File) => {
    try {
      await onImportFile(file);
      onOpenChange(false);
    } catch {
      /* the app reports the import error */
    }
  };

  const pickScript = async () => {
    const api = typeof window === 'undefined' ? undefined : window.screenerWindow;
    if (!api?.pickScript) {
      importRef.current?.click();
      return;
    }
    const result = await api.pickScript();
    if (!result) return;
    if ('error' in result) {
      toast.error('Could not open the script', { description: result.error });
      return;
    }
    await importScript(new File([result.text], result.name, { type: 'text/plain' }));
  };

  const libraryGrid = (items: PickerEntry[]) => (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
      {items.map((entry) => (
        <LibraryCard
          key={entry.key}
          entry={entry}
          present={presentOf(entry)}
          selected={selected?.key === entry.key}
          favorite={favoriteSet.has(entry.key)}
          busy={Boolean(entry.item && busy === entry.item.codeId)}
          onSelect={() => setSelectedKey(entry.key)}
          onFavorite={() => toggleFav(entry)}
          onAdd={() => void addEntry(entry, false)}
        />
      ))}
    </div>
  );

  const entryRows = (items: PickerEntry[]) => (
    <div className="grid gap-0.5">
      {items.map((entry) => {
        const savedId = entry.kind === 'saved' ? entry.savedId : undefined;
        return (
          <EntryRow
            key={entry.key}
            entry={entry}
            present={presentOf(entry)}
            selected={selected?.key === entry.key}
            favorite={favoriteSet.has(entry.key)}
            onSelect={() => setSelectedKey(entry.key)}
            onFavorite={() => toggleFav(entry)}
            onAdd={() => void addEntry(entry, false)}
            onSource={savedId ? () => onOpenSource(savedId) : undefined}
            onDelete={savedId ? () => onDelete(savedId) : undefined}
          />
        );
      })}
    </div>
  );

  const empty = (title: string, hint: string, action?: ReactNode) => (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-muted-foreground">
      <Search className="size-5 opacity-40" />
      <p className="text-[12px] text-foreground/80">{title}</p>
      <p className="max-w-72 text-[11px] leading-4">{hint}</p>
      {action}
    </div>
  );

  const showMore = (count: number) =>
    count > limit ? (
      <div className="mt-2 flex justify-center">
        <Button variant="ghost" size="sm" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
          Show more
        </Button>
      </div>
    ) : null;

  const renderDiscover = () => (
    <>
      <CenterHeader
        title="New releases"
        meta={`${LIBRARY_ITEMS.length} scripts`}
        actions={
          <button
            type="button"
            onClick={() => selectSection({ type: 'library' })}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            See all
          </button>
        }
      />
      <div className="mb-4">{libraryGrid(newestEntries)}</div>
      <CenterHeader
        title="More to explore"
        actions={
          <button
            type="button"
            onClick={() => setShuffleTick((value) => value + 1)}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Shuffle className="size-3" />
            Shuffle
          </button>
        }
      />
      {libraryGrid(explore.slice(0, limit))}
      {showMore(explore.length)}
    </>
  );

  const renderFavorites = () => {
    if (favoriteEntries.length === 0) {
      return empty(
        'No favorites yet',
        'Star a built-in, a saved script or a Library indicator and it stays here.',
        <Button variant="secondary" size="sm" onClick={() => selectSection({ type: 'discover' })}>
          Browse the Library
        </Button>,
      );
    }
    return (
      <>
        {favoritesLibrary.length > 0 ? libraryGrid(favoritesLibrary) : null}
        {favoritesOther.length > 0 ? (
          <div className={favoritesLibrary.length > 0 ? 'mt-2' : ''}>{entryRows(favoritesOther)}</div>
        ) : null}
        {showMore(favoriteEntries.filter((entry) => entry.kind === 'library').length)}
      </>
    );
  };

  const renderRecent = () => {
    if (recentEntries.length === 0) {
      return empty('Nothing added yet', 'Indicators you add to the chart appear here.');
    }
    return (
      <>
        {recentLibrary.length > 0 ? libraryGrid(recentLibrary) : null}
        {recentOther.length > 0 ? (
          <div className={recentLibrary.length > 0 ? 'mt-2' : ''}>{entryRows(recentOther)}</div>
        ) : null}
      </>
    );
  };

  const renderSection = () => {
    if (searching) {
      return (
        <>
          <CenterHeader title="Search results" meta={`${searchMatches.length} matches`} />
          {searchMatches.length === 0
            ? empty('No matches', `Nothing matches “${query.trim()}”.`)
            : (
                <>
                  {searchOther.length > 0 ? entryRows(searchOther) : null}
                  {searchLibrary.length > 0 ? (
                    <div className={searchOther.length > 0 ? 'mt-2' : ''}>
                      {libraryGrid(searchLibrary)}
                    </div>
                  ) : null}
                  {showMore(searchMatches.filter((entry) => entry.kind === 'library').length)}
                </>
              )}
        </>
      );
    }
    if (section.type === 'discover') return renderDiscover();
    if (section.type === 'favorites') return renderFavorites();
    if (section.type === 'recent') return renderRecent();
    if (section.type === 'my-scripts') {
      return savedEntries.length === 0
        ? empty(
            'No saved scripts',
            'Save a script in the Pine panel, or bring one in as a .pine file.',
            <Button variant="secondary" size="sm" onClick={() => void pickScript()}>
              <Upload className="size-3" />
              Bring a script
            </Button>,
          )
        : entryRows(savedEntries);
    }
    if (section.type === 'builtin' || section.type === 'builtin-family') {
      const items =
        section.type === 'builtin'
          ? nativeEntries
          : nativeEntries.filter((entry) => entry.family === section.family);
      return items.length === 0
        ? empty('No built-in indicators', 'This chart has no built-in indicators to add.')
        : entryRows(items);
    }
    const items =
      section.type === 'library'
        ? libraryEntries.slice(0, limit)
        : libraryEntries
            .filter((entry) => entry.item?.family === section.family)
            .slice(0, limit);
    const total =
      section.type === 'library'
        ? libraryEntries.length
        : libraryEntries.filter((entry) => entry.item?.family === section.family).length;
    return (
      <>
        <CenterHeader
          title={section.type === 'library' ? 'All scripts' : familyLabel(section.family)}
          meta={`${total} scripts`}
        />
        {libraryGrid(items)}
        {showMore(total)}
      </>
    );
  };

  const activeSection = (type: Section['type']) => section.type === type;
  const activeBuiltinFamily = (family: string) =>
    section.type === 'builtin-family' && section.family === family;
  const activeLibraryFamily = (family: string) =>
    section.type === 'library-family' && section.family === family;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]" />
        <Dialog.Popup
          onKeyDown={onKeyDown}
          className="fixed left-1/2 top-1/2 z-50 flex h-[min(88vh,780px)] w-[min(96vw,1100px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl outline-none"
        >
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
            <Dialog.Title className="shrink-0 text-[13px] font-semibold text-foreground">
              Indicators
            </Dialog.Title>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLimit(PAGE_SIZE);
                  setSelectedKey(null);
                }}
                placeholder="Search indicators, families, descriptions…"
                className="h-8 pl-8 pr-8"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    setSelectedKey(null);
                    searchRef.current?.focus();
                  }}
                  className="absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1.5 md:hidden">
            {[
              { label: 'Discover', next: { type: 'discover' } as Section },
              { label: 'Favorites', next: { type: 'favorites' } as Section },
              { label: 'My scripts', next: { type: 'my-scripts' } as Section },
              { label: 'Built-in', next: { type: 'builtin' } as Section },
              { label: 'Library', next: { type: 'library' } as Section },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => selectSection(item.next)}
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
                  section.type === item.next.type
                    ? 'border-primary/40 bg-primary-soft text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1">
            <nav className="hidden w-[184px] shrink-0 overflow-y-auto border-r border-border px-2 py-1.5 md:block">
              <SectionLabel>Yours</SectionLabel>
              <NavItem
                icon={Star}
                label="Favorites"
                count={favoriteEntries.length}
                active={activeSection('favorites')}
                onClick={() => selectSection({ type: 'favorites' })}
              />
              <NavItem
                icon={History}
                label="Recent"
                count={recentEntries.length}
                active={activeSection('recent')}
                onClick={() => selectSection({ type: 'recent' })}
              />
              <NavItem
                icon={Code2}
                label="My scripts"
                count={savedEntries.length}
                active={activeSection('my-scripts')}
                onClick={() => selectSection({ type: 'my-scripts' })}
              />
              <button
                type="button"
                onClick={() => void pickScript()}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Upload className="size-3.5 shrink-0" />
                <span className="truncate">Bring a script</span>
              </button>

              <SectionLabel>Built-in</SectionLabel>
              <NavItem
                icon={LineChart}
                label="All"
                count={nativeEntries.length}
                active={activeSection('builtin')}
                onClick={() => selectSection({ type: 'builtin' })}
              />
              {builtin.length > 1
                ? builtin.map((family) => (
                    <NavItem
                      key={family.id}
                      label={family.label}
                      count={family.count}
                      active={activeBuiltinFamily(family.id)}
                      onClick={() => selectSection({ type: 'builtin-family', family: family.id })}
                    />
                  ))
                : null}

              <SectionLabel>Library</SectionLabel>
              <NavItem
                icon={Compass}
                label="Discover"
                active={activeSection('discover')}
                onClick={() => selectSection({ type: 'discover' })}
              />
              <NavItem
                icon={Layers}
                label="All scripts"
                count={libraryEntries.length}
                active={activeSection('library')}
                onClick={() => selectSection({ type: 'library' })}
              />
              {families.map((family) => (
                <NavItem
                  key={family.id}
                  label={family.label}
                  count={family.count}
                  active={activeLibraryFamily(family.id)}
                  onClick={() => selectSection({ type: 'library-family', family: family.id })}
                />
              ))}
            </nav>

            <main className="min-w-0 flex-1 overflow-y-auto px-3 py-2">{renderSection()}</main>

            <aside className="hidden w-[300px] shrink-0 border-l border-border lg:block">
              <DetailsPane
                entry={selected}
                present={selected ? presentOf(selected) : false}
                favorite={selectedFavorite}
                busy={Boolean(selected?.item && busy === selected.item.codeId)}
                error={selected?.item ? errors[selected.item.codeId] : undefined}
                onFavorite={() => {
                  if (selected) toggleFav(selected);
                }}
                onAdd={() => void addEntry(selected, false)}
              />
            </aside>
          </div>

          <div className="flex h-9 shrink-0 items-center gap-2 border-t border-border px-3 text-[10px] text-muted-foreground">
            <div className="hidden items-center gap-2 md:flex">
              <Kbd>↑↓</Kbd>
              <span>Browse</span>
              <Kbd>↵</Kbd>
              <span>Add</span>
              <Kbd>Ctrl/⌘↵</Kbd>
              <span>Keep open</span>
              <Kbd>F</Kbd>
              <span>Favorite</span>
              <Kbd>Esc</Kbd>
              <span>Close</span>
            </div>
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              {selected ? (
                <>
                  <span className="truncate text-foreground/80">{selected.name}</span>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => void addEntry(selected, false)}
                    disabled={
                      Boolean(selected.item && busy === selected.item.codeId) ||
                      (presentOf(selected) && selected.kind !== 'native')
                    }
                  >
                    {presentOf(selected) && selected.kind !== 'native' ? 'On chart' : 'Add'}
                  </Button>
                </>
              ) : null}
            </div>
            <span className="ml-auto shrink-0 font-mono text-[9px]">
              {searching ? `${searchMatches.length} results` : `${sectionTotal} items`}
              {LIBRARY_ITEMS[0]?.date ? ` · newest ${dateLabel(LIBRARY_ITEMS[0].date)}` : ''}
            </span>
          </div>

          <input
            ref={importRef}
            type="file"
            accept=".pine,.txt,text/plain,*/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importScript(file);
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
