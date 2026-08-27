import { useEffect, useState } from 'react';
import type {
  PublicBarberResponse,
  PublicBarbersResponse,
  PublicServiceResponse,
  PublicServicesResponse,
} from '@jc-barberia/contracts';

import { apiGet, describeError } from './api-client';

export interface UseReferenceDataOptions {
  /** `false` skips the fetch entirely — for a screen whose current actor has
   *  no section that needs barbers or services. */
  readonly enabled?: boolean;
}

export interface UseReferenceDataResult {
  readonly barbers: readonly PublicBarberResponse[] | null;
  readonly services: readonly PublicServiceResponse[] | null;
  readonly loading: boolean;
  readonly error: string | null;
  /** Both lists arrived and nothing failed — the gate a screen uses before
   *  rendering a picker that would otherwise show an empty select. */
  readonly ready: boolean;
}

/**
 * The barbers + services lookup five screens each performed on their own —
 * `BookingPage`, `PhoneAppointmentPage`, `ManagementPage`,
 * `AdminDayBoardPanel` and `HomePage` all repeated the same `Promise.all`,
 * the same `cancelled` flag and the same error handling. One shared hook, in
 * the same spirit `useAvailabilitySlots` was extracted for the availability
 * lookup: a fix to the fetch shape lands once instead of five times.
 *
 * `/barbers` returns active barbers only and `/services` the catalogue — both
 * public endpoints, no permission needed, which is why the public home page
 * and the panel can share this hook unchanged.
 */
export function useReferenceData({ enabled = true }: UseReferenceDataOptions = {}): UseReferenceDataResult {
  const [barbers, setBarbers] = useState<readonly PublicBarberResponse[] | null>(null);
  const [services, setServices] = useState<readonly PublicServiceResponse[] | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    async function load() {
      try {
        const [barbersResponse, servicesResponse] = await Promise.all([
          apiGet<PublicBarbersResponse>('/barbers'),
          apiGet<PublicServicesResponse>('/services'),
        ]);
        if (cancelled) {
          return;
        }
        setBarbers(barbersResponse.barbers);
        setServices(servicesResponse.services);
      } catch (err) {
        if (!cancelled) {
          setError(describeError(err));
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
  }, [enabled]);

  return { barbers, services, loading, error, ready: barbers !== null && services !== null && error === null };
}
