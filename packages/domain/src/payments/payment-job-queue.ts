/**
 * The webhook's only job is to verify the signature and hand off — never to
 * process the payment inline (design.md: "responder 200 de inmediato y
 * procesar de forma asíncrona"). This port is deliberately thin: Phase 6
 * supplies the real pg-boss-backed adapter and the worker that consumes it;
 * this phase only needs somewhere to enqueue, so the webhook handler stays
 * free of queue-technology detail.
 */
export interface PaymentJobQueue {
  enqueueProcessPayment(input: { readonly paymentId: string }): Promise<void>;
}
