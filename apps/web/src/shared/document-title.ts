/**
 * The browser tab's name, per route. `index.html` can only ever carry ONE
 * static `<title>`, and this SPA never replaced it — so every one of the
 * eleven sections read "Reservá tu turno", including the panel screens the
 * staff keep open side by side at the counter.
 *
 * Route keys mirror `App.tsx`'s own `switch` exactly; an unknown path falls
 * back to the brand title rather than to an empty tab.
 */
const BRAND_TITLE = 'JC Barbería — Reservá tu turno';

const SECTION_TITLES: Readonly<Record<string, string>> = {
  '/reservar': 'Reservar turno',
  '/acceder': 'Ingresar',
  '/mi-cuenta': 'Mi cuenta',
  '/pago/retorno': 'Estado del pago',
  '/personal/activar': 'Activar cuenta',
  '/panel': 'Agenda',
  '/panel/login': 'Acceso staff',
  '/panel/turno-telefonico': 'Turno telefónico',
  '/panel/gestion': 'Gestión',
  '/panel/facturacion': 'Mi facturación',
  '/panel/facturacion-local': 'Facturación del local',
};

export function documentTitleFor(pathname: string): string {
  const section = SECTION_TITLES[pathname];
  return section ? `${section} — JC Barbería` : BRAND_TITLE;
}
