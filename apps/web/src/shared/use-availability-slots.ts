import { useEffect, useState } from 'react';
import type { AvailabilityResponse, AvailabilitySlot } from '@jc-barberia/contracts';

import { apiGet, describeError } from './api-client';

export interface UseAvailabilitySlotsResult {
  readonly slots: readonly AvailabilitySlot[];
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * panel-usable: the shared `GET /availability` lookup every panel form that
 * books a real horario needs — `PhoneAppointmentForm`, `EditAppointmentForm`
 * and `WalkInForm` all have to offer only the start times that are actually
 * free for the barbero/servicio/fecha already chosen, the same lookup
 * `BookingPage` already performs for the public flow
 * (`GetPublicAvailabilityUseCase`). One shared hook instead of three copies
 * of the same fetch-on-change effect.
 *
 * Refetches whenever `barberId`/`serviceId`/`calendarDate` change; resolves
 * to an empty list (never throws) until all three are set, so a form can
 * render its own "elegí barbero, servicio y fecha" hint instead of showing
 * `AvailabilityPicker`'s "no hay horarios" message prematurely — the same
 * bug D.5 already fixed once for the public booking page.
 */
export function useAvailabilitySlots(
  barberId: string,
  serviceId: string,
  calendarDate: string,
): UseAvailabilitySlotsResult {
  const [slots, setSlots] = useState<readonly AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!barberId || !serviceId || !calendarDate) {
      setSlots([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    async function load() {
      try {
        const params = new URLSearchParams({ barberId, serviceId, date: calendarDate });
        const response = await apiGet<AvailabilityResponse>(`/availability?${params.toString()}`);
        if (!cancelled) {
          setSlots(response.slots);
        }
      } catch (err) {
        if (!cancelled) {
          setError(describeError(err));
          setSlots([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [barberId, serviceId, calendarDate]);

  return { slots, loading, error };
}
