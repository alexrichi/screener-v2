import { useState } from 'react';
import { Popover } from '@base-ui/react';
import { ChevronDown, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SettingsTemplate, SettingsTemplateStore } from '../lib/settingsTemplates';
import { Input } from '../ui/primitives';
import { cn } from '../ui/cn';

/** What a settings dialog adds: where its templates live and how to capture/apply them. */
export interface SettingsTemplateAdapter {
  store: SettingsTemplateStore;
  scope: string;
  capture: () => unknown;
  apply: (payload: unknown) => void;
  reset: () => void;
  /** Commit a dialog that keeps a working copy (indicator settings). */
  commit?: () => void;
  /** Close the dialog before applying, so stale working values cannot win. */
  close?: () => void;
}

export function SettingsTemplateMenu({ adapter }: { adapter: SettingsTemplateAdapter }) {
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [templates, setTemplates] = useState<SettingsTemplate[]>(() =>
    adapter.store.list(adapter.scope),
  );

  const refresh = () => setTemplates(adapter.store.list(adapter.scope));

  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) {
      refresh();
      setSaveOpen(false);
      setName('');
    }
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaveOpen(false);
    setName('');
    // A working-copy dialog commits on OK before the handle holds the values.
    adapter.commit?.();
    window.setTimeout(() => {
      try {
        const payload = adapter.capture();
        if (payload === undefined || payload === null) {
          toast.error('Nothing to save');
          return;
        }
        const next = adapter.store.save(adapter.scope, trimmed, payload);
        setTemplates(next);
        toast.success(`Saved template ${trimmed}`);
      } catch (cause) {
        toast.error('Could not save the template', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }, 0);
  };

  const apply = (template: SettingsTemplate) => {
    setOpen(false);
    adapter.close?.();
    window.setTimeout(() => {
      try {
        adapter.apply(template.payload);
      } catch (cause) {
        toast.error('Could not apply the template', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }, 0);
  };

  const applyDefaults = () => {
    adapter.reset();
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={toggle}>
      <Popover.Trigger
        type="button"
        className="vela-dialog-btn"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
          marginRight: 'auto',
          minWidth: 104,
        }}
        title="Settings template"
      >
        <span>Template</span>
        <ChevronDown className="size-3 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={6}
          className="z-[2000] outline-none"
        >
          <Popover.Popup className="w-64 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none">
            <button type="button" onClick={applyDefaults} className={menuItemClass}>
              <RotateCcw className="size-3.5 text-muted-foreground" />
              Apply defaults
            </button>
            <button type="button" onClick={() => setSaveOpen(true)} className={menuItemClass}>
              <Plus className="size-3.5 text-muted-foreground" />
              Save as…
            </button>

            {saveOpen ? (
              <form
                className="flex items-center gap-1 px-1 py-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <Input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Template name"
                  className="h-7 min-w-0 flex-1 text-[12px]"
                />
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSaveOpen(false);
                    setName('');
                  }}
                  className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                >
                  Cancel
                </button>
              </form>
            ) : null}

            <div className="my-1 h-px bg-border" />

            {templates.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                No saved templates yet
              </p>
            ) : (
              templates.map((template) => (
                <div
                  key={template.id}
                  className="group flex items-center gap-1 rounded hover:bg-accent/60"
                >
                  <button
                    type="button"
                    onClick={() => apply(template)}
                    className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[12px] text-foreground/85"
                    title={template.name}
                  >
                    {template.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete template ${template.name}`}
                    title="Delete template"
                    onClick={() =>
                      setTemplates(adapter.store.remove(adapter.scope, template.id))
                    }
                    className="mr-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const menuItemClass = cn(
  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-foreground/85 hover:bg-accent/60',
);
