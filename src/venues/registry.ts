import type { VenueAdapter, VenueId } from './types';

/**
 * The shared adapter registry. Browser and sidecar use the same lookup; only the
 * sidecar ever receives venue SDKs or credentials.
 */
export class VenueRegistry {
  private readonly adapters = new Map<VenueId, VenueAdapter>();

  register(adapter: VenueAdapter): () => void {
    this.adapters.set(adapter.id, adapter);
    return () => {
      if (this.adapters.get(adapter.id) === adapter) this.adapters.delete(adapter.id);
    };
  }

  get(id: VenueId): VenueAdapter | undefined {
    return this.adapters.get(id);
  }

  require(id: VenueId): VenueAdapter {
    const adapter = this.get(id);
    if (!adapter) throw new Error(`Unknown venue adapter "${id}"`);
    return adapter;
  }

  list(): VenueAdapter[] {
    return [...this.adapters.values()];
  }
}
