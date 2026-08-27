import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
}

/**
 * The SPA's only global containment net: without it, any throw during a
 * render unmounts the whole tree and the visitor gets a silent blank page.
 * A class component on purpose — React only exposes error boundaries through
 * `getDerivedStateFromError`/`componentDidCatch`, there is no hook API.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[app] render crashed', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <section className="container app-error">
          <div className="card app-error__card" role="alert">
            <h2>Algo salió mal</h2>
            <p>Recargá la página para seguir usando el sitio.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Recargar
            </button>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
