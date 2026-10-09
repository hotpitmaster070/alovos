import type { Invitation, Supplier } from "./model";

/** API shapes (snake_case like the database). */

export const serializeSupplier = (supplier: Supplier) => ({
  id: supplier.id,
  name: supplier.name,
  code: supplier.code,
  contact: supplier.contact,
  delivery_days: supplier.deliveryDays,
  branch_id: supplier.branchId,
  lead_time_days: supplier.leadTimeDays,
  is_active: supplier.active,
});

export const invitePath = (token: string) => `/invite/${encodeURIComponent(token)}`;

export const serializeInvitation = (invitation: Invitation, origin: string) => ({
  id: invitation.id,
  phone: invitation.phone,
  role: invitation.role,
  token: invitation.token,
  url: new URL(invitePath(invitation.token), origin).toString(),
  expires_at: invitation.expiresAt,
  used_at: invitation.usedAt,
});
