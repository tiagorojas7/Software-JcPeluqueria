import { useEffect, useState } from 'react';

import { AccessCodeNotice } from '../booking/AccessCodeNotice';
import { apiPost } from '../shared/api-client';
import './PaymentReturnPage.css';

type PaymentEstado = 'success' | 'pending' | 'failure' | 'unknown';

/**
 * One word above the headline saying where the client stands. The four
 * outcomes used to be visually identical, so a rejected payment and a
 * received one arrived looking the same — the client had to read a full
 * paragraph to find out which had happened.
 */
const EYEBROW: Record<PaymentEstado, string> = {
  success: 'Pago recibido',
  pending: 'Pago en proceso',
  failure: 'Pago rechazado',
  unknown: 'Estado desconocido',
};

const COPY: Record<PaymentEstado, { readonly title: string; readonly body: string }> = {
  success: {
    title: 'Recibimos tu pago',
    body:
      'Todavía estamos confirmando tu turno con el sistema. En unos minutos te va a llegar un email con la ' +
      'confirmación, el barbero, el servicio y el horario. Si no te llega, revisá la carpeta de spam o entrá a ' +
      'Mi cuenta para ver el estado real de tu turno.',
  },
  pending: {
    title: 'Tu pago está pendiente',
    body:
      'MercadoPago todavía está procesando el pago. Si se aprueba, te va a llegar un email de confirmación; si ' +
      'no se aprueba, el horario se libera automáticamente y podés volver a intentarlo.',
  },
  failure: {
    title: 'El pago no se pudo completar',
    body: 'No se acreditó el pago y el turno no quedó reservado. Podés volver a intentar la reserva cuando quieras.',
  },
  unknown: {
    title: 'Volviste de MercadoPago',
    body:
      'No pudimos identificar el estado de tu pago desde este enlace. Si ya pagaste, en unos minutos te llega ' +
      'un email de confirmación; si preferís, entrá a Mi cuenta para revisar tus turnos.',
  },
};

/**
 * The exact route MercadoPago's `back_urls` point at
 * (`packages/infrastructure/src/payments/mercadopago-payment.adapter.ts`,
 * `RETURN_PATH` — cablear-el-mvp item 3). Public: the client carries no
 * session here, so this NEVER renders as "tu turno esta confirmado" for
 * `estado=success` — design.md is explicit that "el redirect del navegador
 * no es fuente de verdad": MercadoPago's own redirect can beat the webhook
 * that actually flips the turno to `reservado`. The `booking_confirmed`
 * email (or a fresh login into "Mi cuenta") is the only source of truth for
 * that, never this page.
 */
function readEstado(search: string): PaymentEstado {
  const estado = new URLSearchParams(search).get('estado');
  return estado === 'success' || estado === 'pending' || estado === 'failure' ? estado : 'unknown';
}

export interface PaymentReturnPageProps {
  /** Defaults to `window.location.search` — overridable so this page never
   *  has to depend on the router, which tracks only `pathname`, not the
   *  query string MercadoPago appends its own params onto. */
  readonly search?: string;
}

export function PaymentReturnPage({ search = window.location.search }: PaymentReturnPageProps) {
  const [estado] = useState(() => readEstado(search));
  const { title, body } = COPY[estado];

  // The client's return is the SECOND chance to notice the payment, next to
  // MercadoPago's webhook — which is one delivery attempt to one URL and does
  // go missing. It happened in production: an approved payment of ARS 6.000
  // whose `notification_url` was correct produced no notification, and the
  // hold sat minutes from expiring with the money already taken.
  //
  // MercadoPago appends `payment_id` to this very URL, so the browser that
  // lands here is carrying exactly what is needed to ask about it.
  //
  // This does NOT confirm anything, and the copy above deliberately keeps
  // saying "estamos confirmando": all it does is schedule the question the
  // worker asks MercadoPago. Failures are swallowed on purpose — the webhook
  // is still coming, and telling a client who paid correctly that something
  // went wrong would be both alarming and untrue.
  useEffect(() => {
    const paymentId = new URLSearchParams(search).get('payment_id');
    if (!paymentId || estado === 'failure') {
      return;
    }
    void apiPost('/payments/claim', { paymentId }).catch(() => {});
  }, [search, estado]);

  return (
    <section className="container payment-return">
      <div className={`card payment-return__card payment-return__card--${estado}`}>
        <p className="payment-return__eyebrow">{EYEBROW[estado]}</p>
        <h2>{title}</h2>
        {/* A rejected payment is the one outcome on this page the client has
            to act on, so it is the one announced as an alert. The other
            three are progress reports: nothing is owed and nothing is
            broken, and announcing them with the same urgency would teach
            the client to ignore all four. */}
        <p role={estado === 'failure' ? 'alert' : 'status'} className="payment-return__body">
          {body}
        </p>
        <AccessCodeNotice />
      </div>
    </section>
  );
}
