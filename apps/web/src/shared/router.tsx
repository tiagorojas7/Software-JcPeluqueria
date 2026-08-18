import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

/**
 * Minimal hand-rolled router (D.1): real, bookmarkable paths (`/`, `/panel`,
 * `/panel/turnos`, ...) via the History API — this SPA had no router
 * library before Slice D (`App.tsx`'s prior nav was flat hash routing, see
 * git history), and D.1/D.2/D.3's whole point is splitting one flat screen
 * into two real areas, not adopting a dependency. Deliberately tiny: one
 * context exposing the current `pathname` and a `navigate` function, plus a
 * `Link` that intercepts a plain left-click into `navigate` so internal
 * links never trigger a full reload, while still being real `<a href>`
 * elements (open-in-new-tab, right-click "copy link", `Ctrl`/`Cmd`+click all
 * keep working, exactly like a native link).
 */
export interface RouterContextValue {
  readonly pathname: string;
  navigate(path: string): void;
}

const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({ children }: { readonly children: ReactNode }) {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    function onPopState() {
      setPathname(window.location.pathname);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((path: string) => {
    if (path !== window.location.pathname) {
      window.history.pushState({}, '', path);
    }
    setPathname(path);
  }, []);

  return <RouterContext.Provider value={{ pathname, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
}

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  readonly to: string;
  readonly children: ReactNode;
}

/** A real `<a>` that navigates client-side on an ordinary left-click, and
 *  falls back to normal browser behavior for anything else (modifier keys,
 *  middle click, an `onClick` that already called `preventDefault`). */
export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(to);
  }

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
}
