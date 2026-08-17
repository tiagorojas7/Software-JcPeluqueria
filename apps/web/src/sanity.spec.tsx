import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// Purpose: prove the NEW risk surface this phase adds — Vite + React + jsdom
// + Testing Library, all wired together for the first time in this monorepo
// — actually renders JSX and reads it back from the DOM, before DayBoard is
// built on top of it. Mirrors packages/domain's own sanity.spec.ts (Phase 0,
// task 0.4/0.5): a deliberately wrong assertion first, to prove the runner
// truly executes and can fail, not just "module resolves".
describe('sanity: React + jsdom + Testing Library wiring', () => {
  it('renders JSX and reads it back from the DOM', () => {
    render(<p>hola mundo</p>);

    expect(screen.getByText('hola mundo')).toBeInTheDocument();
  });
});
