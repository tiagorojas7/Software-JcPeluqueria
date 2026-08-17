import type { Service, ServiceRepository } from '../ports';

/**
 * In-memory `ServiceRepository` test double.
 */
export class FakeServiceRepository implements ServiceRepository {
  private readonly byId = new Map<string, Service>();
  readonly listCalls: Array<unknown> = [];

  seed(service: Service): void {
    this.byId.set(service.id, service);
  }

  async create(service: Service): Promise<void> {
    this.byId.set(service.id, service);
  }

  async findById(id: string): Promise<Service | null> {
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<Service[]> {
    return Array.from(this.byId.values());
  }
}