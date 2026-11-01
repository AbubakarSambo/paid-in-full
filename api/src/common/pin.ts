import { Role } from './decorators/roles.decorator';

// Disbursement PIN (spec §5.10.14): needed to pay, so in practice only payers/admins need one,
// but any member may set it. 4–8 digits.
export const PIN_ELIGIBLE_ROLES = [
  Role.VIEWER,
  Role.REQUESTER,
  Role.PROCUREMENT,
  Role.POSTER,
  Role.APPROVER,
  Role.PAYER,
  Role.ADMIN,
];

export const PIN_REGEX = /^\d{4,8}$/;
