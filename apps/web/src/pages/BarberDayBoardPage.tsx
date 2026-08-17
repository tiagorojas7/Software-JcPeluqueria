import { useState, type FormEvent } from 'react';
import type { DayBoardResponse } from '@jc-barberia/contracts';

import { BarberDayBoardContainer } from '../agenda/BarberDayBoardContainer';
import { apiGet, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';

export interface BarberDayBoardPageProps {
  readonly actor: Actor | null;
}

/** Barber-facing day board (barber-profile spec, "Agenda propia filtrada").
 *  Same honest "not wired" behavior as `AdminDayBoardPage` for slot actions —
 *  see that page's doc comment. */
export function BarberDayBoardPage({ actor }: BarberDayBoardPageProps) {
  const [date, setDate] = useState('');
  const [dayBoard, setDayBoard] = useState<DayBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleLoad(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const response = await apiGet<DayBoardResponse>(`/agenda/day-board?date=${encodeURIComponent(date)}`);
      setDayBoard(response);
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (!actor) {
    return (
      <section>
        <h2>Mi agenda (barbero)</h2>
        <p>Iniciá sesión como barbero para ver esta pantalla.</p>
      </section>
    );
  }

  if (!actor.barberId) {
    return (
      <section>
        <h2>Mi agenda (barbero)</h2>
        <p>Esta cuenta no tiene un barbero asociado (rol actual: {actor.role}).</p>
      </section>
    );
  }

  return (
    <section>
      <h2>Mi agenda (barbero)</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form onSubmit={handleLoad}>
        <label htmlFor="barber-day-board-date">Fecha</label>
        <input
          id="barber-day-board-date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="submit">Cargar mi agenda</button>
      </form>
      {dayBoard && (
        <BarberDayBoardContainer
          dayBoard={dayBoard}
          barberId={actor.barberId}
          onSlotAction={(_slotId, action) =>
            setNotice(`Acción "${action}" todavía no tiene endpoint conectado en esta demo.`)
          }
        />
      )}
    </section>
  );
}
