import {
  HOLD_DURATION_MINUTES,
  type Clock,
  type Hold,
  type HoldRepository,
  type OccupancyChannel,
  type TimeWindow,
} from '@jc-barberia/domain';
import { CreateHold } from '@jc-barberia/application';
import { RegisterClientUseCase } from '@jc-barberia/application';

export interface ConfirmReservationInput {
  readonly holdId: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
}

export interface ConfirmReservationOutput {
  readonly success: boolean;
  readonly userId?: string;
  readonly reason?: string;
}

export class ConfirmReservationUseCase {
  constructor(
    private readonly createHold: CreateHold,
    private readonly registerClient: RegisterClientUseCase,
    private readonly holds: HoldRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ConfirmReservationInput): Promise<ConfirmReservationOutput> {
    // Validate required fields
    if (!input.name.trim() || !input.phone.trim() || !input.email.trim()) {
      return { success: false, reason: 'Missing required fields: name, phone, email' };
    }

    // Create client account first
    const clientResult = await this.registerClient.execute({
      name: input.name.trim(),
      phone: input.phone.trim(),
      email: input.email.trim(),
    });

    if (!clientResult.userId) {
      return { success: false, reason: 'Failed to create client account' };
    }

    // TODO: In a full implementation, would proceed with checkout/payment
    // For now, just confirm the hold transition
    const hold = await this.holds.confirm(clientResult.userId);

    return {
      success: hold,
      userId: clientResult.userId,
    };
  }
}