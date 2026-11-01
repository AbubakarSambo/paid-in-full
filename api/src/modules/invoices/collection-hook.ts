/**
 * Plain (non-DI) hook between the Monnify webhook (MonnifyService.processWebhook, owned by the
 * wallet/batches work) and the invoicing + client-mandate rails. Using a registry instead of
 * injecting services into MonnifyService avoids a Monnify <-> Invoices module cycle.
 *
 * Handlers register themselves on module init. MonnifyService calls
 * `runMonnifyCollectionHooks(event)` once per webhook; if any handler claims the event
 * (returns true), the wallet handling is skipped for that event.
 *
 * Claimed events:
 *  - collections into a per-invoice reserved account (InvoiceCollectionsService)
 *  - disbursement results for invoice sweeps (reference `SWP-…`)
 *  - client-mandate card verifications (`MNDV-…`) and charges (`SUBC-…`) (CustomerSubscriptionsService)
 */
export interface MonnifyHookEvent {
  eventType: string;
  /** Monnify `eventData` object, as received. */
  data: Record<string, any>;
}

export type MonnifyHookHandler = (event: MonnifyHookEvent) => Promise<boolean>;

const handlers = new Map<string, MonnifyHookHandler>();

export function registerMonnifyCollectionHook(name: string, handler: MonnifyHookHandler) {
  handlers.set(name, handler);
}

/** Returns true when an invoicing/mandate handler claimed the event. Never throws. */
export async function runMonnifyCollectionHooks(event: MonnifyHookEvent): Promise<boolean> {
  for (const [name, handler] of handlers) {
    try {
      if (await handler(event)) return true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[monnify-hook:${name}] failed`, err);
    }
  }
  return false;
}
