import {
  createBarberSchedule,
  createBarberTimeOff,
  createShopHours,
  type BarberSchedule,
  type BarberTimeOff,
  type DayOfWeek,
  type ScheduleRepository,
  type ShopHours,
} from '@jc-barberia/domain';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { barberSchedules, barberTimeOff, shopHours } from '../db/schema/availability';
import { toWallClockTime } from '../shared/db/wall-clock-time';

export class DrizzleScheduleRepository implements ScheduleRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async createShopHours(hours: ShopHours): Promise<void> {
    await this.db.insert(shopHours).values(hours);
  }

  async listShopHours(): Promise<ShopHours[]> {
    const rows = await this.db.select().from(shopHours);
    return rows.map((row) =>
      createShopHours({
        dayOfWeek: row.dayOfWeek as DayOfWeek,
        opensAt: toWallClockTime(row.opensAt),
        closesAt: toWallClockTime(row.closesAt),
      }),
    );
  }

  async createBarberSchedule(schedule: BarberSchedule): Promise<void> {
    await this.db.insert(barberSchedules).values(schedule);
  }

  async listBarberSchedule(barberId: string): Promise<BarberSchedule[]> {
    const rows = await this.db
      .select()
      .from(barberSchedules)
      .where(eq(barberSchedules.barberId, barberId));
    return rows.map((row) =>
      createBarberSchedule({
        barberId: row.barberId,
        dayOfWeek: row.dayOfWeek as DayOfWeek,
        opensAt: toWallClockTime(row.opensAt),
        closesAt: toWallClockTime(row.closesAt),
      }),
    );
  }

  async createBarberTimeOff(timeOff: BarberTimeOff): Promise<void> {
    await this.db.insert(barberTimeOff).values(timeOff);
  }

  async listBarberTimeOff(barberId: string): Promise<BarberTimeOff[]> {
    const rows = await this.db
      .select()
      .from(barberTimeOff)
      .where(eq(barberTimeOff.barberId, barberId));
    return rows.map((row) =>
      createBarberTimeOff({
        barberId: row.barberId,
        startDate: row.startDate,
        endDate: row.endDate,
      }),
    );
  }
}
