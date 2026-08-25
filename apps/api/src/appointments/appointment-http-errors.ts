import { BadGatewayException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import {
  AppointmentNotFoundError,
  InvalidAppointmentTransitionError,
  SlotUnavailableError,
  UnexpectedDepositStateError,
} from '@jc-barberia/domain';
import { MercadoPagoApiError } from '@jc-barberia/infrastructure';

/**
 * Turns the errors these use cases can raise into ordinary HTTP responses,
 * the pattern `HoldController` established for `SlotUnavailableError` — never
 * a bare 500 for an outcome the domain already anticipated.
 *
 * Shared by the staff routes (`AppointmentActionsController`) and the
 * client's own (`AccountController`) because cancelling reaches the SAME
 * refund path from both: `resolveDepositForCancellation` calls
 * `PaymentPort.refund` whenever the turno carries a settled deposit. The
 * client's route had no translation at all, so a refund MercadoPago rejected
 * surfaced to the person as "Internal server error" with nothing actionable
 * in it — which is exactly what the shop owner hit.
 */
const logger = new Logger('AppointmentCancellation');

export function rethrowAppointmentErrorAsHttp(error: unknown): never {
  if (error instanceof AppointmentNotFoundError) {
    throw new NotFoundException(`No existe un turno con id "${error.appointmentId}"`);
  }

  if (error instanceof SlotUnavailableError) {
    throw new ConflictException({
      message: 'El horario ya no está disponible',
      alternatives: error.alternatives.map((w) => ({ start: w.start.toISOString(), end: w.end.toISOString() })),
    });
  }

  // Resolving a turno that is already resolved is an expected business
  // outcome, not a server fault.
  if (error instanceof InvalidAppointmentTransitionError) {
    throw new ConflictException({
      message: `El turno ya está ${error.from} y no admite esta acción.`,
      from: error.from,
      to: error.to,
    });
  }

  // The deposit is in a state cancelling cannot act on — already refunded, or
  // still pending. Nothing was charged twice and nothing is lost; the turno
  // simply cannot be cancelled through this path right now.
  if (error instanceof UnexpectedDepositStateError) {
    throw new ConflictException({
      message: 'La seña de este turno está en un estado que no permite cancelarlo automáticamente.',
    });
  }

  // The refund itself failed at MercadoPago. This is deliberately NOT a 500:
  // our side worked, the payment provider refused or was unreachable, and the
  // difference matters to whoever is standing at the counter. `502` says
  // "upstream", and the message says what to do about it — the turno stays as
  // it was, so retrying is safe.
  if (error instanceof MercadoPagoApiError) {
    // The provider's own answer is the ONLY thing that says why it refused,
    // and it used to die right here: the browser got a status number and the
    // server logged nothing, so "MercadoPago rechazó la devolución" was
    // unactionable for everyone — the person at the counter AND whoever had
    // to debug it. Logged in full, server-side only; the response still
    // carries just the status, since a gateway's raw error body is not
    // something to render to whoever happens to be standing there.
    logger.error(`Refund rejected by MercadoPago — status ${error.status}, body: ${error.body}`);

    // A 401 is NOT a passing upstream hiccup: MercadoPago is refusing the
    // credentials themselves, and every retry from now until someone changes
    // the configuration will fail identically. Telling the person at the
    // counter to "intentar en unos minutos" would send them into a loop that
    // cannot end — the honest answer is that this needs the owner, not
    // patience. Diagnosed live against a real rejection:
    // `unauthorized use of live credentials`, returned because the seller
    // credentials belong to a MercadoPago TEST user while the payment is
    // `live_mode`, a mismatch no amount of retrying resolves.
    if (error.status === 401) {
      throw new BadGatewayException({
        message:
          'MercadoPago rechazó la devolución porque no acepta las credenciales de la cuenta. No es algo que se resuelva reintentando: avisale al dueño para que revise la configuración de MercadoPago. El turno quedó como estaba.',
        providerStatus: error.status,
        retryable: false,
      });
    }

    throw new BadGatewayException({
      message:
        'MercadoPago rechazó la devolución de la seña, así que el turno no se canceló. Volvé a intentarlo en unos minutos.',
      providerStatus: error.status,
      retryable: true,
    });
  }

  throw error;
}
