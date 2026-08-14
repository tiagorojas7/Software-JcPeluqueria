import type { PaymentEventRepository } from '@jc-barberia/domain';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { paymentEvents } from '../db/schema/payments';

export class DrizzlePaymentEventRepository implements PaymentEventRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async record(input: { paymentId: string; rawPayload: unknown; signatureValid: boolean }): Promise<void> {
    await this.db.insert(paymentEvents).values({
      paymentId: input.paymentId,
      rawPayload: input.rawPayload,
      signatureValid: input.signatureValid,
    });
  }
}
