import { BadRequestException, Body, ConflictException, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { CheckoutUseCase, CreateHold, RegisterClientUseCase } from '@jc-barberia/application';
import {
  CheckoutRequestSchema,
  ConfirmReservationRequestSchema,
  CreateHoldRequestSchema,
  type CheckoutResponseBody,
  type ConfirmReservationResponse,
  type HoldResponse,
} from '@jc-barberia/contracts';
import { SlotUnavailableError, type Clock, type HoldRepository, type ServiceRepository } from '@jc-barberia/domain';

import { Public } from '../access-control/decorators/public.decorator';
import { CLOCK, HOLD_REPOSITORY, SERVICE_REPOSITORY } from './tokens';

/**
 * client-booking spec, "Exploración sin cuenta" + slot-hold "Creación del
 * hold" (task 2.8, reused unmodified here): a visitor claims a schedule
 * before ever identifying themselves. `clientId` is always `null` on
 * creation — the account only exists at confirmation (task 9.7/9.8). Time
 * travels as `calendarDate` + local `HH:mm`, same shape
 * `PhoneAppointmentController` uses, so `Clock.localTimeToUtc` remains the
 * only place a concrete instant is built.
 */
@Controller('holds')
export class HoldController {
  constructor(
    private readonly createHold: CreateHold,
    private readonly registerClient: RegisterClientUseCase,
    private readonly checkout: CheckoutUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(HOLD_REPOSITORY) private readonly holds: HoldRepository,
    @Inject(SERVICE_REPOSITORY) private readonly services: ServiceRepository,
  ) {}

  @Public()
  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown): Promise<HoldResponse> {
    const parsed = CreateHoldRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { barberId, serviceId, calendarDate, startTime, endTime } = parsed.data;

    try {
      const hold = await this.createHold.execute({
        id: crypto.randomUUID(),
        barberId,
        serviceId,
        clientId: null,
        channel: 'web',
        timeRange: {
          start: this.clock.localTimeToUtc(calendarDate, startTime),
          end: this.clock.localTimeToUtc(calendarDate, endTime),
        },
        searchWindow: this.clock.businessDayBounds(calendarDate),
      });
      return { holdId: hold.id, expiresAt: hold.holdExpiresAt.toISOString() };
    } catch (error) {
      // design.md's competing-clients diagram: a slot taken out from under
      // this request is an ordinary 409 with alternatives, never a 500 — the
      // same translation the EXCLUDE constraint already forces at the
      // repository boundary (SlotUnavailableError), just surfaced here.
      if (error instanceof SlotUnavailableError) {
        throw new ConflictException({
          message: 'El horario ya no está disponible',
          alternatives: error.alternatives.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
        });
      }
      throw error;
    }
  }

  /**
   * client-booking spec, "Cuenta sin contraseña creada al final del flujo"
   * (task 9.5/9.6/9.7/9.8). Rejects BEFORE ever calling
   * `RegisterClientUseCase` when a required field is missing (Scenario
   * "Intento de confirmar sin los datos obligatorios") — no client, no
   * account, no appointment, no charge, the same `safeParse`-then-guard
   * shape every other controller in this app uses. `hold-expired` maps to
   * `409`, the same status a lost hold race already uses elsewhere in this
   * controller.
   */
  @Public()
  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() body: unknown): Promise<ConfirmReservationResponse> {
    const parsed = ConfirmReservationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { holdId, client } = parsed.data;

    const result = await this.registerClient.execute({
      holdId,
      name: client.name,
      phone: client.phone,
      email: client.email,
      age: client.age ?? null,
    });
    if (result.outcome === 'hold-expired') {
      throw new ConflictException({ message: 'El horario retenido ya venció' });
    }
    return { clientId: result.clientId };
  }

  /**
   * client-booking spec, "Reserva web con seña obligatoria del 50%" (task
   * 9.11/9.12): reuses `CheckoutUseCase` (5.6) untouched — this handler's
   * only job is to resolve the two primitives that use case needs
   * (`priceCents`/`description`) from the hold's own `serviceId`, then hand
   * off. `outcome: 'hold-expired'` is a normal `200` response, not an
   * exception, deliberately mirroring `CheckoutResponseBody`'s own shape:
   * the browser is expected to branch on it, same as `AccessCodeForm`
   * branches on `ClientLoginResult['outcome']`. Never creates or confirms
   * anything itself — "Falla el cobro de la seña" (MUST NOT crear el turno
   * reservado) holds structurally because nothing on this path ever writes
   * `reservado`; that happens only in `ProcessPaymentUseCase`, driven by the
   * webhook, never by this synchronous response.
   */
  @Public()
  @Post('checkout')
  @HttpCode(200)
  async startCheckout(@Body() body: unknown): Promise<CheckoutResponseBody> {
    const parsed = CheckoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { holdId } = parsed.data;

    const hold = await this.holds.findById(holdId);
    if (!hold) {
      return { outcome: 'hold-expired' };
    }
    const service = await this.services.findById(hold.serviceId);
    if (!service) {
      throw new ConflictException({ message: 'El servicio del horario retenido ya no existe' });
    }

    const result = await this.checkout.execute({
      holdId,
      priceCents: service.priceCents,
      description: service.name,
    });
    return result.outcome === 'created'
      ? { outcome: 'created', initPoint: result.initPoint }
      : { outcome: 'hold-expired' };
  }
}
