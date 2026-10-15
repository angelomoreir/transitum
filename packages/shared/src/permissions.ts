import { z } from "zod";

export const ROLES = ["admin", "manager", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

export const PERMISSIONS = [
  "tenant:read",
  "tenant:update",
  "users:read",
  "users:invite",
  "users:update",
  "users:suspend",
  "audit:read",
  "notifications:read",
  "stats:read",
  "search",
  "partners:read",
  "partners:write",
  "orders:read",
  "orders:write",
  "shipments:read",
  "shipments:write",
  "shipments:status",
  "routes:read",
  "routes:write",
  "routes:status",
  "rates:read",
  "rates:write",
  "costs:read",
  "costs:write",
  "warehouses:read",
  "warehouses:write",
  "inventory:read",
  "inventory:write",
  "purchases:read",
  "purchases:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = [
  "tenant:read",
  "users:read",
  "notifications:read",
  "stats:read",
  "search",
  "partners:read",
  "orders:read",
  "shipments:read",
  "routes:read",
  "rates:read",
  "costs:read",
  "warehouses:read",
  "inventory:read",
  "purchases:read",
];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ALL,
  manager: [
    ...READ,
    "users:invite",
    "users:update",
    "users:suspend",
    "audit:read",
    "partners:write",
    "orders:write",
    "shipments:write",
    "shipments:status",
    "routes:write",
    "routes:status",
    "rates:write",
    "costs:write",
    "warehouses:write",
    "inventory:write",
    "purchases:write",
  ],
  operator: [
    ...READ,
    "orders:write",
    "shipments:write",
    "shipments:status",
    "routes:write",
    "routes:status",
    "costs:write",
    "inventory:write",
    "purchases:write",
  ],
  viewer: ["tenant:read", "users:read", "stats:read"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
