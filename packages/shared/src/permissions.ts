import { z } from "zod";

export const ROLES = ["admin", "manager", "operator", "viewer", "driver"] as const;
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
  "documents:read",
  "documents:write",
  "automations:read",
  "automations:write",
  "trade:read",
  "trade:write",
  "integrations:read",
  "integrations:write",
  "billing:read",
  "billing:write",
  "reports:read",
  "driver:app",
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
  "documents:read",
  "trade:read",
  "billing:read",
  "reports:read",
];

// "driver:app" é exclusivo da função motorista (não faz parte das restantes)
const ALL: Permission[] = PERMISSIONS.filter((p) => p !== "driver:app");

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
    "documents:write",
    "automations:read",
    "automations:write",
    "trade:write",
    "integrations:read",
    "integrations:write",
    "billing:write",
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
    "documents:write",
    "trade:write",
  ],
  viewer: ["tenant:read", "users:read", "stats:read"],
  driver: ["driver:app"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
