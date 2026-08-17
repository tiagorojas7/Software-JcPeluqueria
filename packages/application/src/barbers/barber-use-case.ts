import { Barber, BarberRepository } from '@jc-barberia/domain';

export class BarberNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No barber found with id "${id}"`);
    this.name = 'BarberNotFoundError';
  }
}

export interface BarberListItem {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export interface BarberUseCase {
  list(): Promise<BarberListItem[]>;
  create(input: { id: string; name: string; active?: boolean }): Promise<Barber>;
}

export class DrizzleBarberUseCase implements BarberUseCase {
  constructor(private readonly barbers: BarberRepository) {}

  async list(): Promise<BarberListItem[]> {
    const all = await this.barbers.list();
    return all.map((b) => ({
      id: b.id,
      name: b.name,
      active: b.active,
    }));
  }

  async create(input: { id: string; name: string; active?: boolean }): Promise<Barber> {
    await this.barbers.create({ id: input.id, name: input.name, active: input.active ?? true });
    return { id: input.id, name: input.name, active: input.active ?? true };
  }
}