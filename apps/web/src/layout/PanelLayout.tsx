import type { ReactNode } from 'react';

import type { Actor } from '../shared/actor';
import { Link, useRouter } from '../shared/router';
import { visiblePanelNavItems } from './nav-items';
import './PanelLayout.css';

export interface PanelLayoutProps {
  readonly actor: Actor;
  readonly onLogout: () => void;
  readonly children: ReactNode;
}

const ROLE_LABELS: Record<Actor['role'], string> = {
  owner: 'Dueño',
  secretary: 'Secretaria',
  barber: 'Barbero',
};

/**
 * D.3: the panel's shell — header, session info, logout, and the nav built
 * exclusively from `visiblePanelNavItems(actor.role)`. Adds nothing of its
 * own on top of that filter: every item it renders is one this actor's
 * permissions already cleared, so there is no second, redundant role check
 * to drift out of sync with `nav-items.ts`.
 */
export function PanelLayout({ actor, onLogout, children }: PanelLayoutProps) {
  const { pathname } = useRouter();
  const items = visiblePanelNavItems(actor.role);

  return (
    <div className="panel-layout">
      <header className="panel-layout__header">
        <span className="panel-layout__brand">JC Barbería — Panel</span>
        <div className="panel-layout__session">
          <span className="panel-layout__role">{ROLE_LABELS[actor.role]}</span>
          <button type="button" onClick={onLogout}>
            Salir
          </button>
        </div>
      </header>
      <div className="panel-layout__body">
        <nav className="panel-layout__nav" aria-label="Navegación del panel">
          <ul>
            {items.map((item) => (
              <li key={item.path}>
                <Link to={item.path} aria-current={pathname === item.path ? 'page' : undefined}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="panel-layout__content">{children}</main>
      </div>
    </div>
  );
}
