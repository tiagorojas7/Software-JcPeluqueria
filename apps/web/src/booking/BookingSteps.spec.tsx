import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BookingSteps, BOOKING_STEPS } from './BookingSteps';

// Reservar es un flujo de cuatro tramos que ocurren en la MISMA pantalla:
// buscar, elegir horario, dejar los datos y pagar. Sin un indicador, quien
// reserva no sabe cuánto le falta ni por qué la pantalla cambió sola — el
// caso clásico de abandono a mitad de camino.
describe('BookingSteps', () => {
  it('nombra los cuatro tramos del flujo', () => {
    render(<BookingSteps current="horario" />);

    for (const step of BOOKING_STEPS) {
      expect(screen.getByText(step.label)).toBeInTheDocument();
    }
  });

  it('marca en qué tramo está, para lectores de pantalla también', () => {
    render(<BookingSteps current="datos" />);

    expect(screen.getByText('Tus datos').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  // Un tramo ya recorrido y uno que todavía no llegó no son lo mismo, y la
  // diferencia no puede quedar sólo en el color.
  it('distingue lo ya hecho de lo que falta', () => {
    render(<BookingSteps current="datos" />);

    expect(screen.getByText('Horario').closest('li')).toHaveAttribute('data-state', 'done');
    expect(screen.getByText('Confirmar y pagar').closest('li')).toHaveAttribute('data-state', 'todo');
    expect(screen.getByText('Tus datos').closest('li')).toHaveAttribute('data-state', 'current');
  });

  it('se anuncia como el progreso del flujo, no como una navegación', () => {
    render(<BookingSteps current="buscar" />);

    expect(screen.getByRole('list', { name: /progreso/i })).toBeInTheDocument();
  });
});
