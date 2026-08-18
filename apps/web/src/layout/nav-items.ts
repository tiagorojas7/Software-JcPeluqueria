import { hasAnyPermission, type Permission, type Role } from '../shared/permissions';

/**
 * D.3: the panel's navigation, as DATA — one entry per screen, each
 * declaring the same permission(s) its backend route requires (mirrors
 * `@RequiresPermission(...)`'s ANY-of-several semantics). `visiblePanelNavItems`
 * is the ONLY thing that decides visibility, and it is a single generic
 * filter, never a per-item `if (role === ...)` — the exact "hardcoded role
 * switch" tasks.md's D.3 says not to build. Adding a screen later means
 * adding one entry here, never touching the filtering logic.
 */
export interface PanelNavItem {
  readonly path: string;
  readonly label: string;
  readonly anyOf: readonly Permission[];
}

export const PANEL_NAV_ITEMS: readonly PanelNavItem[] = [
  { path: '/panel', label: 'Agenda del día', anyOf: ['agenda:read:any', 'agenda:read:own'] },
  { path: '/panel/turno-telefonico', label: 'Turno telefónico', anyOf: ['appointment:create'] },
  {
    path: '/panel/gestion',
    label: 'Gestión',
    anyOf: ['client:manage', 'barber:manage', 'schedule:configure', 'pricing:configure'],
  },
  { path: '/panel/facturacion', label: 'Mi facturación', anyOf: ['finance:read:own'] },
  { path: '/panel/facturacion-local', label: 'Facturación del local', anyOf: ['finance:read:shop'] },
];

export function visiblePanelNavItems(role: Role): readonly PanelNavItem[] {
  return PANEL_NAV_ITEMS.filter((item) => hasAnyPermission(role, item.anyOf));
}
