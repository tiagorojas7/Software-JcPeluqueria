import { useEffect, useState } from 'react';
import type { BarberWeekResponse } from '@jc-barberia/contracts';

import { apiGet } from './api-client';
import { dayOfWeekOfCalendarDate } from './shop-time';

/** 0 = domingo, the numbering used across the whole system. Two forms: the
 *  list form for "atiende los lunes, miércoles..." and the singular form for
 *  "no atiende los martes". */
const DAY_NAMES = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'] as const;

export interface BarberWorkingDaysProps {
  readonly barberId: string;
  /** The `YYYY-MM-DD` currently chosen, or `''` when none is. */
  readonly calendarDate: string;
}

/** "lunes, miércoles, viernes y sábados" — an Spanish list, not a CSV. */
function joinDayNames(days: readonly number[]): string {
  const names = days.map((day) => DAY_NAMES[day]!);
  if (names.length <= 1) {
    return names.join('');
  }
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/**
 * Says which days the chosen barber actually works, and warns when the date
 * being booked is not one of them.
 *
 * The panel's date input is a native `<input type="date">`, which cannot
 * disable individual weekdays — so whoever answered the phone picked a date
 * blind and, on a day the barber does not work, got `AvailabilityPicker`'s
 * "no hay horarios disponibles". That message is indistinguishable from
 * "that day is fully booked", which is a completely different problem with a
 * completely different answer. This component makes the distinction visible
 * BEFORE the date is chosen, and names it explicitly after.
 *
 * Silent on a failed read, deliberately: with no schedule on hand it cannot
 * honestly claim the barber does not work that day, and a false warning on a
 * booking screen is worse than no warning at all.
 */
export function BarberWorkingDays({ barberId, calendarDate }: BarberWorkingDaysProps) {
  const [workingDays, setWorkingDays] = useState<readonly number[] | null>(null);

  useEffect(() => {
    if (!barberId) {
      setWorkingDays(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const response = await apiGet<BarberWeekResponse>(`/panel/barbers/${barberId}/schedule`);
        if (!cancelled) {
          setWorkingDays(response.days.map((day) => day.dayOfWeek).sort((a, b) => a - b));
        }
      } catch {
        if (!cancelled) {
          setWorkingDays(null);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [barberId]);

  if (workingDays === null) {
    return null;
  }

  if (workingDays.length === 0) {
    return (
      <p className="barber-working-days barber-working-days--warn" role="alert">
        Este barbero no tiene días de trabajo cargados. Configurá su horario antes de darle turnos.
      </p>
    );
  }

  const chosenDay = dayOfWeekOfCalendarDate(calendarDate);
  const worksOnChosenDay = chosenDay === null || workingDays.includes(chosenDay);

  return (
    <>
      <p className="barber-working-days">Atiende los {joinDayNames(workingDays)}.</p>
      {!worksOnChosenDay && (
        <p className="barber-working-days barber-working-days--warn" role="alert">
          Este barbero no atiende los {DAY_NAMES[chosenDay]}. Elegí otra fecha.
        </p>
      )}
    </>
  );
}
