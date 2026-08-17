import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccessCodeForm } from './AccessCodeForm';

// 9.10 RED — the frontend half of specs/client-booking/spec.md, Scenario
// "Código de acceso vencido":
//
//   THEN el sistema MUST rechazarlo
//   AND MUST exigir una nueva solicitud de acceso
//
// 9.9 made the backend able to say WHICH kind of failure happened. This is the
// component that has to act on it: on a dead challenge the only path forward
// offered is requesting a new code, and the code field must stop inviting a
// retry that cannot possibly succeed. On a live challenge with wrong digits,
// the opposite — retrying is the point.

describe('AccessCodeForm (9.10)', () => {
  it('deja reintentar cuando el codigo es incorrecto pero el challenge sigue vivo', () => {
    const onSubmit = vi.fn();
    render(<AccessCodeForm status={{ outcome: 'rejected' }} onSubmit={onSubmit} onRequestNewCode={vi.fn()} />);

    expect(screen.getByLabelText(/codigo/i)).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/codigo/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /ingresar/i }));

    expect(onSubmit).toHaveBeenCalledWith('123456');
  });

  it('ante un codigo vencido exige una nueva solicitud y no deja reintentar el mismo', () => {
    const onSubmit = vi.fn();
    const onRequestNewCode = vi.fn();
    render(
      <AccessCodeForm
        status={{ outcome: 'must-request-new-code', reason: 'expired' }}
        onSubmit={onSubmit}
        onRequestNewCode={onRequestNewCode}
      />,
    );

    // The retry path is gone: no submit button to press, and the field cannot
    // be used to insist on a challenge the server has already declared dead.
    expect(screen.queryByRole('button', { name: /ingresar/i })).toBeNull();
    expect(screen.getByLabelText(/codigo/i)).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /pedir un codigo nuevo/i }));

    expect(onRequestNewCode).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('explica que el codigo vencio, no que este equivocado', () => {
    render(
      <AccessCodeForm
        status={{ outcome: 'must-request-new-code', reason: 'expired' }}
        onSubmit={vi.fn()}
        onRequestNewCode={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/venc/i);
  });

  it('distingue el limite de intentos del vencimiento, aunque ambos pidan codigo nuevo', () => {
    render(
      <AccessCodeForm
        status={{ outcome: 'must-request-new-code', reason: 'exhausted' }}
        onSubmit={vi.fn()}
        onRequestNewCode={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/intentos/i);
    expect(screen.getByRole('button', { name: /pedir un codigo nuevo/i })).toBeEnabled();
  });

  it('no muestra ninguna alerta antes del primer intento', () => {
    render(<AccessCodeForm status={{ outcome: 'idle' }} onSubmit={vi.fn()} onRequestNewCode={vi.fn()} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /ingresar/i })).toBeEnabled();
  });

  it('nunca pide una contrasena — el acceso del cliente no tiene una', () => {
    const { container } = render(
      <AccessCodeForm status={{ outcome: 'idle' }} onSubmit={vi.fn()} onRequestNewCode={vi.fn()} />,
    );

    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
});
