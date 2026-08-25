import { FakeClock } from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { createTemplateRegistry } from './index';

// 7.7 RED — "plantillas — codigo/enlace de acceso, cancelacion con reembolso,
// oferta de reasignacion, recordatorio." The minimal set the spec enumerates
// (notification-port: "Eventos mínimos que deben notificarse"). The reasignación
// offer has NO event type yet (a `NotificationTemplate` member would have to be
// added — Phase 12 owns task 12.5, the outbox writer for it); Fase 7 only
// renders the EXISTING event types per the brief. Every `NotificationTemplate`
// MUST have a renderer (exhaustive registry) and each renders non-empty
// `{ subject, body }` from its outbox payload.

describe('createTemplateRegistry (7.7) — una plantilla por evento existente', () => {
  const registry = createTemplateRegistry(new FakeClock());

  it('staff_password_reset: codigo o enlace de acceso con el token', () => {
    const rendered = registry['staff_password_reset']({ token: 'abc123', expiresAt: '2026-09-01T13:00:00.000Z' });
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.body).toContain('abc123');
  });

  // `staff_activation` stopped sharing `accessTemplate` with the reset above
  // when the panel gained the alta that sends it (README 3.9): what the
  // barber receives is a LINK to a form where they pick a password, not a
  // token to transcribe — so this registry, built with no `PUBLIC_BASE_URL`,
  // renders a body with no link and, deliberately, no bare token either. Its
  // own behaviour is covered in `staff-activation.spec.ts`.
  it('staff_activation: invita a activar la cuenta sin exponer el token suelto', () => {
    const rendered = registry['staff_activation']({
      challengeId: 'challenge-1',
      token: 'abc123',
      expiresAt: '2026-09-01T13:00:00.000Z',
    });
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.body.length).toBeGreaterThan(0);
    expect(rendered.body).not.toContain('abc123');
  });

  it('cancellation_with_refund: confirma el reembolso y menciona la seña', () => {
    const rendered = registry['cancellation_with_refund']({ refundId: 'rf-1', amountCents: '250000' });
    expect(rendered.subject.length).toBeGreaterThan(0);
    // The amount is rendered in pesos (cents -> dollars), never raw cents.
    expect(rendered.body).toContain('2.500'); // 250000 cents = 2500.00
  });

  it('reminder_with_deposit / reminder_without_deposit: recordatorio de turno', () => {
    for (const template of ['reminder_with_deposit', 'reminder_without_deposit'] as const) {
      const rendered = registry[template]({ appointmentId: 'apt-1', appointmentTime: '2026-09-01T13:00:00.000Z' });
      expect(rendered.subject.length).toBeGreaterThan(0);
      expect(rendered.body.length).toBeGreaterThan(0);
    }
  });

  // 12.5 RED — barber-absence-reassignment now owns a NotificationTemplate
  // member ('absence_reassignment_offer'); the registry MUST render it (the
  // exhaustive Record<NotificationTemplate, ...> forces this — see the type
  // doc comment above).
  it('absence_reassignment_offer: ofrece el horario alternativo del mismo dia', () => {
    const rendered = registry['absence_reassignment_offer']({
      appointmentId: 'apt-1',
      offeredBarberId: 'barber-2',
      offeredStart: '2026-09-01T14:00:00.000Z',
      offeredEnd: '2026-09-01T14:30:00.000Z',
      holdExpiresAt: '2026-09-01T14:15:00.000Z',
    });
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.body.length).toBeGreaterThan(0);
  });

  // cablear-el-mvp item 1 — a client who pays hears nothing today. This
  // template is what `ProcessPaymentUseCase` enqueues on the FIRST
  // 'confirmed' outcome: barber, service and shop-local time, plus the
  // reminder that the rest is paid at the shop.
  it('booking_confirmed: turno confirmado, con barbero, servicio y hora local', () => {
    const rendered = registry['booking_confirmed']({
      barberName: 'Cristian',
      serviceName: 'Corte clasico',
      appointmentTime: '2026-09-01T17:00:00.000Z',
    });
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.body).toContain('Cristian');
    expect(rendered.body).toContain('Corte clasico');
  });

  // El dueño lo vio en un mail real: un turno telefonico no lleva seña, y el
  // mensaje igual afirmaba "Ya pagaste la seña". Decirle al cliente que pago
  // algo que no pago es peor que no decirle nada, asi que la linea del dinero
  // sale del payload y no de un supuesto.
  it('booking_confirmed sin seña: no afirma un pago que no ocurrio', () => {
    const rendered = registry['booking_confirmed']({
      barberName: 'Cristian',
      serviceName: 'Corte clasico',
      appointmentTime: '2026-09-01T17:00:00.000Z',
      depositPaid: 'false',
    });
    expect(rendered.body).not.toContain('Ya pagaste');
    expect(rendered.body).toContain('en el local');
  });

  it('booking_confirmed con seña: si la menciona', () => {
    const rendered = registry['booking_confirmed']({
      barberName: 'Cristian',
      serviceName: 'Corte clasico',
      appointmentTime: '2026-09-01T17:00:00.000Z',
      depositPaid: 'true',
    });
    expect(rendered.body).toContain('Ya pagaste la seña');
  });

  // panel-usable — "nobody tells the client their appointment changed":
  // EditAppointmentUseCase enqueues this whenever staff edit a turno's
  // barbero, servicio or horario.
  it('appointment_updated: turno modificado, con el barbero/servicio/hora vigentes', () => {
    const rendered = registry['appointment_updated']({
      barberName: 'Facundo',
      serviceName: 'Corte + Barba',
      appointmentTime: '2026-09-01T18:00:00.000Z',
    });
    expect(rendered.subject.length).toBeGreaterThan(0);
    expect(rendered.body).toContain('Facundo');
    expect(rendered.body).toContain('Corte + Barba');
  });
});
