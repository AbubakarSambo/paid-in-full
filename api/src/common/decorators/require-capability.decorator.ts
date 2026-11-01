import { SetMetadata } from '@nestjs/common';
import { Capability } from '../permissions';

export const CAPABILITIES_KEY = 'requiredCapabilities';

/**
 * Restricts a route (or whole controller) to members holding ANY of the listed capabilities in
 * the active workspace. Enforced by the global CapabilityGuard (registered in AppModule).
 * Method-level metadata overrides controller-level.
 *
 *   @RequireCapability(Capability.PAY)          // payer or admin (or super admin)
 *   @RequireCapability(Capability.INVOICE)      // biller add-on or admin
 */
export const RequireCapability = (...capabilities: Capability[]) => SetMetadata(CAPABILITIES_KEY, capabilities);
