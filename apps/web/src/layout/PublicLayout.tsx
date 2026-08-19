import type { ReactNode } from 'react';

import { Link, useRouter } from '../shared/router';
import './PublicLayout.css';

export interface PublicLayoutProps {
  readonly children: ReactNode;
}

const PUBLIC_NAV_ITEMS = [
  { path: '/', label: 'Inicio' },
  { path: '/reservar', label: 'Reservar turno' },
  { path: '/acceder', label: 'Ingresar' },
  { path: '/mi-cuenta', label: 'Mi cuenta' },
] as const;

/**
 * D.2/D.4: the public site's shell. A visitor never sees anything about the
 * panel from here — no link, no mention of the word anywhere in this
 * component's own copy (`PublicLayout.spec.tsx` asserts exactly that). Kept
 * completely separate from `PanelLayout`: different nav source (a small
 * fixed list here, vs. `visiblePanelNavItems` there), different visual
 * register, nothing shared besides the design tokens in `styles/tokens.css`.
 */
export function PublicLayout({ children }: PublicLayoutProps) {
  const { pathname } = useRouter();

  return (
    <div className="public-layout">
      <header className="public-layout__header">
        <Link to="/" className="public-layout__brand">
          JC Barbería
        </Link>
        <nav className="public-layout__nav" aria-label="Navegación">
          <ul>
            {PUBLIC_NAV_ITEMS.map((item) => (
              <li key={item.path}>
                <Link to={item.path} aria-current={pathname === item.path ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="public-layout__content">{children}</main>
      <footer className="public-layout__footer">
        <div className="public-layout__footer-inner">
          <div>
            <strong>JC Barbería</strong>
            <p>Córdoba Capital, Argentina.</p>
          </div>
          <div>
            <strong>Horario</strong>
            <p>Lunes a sábado, 09:00 a 20:00. Domingo cerrado.</p>
          </div>
          <div>
            <strong>Turnos</strong>
            <p>Se reservan online con una seña del 50%.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
