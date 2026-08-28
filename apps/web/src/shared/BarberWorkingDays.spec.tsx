import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGet } from './api-client';
import { BarberWorkingDays } from './BarberWorkingDays';

vi.mock('./api-client', () => ({
  apiGet: vi.fn(),
  describeError: (err: unknown) => (err instanceof Error ? err.message : 'error desconocido'),
}));

// Nahuel atiende lunes, miercoles, viernes y sabado.
const WEEK = {
  days: [
    { dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' },
    { dayOfWeek: 3, opensAt: '09:00', closesAt: '17:00' },
    { dayOfWeek: 5, opensAt: '09:00', closesAt: '17:00' },
    { dayOfWeek: 6, opensAt: '09:00', closesAt: '17:00' },
  ],
};

// El calendario de turno telefonico/walk-in ofrecia los siete dias como si
// todos fueran validos: quien atiende el telefono tenia que acordarse de
// memoria que dias trabaja cada barbero, y si erraba el formulario devolvia
// "no hay horarios" — indistinguible de "ese dia esta lleno".
describe('BarberWorkingDays', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockResolvedValue(WEEK);
  });

  it('dice que dias atiende el barbero elegido', async () => {
    render(<BarberWorkingDays barberId="b-nahuel" calendarDate="" />);

    expect(await screen.findByText(/lunes.*mi.rcoles.*viernes.*s.bado/i)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/panel/barbers/b-nahuel/schedule');
  });

  it('avisa cuando la fecha elegida cae en un dia que no atiende', async () => {
    render(<BarberWorkingDays barberId="b-nahuel" calendarDate="2026-09-01" />); // martes

    expect(await screen.findByRole('alert')).toHaveTextContent(/no atiende los martes/i);
  });

  it('no avisa nada cuando la fecha elegida es un dia que si atiende', async () => {
    render(<BarberWorkingDays barberId="b-nahuel" calendarDate="2026-08-31" />); // lunes

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('avisa cuando el barbero no tiene ningun dia cargado', async () => {
    vi.mocked(apiGet).mockResolvedValue({ days: [] });

    render(<BarberWorkingDays barberId="b-sin-horario" calendarDate="" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no tiene d.as de trabajo/i);
  });

  it('no rompe el formulario si no puede leer el horario', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('sin conexion'));

    const { container } = render(<BarberWorkingDays barberId="b-nahuel" calendarDate="2026-09-01" />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    // Sin horario conocido no puede afirmar que el barbero NO atiende: se
    // calla en vez de bloquear con una advertencia que quizas sea falsa.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('no pide nada sin barbero elegido', async () => {
    render(<BarberWorkingDays barberId="" calendarDate="" />);

    await waitFor(() => expect(apiGet).not.toHaveBeenCalled());
  });
});
