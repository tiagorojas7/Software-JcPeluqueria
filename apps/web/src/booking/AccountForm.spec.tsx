import type { ConfirmReservationRequest } from '@jc-barberia/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccountForm } from './AccountForm';

// client-booking spec, "Cuenta sin contraseña creada al final del flujo"
// (tasks 9.5/9.6):
//
//   Scenario "Intento de confirmar sin los datos obligatorios": GIVEN a
//   client at the confirmation step WHEN name, phone or email is missing
//   THEN the system MUST reject the confirmation AND MUST NOT create the
//   appointment nor charge the deposit.
//
// This form is the client-side half of that guarantee — nombre/telefono/
// email are `required` (the browser blocks submission the same way
// `PhoneAppointmentForm` already proves for its own required fields), and
// the shape it emits on submit is exactly `ConfirmReservationRequest`
// (`packages/contracts`), the SAME schema the server enforces again
// (task 9.7/9.8's controller — client-side validation is convenience, never
// the actual guarantee). Crucially: no password field exists anywhere in
// this form — its absence is structural, not merely unfilled.
describe('AccountForm', () => {
  it('requires name, phone and email — the three fields the requirement names', () => {
    render(<AccountForm holdId="hold-1" onSubmit={() => {}} />);

    expect(screen.getByLabelText('Nombre')).toBeRequired();
    expect(screen.getByLabelText('Teléfono')).toBeRequired();
    expect(screen.getByLabelText('Email')).toBeRequired();
  });

  it('never renders any password field — the absence is the guarantee, not an omission to notice', () => {
    render(<AccountForm holdId="hold-1" onSubmit={() => {}} />);

    expect(screen.queryByLabelText(/contraseñ/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('submits exactly the ConfirmReservationRequest shape, with age omitted as null', () => {
    const onSubmit = vi.fn();
    render(<AccountForm holdId="hold-1" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Marcos' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '3511234567' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'marcos@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));

    const expected: ConfirmReservationRequest = {
      holdId: 'hold-1',
      client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: null },
    };
    expect(onSubmit).toHaveBeenCalledWith(expected);
  });

  it('includes age when the visitor loads it', () => {
    const onSubmit = vi.fn();
    render(<AccountForm holdId="hold-1" onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Marcos' } });
    fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '3511234567' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'marcos@example.com' } });
    fireEvent.change(screen.getByLabelText('Edad (opcional)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ client: expect.objectContaining({ age: 30 }) }),
    );
  });

  // panel-usable: "a client who already has an account fills in name, email
  // and phone again on every booking" — a resolved session profile opens a
  // confirm step instead of a blank form.
  describe('cliente que vuelve, con sesion resuelta (initialProfile)', () => {
    const profile = { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 };

    it('muestra los datos guardados y confirma en un solo clic, sin pedir que los retipeen', () => {
      const onSubmit = vi.fn();
      render(<AccountForm holdId="hold-1" onSubmit={onSubmit} initialProfile={profile} />);

      expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
      expect(screen.getByText(/nombre: marcos/i)).toBeInTheDocument();
      expect(screen.getByText(/3511234567/)).toBeInTheDocument();
      expect(screen.getByText(/marcos@example\.com/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Confirmar y continuar' }));

      const expected: ConfirmReservationRequest = {
        holdId: 'hold-1',
        client: { name: 'Marcos', phone: '3511234567', email: 'marcos@example.com', age: 30 },
      };
      expect(onSubmit).toHaveBeenCalledWith(expected);
    });

    it('"Editar mis datos" cae al formulario editable, pre-llenado en vez de en blanco', () => {
      const onSubmit = vi.fn();
      render(<AccountForm holdId="hold-1" onSubmit={onSubmit} initialProfile={profile} />);

      fireEvent.click(screen.getByRole('button', { name: 'Editar mis datos' }));

      expect(screen.getByLabelText('Nombre')).toHaveValue('Marcos');
      expect(screen.getByLabelText('Teléfono')).toHaveValue('3511234567');
      expect(screen.getByLabelText('Email')).toHaveValue('marcos@example.com');
      expect(screen.getByLabelText('Edad (opcional)')).toHaveValue(30);

      fireEvent.change(screen.getByLabelText('Teléfono'), { target: { value: '3519999999' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }));

      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ client: expect.objectContaining({ phone: '3519999999' }) }),
      );
    });

    it('sin sesion (initialProfile null/undefined) sigue mostrando el formulario en blanco de siempre', () => {
      render(<AccountForm holdId="hold-1" onSubmit={() => {}} initialProfile={null} />);

      expect(screen.getByLabelText('Nombre')).toHaveValue('');
      expect(screen.queryByRole('button', { name: 'Confirmar y continuar' })).not.toBeInTheDocument();
    });
  });
});
