import { useState, type FormEvent } from 'react';
import type { DayBoardResponse } from '@jc-barberia/contracts';

import { AdminDayBoardPanel } from '../agenda/AdminDayBoardPanel';
import { apiGet, describeError } from '../shared/api-client';
import type { Actor } from '../shared/actor';
import './DayBoardPage.css';

export interface AdminDayBoardPageProps {
  readonly actor: Actor | null;
}

/**
 * Admin-facing day board (design.md: "AdminDayBoardContainer (todas las
 * columnas)"). `edit`/`cancel`/`mark-completed`/`confirm-absence` and walk-ins
 * are wired end to end (cablear-el-mvp, B.1-B.6): this page only fetches the
 * board for the chosen date, and `AdminDayBoardPanel` owns every action from
 * there — its own HTTP calls, its own reload-from-server after writing, its
 * own error reporting.
 */
export function AdminDayBoardPage({ actor }: AdminDayBoardPageProps) {
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
        <h2>Agenda del día</h2>
        <p className="empty-state">Iniciá sesión como dueño o secretaria para ver esta pantalla.</p>
      </section>
    );
  }

  return (
    <section className="panel-page">
      <h2>Agenda del día</h2>
      {error && <p role="alert">{error}</p>}
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
        <div className="day-board">
          <AdminDayBoardPanel dayBoard={dayBoard} />
        </div>
      ) : (
        <p className="empty-state">Elegí una fecha para ver la agenda del día.</p>
      )}
    </section>
  );
}
