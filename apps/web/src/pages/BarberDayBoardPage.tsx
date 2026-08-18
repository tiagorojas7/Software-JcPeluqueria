import { useState, type FormEvent } from 'react';
import type { DayBoardResponse } from '@jc-barberia/contracts';

import { BarberDayBoardPanel } from '../agenda/BarberDayBoardPanel';
import { apiGet, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';
import './DayBoardPage.css';

export interface BarberDayBoardPageProps {
  readonly actor: Actor | null;
}

/** Barber-facing day board (barber-profile spec, "Agenda propia filtrada").
 *  `mark-completed`/`confirm-absence` on the barber's own turnos are wired
 *  end to end (cablear-el-mvp, B.2/B.6) — see `AdminDayBoardPage`'s doc
 *  comment for the same split between "this page fetches" and "the panel
 *  acts". */
export function BarberDayBoardPage({ actor }: BarberDayBoardPageProps) {
  const [date, setDate] = useState('');
  const [dayBoard, setDayBoard] = useState<DayBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section className="panel-page">
      <h2>Mi agenda</h2>
      {error && <p role="alert">{error}</p>}
      <form className="card panel-page__form" onSubmit={handleLoad}>
        <label htmlFor="barber-day-board-date">Fecha</label>
        <input
          id="barber-day-board-date"
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="submit">Cargar agenda</button>
      </form>
      {dayBoard ? (
        <div className="day-board">
          <BarberDayBoardPanel dayBoard={dayBoard} barberId={actor.barberId} />
        </div>
      ) : (
        <p className="empty-state">Elegí una fecha para ver tu agenda.</p>
      )}
    </section>
  );
}
