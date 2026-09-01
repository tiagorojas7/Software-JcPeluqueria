import { useEffect, useState } from 'react';
import type {
  CreateWalkInRequest,
  DayBoardResponse,
  EditAppointmentRequest,
  SlotAction,
} from '@jc-barberia/contracts';

import { AdminDayBoardContainer } from './AdminDayBoardContainer';
import { EditAppointmentForm } from './EditAppointmentForm';
import { slotToEditValues } from './slot-to-edit-values';
import { WalkInForm } from './WalkInForm';
import { apiGet, apiPost, apiPut, describeError } from '../shared/api-client';
import { useReferenceData } from '../shared/use-reference-data';

export interface AdminDayBoardPanelProps {
  readonly dayBoard: DayBoardResponse;
}

const ACTION_PATH: Partial<Record<SlotAction, string>> = {
  cancel: 'cancel',
  'mark-completed': 'mark-completed',
  'confirm-absence': 'confirm-absence',
  'undo-walk-in': 'undo-walk-in',
};

/**
 * B.6's actual wiring: `AdminDayBoardContainer` only ever forwarded a slot
 * action upward (Phase 8, unchanged — still the exact seam its own spec
 * covers). This panel is what turns that report into the real HTTP calls
 * B.1-B.5 opened, then reloads the whole board from the server — never
 * patches `allowedActions` locally, because the server is the only thing
 * allowed to compute it (design.md, "Frontend").
 *
 * `edit` is the one action that does not fire immediately: it opens
 * `EditAppointmentForm` pre-filled from the clicked slot instead.
 * `walkin:create` (B.5) has no slot of its own to click, so its toggle lives
 * here directly rather than inside `DayBoard`.
 *
 * panel-usable: `EditAppointmentForm`/`WalkInForm` need real barbero/servicio
 * names to fill their `<select>`s (no more raw-UUID text inputs), so this
 * panel fetches `GET /barbers`/`GET /services` on mount — same `apiGet` and
 * same active-only/no-filter shape `PhoneAppointmentPage` already uses for
 * the same reference data.
 */
export function AdminDayBoardPanel({ dayBoard: dayBoardProp }: AdminDayBoardPanelProps) {
  const [dayBoard, setDayBoard] = useState(dayBoardProp);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { barbers, services, error: referenceDataError } = useReferenceData();

  // Keeps this panel in sync when the page above fetches a different date
  // into the SAME mounted instance — internal reloads never touch the
  // parent's own state, so this never fights this panel's own `reload()`.
  useEffect(() => {
    setDayBoard(dayBoardProp);
  }, [dayBoardProp]);

  async function reload() {
    const fresh = await apiGet<DayBoardResponse>(`/agenda/day-board?date=${encodeURIComponent(dayBoard.date)}`);
    setDayBoard(fresh);
  }

  async function handleSlotAction(slotId: string, action: SlotAction) {
    setError(null);
    if (action === 'edit') {
      setEditingSlotId(slotId);
      return;
    }
    const segment = ACTION_PATH[action];
    if (!segment) {
      return;
    }
    try {
      await apiPost(`/appointments/${slotId}/${segment}`);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleEditSubmit(input: EditAppointmentRequest) {
    if (!editingSlotId) {
      return;
    }
    try {
      await apiPut(`/appointments/${editingSlotId}`, input);
      setEditingSlotId(null);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleWalkInSubmit(input: CreateWalkInRequest) {
    try {
      await apiPost('/appointments/walk-in', input);
      setWalkInOpen(false);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  const editingSlot = dayBoard.slots.find((slot) => slot.id === editingSlotId);
  const referenceDataReady = barbers !== null && services !== null && !referenceDataError;

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      {referenceDataError && <p role="alert">{referenceDataError}</p>}
      <AdminDayBoardContainer dayBoard={dayBoard} onSlotAction={handleSlotAction} />
      {editingSlot &&
        (referenceDataReady ? (
          <EditAppointmentForm
            barbers={barbers}
            services={services}
            initialValues={slotToEditValues(editingSlot)}
            onSubmit={handleEditSubmit}
            onCancel={() => setEditingSlotId(null)}
          />
        ) : (
          <p className="empty-state">Cargando barberos y servicios...</p>
        ))}
      <button type="button" onClick={() => setWalkInOpen((open) => !open)}>
        {walkInOpen ? 'Cerrar walk-in' : 'Nuevo walk-in'}
      </button>
      {walkInOpen &&
        (referenceDataReady ? (
          <WalkInForm barbers={barbers} services={services} onSubmit={handleWalkInSubmit} />
        ) : (
          <p className="empty-state">Cargando barberos y servicios...</p>
        ))}
    </div>
  );
}
