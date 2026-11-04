import { useEffect, useState } from 'react';
import { Button, Input } from '../ui/primitives';
import { Modal } from '../ui/overlays';

export interface LayoutNameRequest {
  mode: 'save' | 'saveAs' | 'rename' | 'duplicate';
  /** Present for rename and duplicate. */
  id?: string;
  name: string;
}

export function LayoutNameDialog({
  request,
  error,
  onClose,
  onSubmit,
}: {
  request: LayoutNameRequest | null;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (request) setName(request.name);
  }, [request]);

  const title =
    request?.mode === 'rename'
      ? 'Rename layout'
      : request?.mode === 'saveAs'
        ? 'Save layout as'
        : request?.mode === 'duplicate'
          ? 'Duplicate layout'
          : 'Save current layout';
  const submit = () => {
    if (name.trim()) onSubmit(name);
  };

  return (
    <Modal
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            {request?.mode === 'rename'
              ? 'Rename'
              : request?.mode === 'duplicate'
                ? 'Duplicate'
                : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-2">
        <label className="text-[11px] font-medium text-muted-foreground" htmlFor="layout-name">
          Name
        </label>
        <Input
          id="layout-name"
          autoFocus
          value={name}
          maxLength={60}
          placeholder="BTC 2×2"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />
        {error ? <p className="text-[11px] text-negative">{error}</p> : null}
        <p className="text-[11px] leading-4 text-muted-foreground">
          {request?.mode === 'duplicate'
            ? 'Copies the saved grid, symbols, indicators, drawings and chart settings. The original stays unchanged.'
            : 'Saves the grid, symbols, indicators, drawings and chart settings, plus the applied Pine script.'}
        </p>
      </div>
    </Modal>
  );
}
