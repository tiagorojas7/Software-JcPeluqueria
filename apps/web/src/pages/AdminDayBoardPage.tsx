import { useState, type FormEvent } from 'react';
import type { DayBoardResponse, SlotAction } from '@jc-barberia/contracts';

import { AdminDayBoardContainer } from '../agenda/AdminDayBoardContainer';
import { apiGet, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';

export interface AdminDayBoardPageProps {
  readonly actor: Actor | null;
}

const ACTION_NAMES: Record<SlotAction, string> = {
  edit: 'Editar',
  cancel: 'Cancelar',
  'mark-completed': 'Marcar realizado',
};

/**
 * Admin-facing day board (design.md: "AdminDayBoardContainer (todas las
 * columnas)"). `edit`/`cancel`/`mark-completed` slot actions have real,
 * tested application-layer use cases (`EditAppointmentUseCase`,
 * `AdminCancelAppointmentUseCase`, `AdminMarkCompletedUseCase`) but NONE of
 * them has an HTTP controller yet (Slice B, not this slice's scope) — this
 * page says so honestly, in plain language, instead of silently doing
 * nothing when a button is clicked.
 */
export function AdminDayBoardPage({ actor }: AdminDayBoardPageProps) {
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
        <h2>Agenda del día</h2>
        <p className="empty-state">Iniciá sesión como dueño o secretaria para ver esta pantalla.</p>
      </section>
    );
  }

  return (
    <section className="panel-page">
      <h2>Agenda del día</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <form className="card panel-page__form" onSubmit={handleLoad}>
        <label htmlFor="admin-day-board-date">Fecha</label>
        <input
          id="admin-day-board-date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="submit">Cargar agenda</button>
      </form>
      {dayBoard ? (
        <AdminDayBoardContainer
          dayBoard={dayBoard}
          onSlotAction={(_slotId, action) =>
            setNotice(`"${ACTION_NAMES[action]}" todavía no está disponible desde el panel.`)
          }
        />
      ) : (
        <p className="empty-state">Elegí una fecha para ver la agenda del día.</p>
      )}
    </section>
  );
}
