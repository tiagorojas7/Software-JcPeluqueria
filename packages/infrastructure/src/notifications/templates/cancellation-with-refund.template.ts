import type { EmailTemplateRenderer } from './types';

/**
 * "Cancelación con reembolso" — fired by the `hold.expire` handler
 * (`ExpireHold`) when an absence-offer hold lapses and the origin seña was
 * refunded. The payload is `{ refundId, amountCents }`, both strings (the
 * outbox stores a flat string map). The amount is rendered in pesos — cents to
 * dollars with an AR-style `2.500,00` grouping — so the customer reads a
 * human number, never `250000` raw cents.
 */
function formatPesos(cents: string): string {
  const value = Number(cents) / 100;
  const fixed = value.toFixed(2); // "2500.00"
  const [intPart = '0', decPart = '00'] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); // 2500 -> 2.500
  return `$${grouped},${decPart}`;
}

export const cancellationWithRefundTemplate: EmailTemplateRenderer = ({ refundId = 'desconocido', amountCents = '0' }) => ({
  subject: 'JC Barberia — se devolvio tu seña',
  body: [
    'Tu turno fue cancelado y devolvimos la seña que habias pagado.',
    '',
    `Monto devuelto: ${formatPesos(amountCents)}`,
    `Reembolso #${refundId}`,
    '',
    'Si no lo ves reflejado en tu cuenta en los proximos dias, respondi a este correo.',
  ].join('\n'),
});
