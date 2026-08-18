import { useState, type FormEvent } from 'react';
import type { DayBoardResponse, SlotAction } from '@jc-barberia/contracts';

import { BarberDayBoardContainer } from '../agenda/BarberDayBoardContainer';
import { apiGet, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';

export interface BarberDayBoardPageProps {
  readonly actor: Actor | null;
}

const ACTION_NAMES: Record<SlotAction, string> = {
  edit: 'Editar',
  cancel: 'Cancelar',
  'mark-completed': 'Marcar realizado',
};

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
      <section className="panel-page">
        <h2>Mi agenda</h2>
        <p className="empty-state">Iniciá sesión como barbero para ver esta pantalla.</p>
      </section>
    );
  }

  if (!actor.barberId) {
    return (
      <section className="panel-page">
        <h2>Mi agenda</h2>
        <p className="empty-state">Esta cuenta no tiene un barbero asociado.</p>
      </section>
    );
  }

  return (
    <section className="panel-page">
      <h2>Mi agenda</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form className="card panel-page__form" onSubmit={handleLoad}>
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
      {dayBoard ? (
        <BarberDayBoardContainer
          dayBoard={dayBoard}
          barberId={actor.barberId}
          onSlotAction={(_slotId, action) =>
            setNotice(`"${ACTION_NAMES[action]}" todavía no está disponible desde el panel.`)
          }
        />
      ) : (
        <p className="empty-state">Elegí una fecha para ver tu agenda.</p>
      )}
    </section>
  );
}
