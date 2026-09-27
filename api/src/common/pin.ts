import { Role } from './decorators/roles.decorator';

// Any workspace member can set up a quick-unlock PIN (see PinSetupModal / user_security) — unlike
// Tari's shared-terminal use case this isn't role-restricted, since Paid in Full has no
// shared-device roles, only remote desktop/mobile access.
export const PIN_ELIGIBLE_ROLES = [Role.SUPER_ADMIN, Role.ADMIN, Role.APPROVER, Role.POSTER];

export const PIN_REGEX = /^\d{4}$/;
