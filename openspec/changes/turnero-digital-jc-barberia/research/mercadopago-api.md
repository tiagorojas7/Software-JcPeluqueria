# Verificación de la API de MercadoPago — tarea 5.1

Fecha: 2026-08-13. Fuente: documentación oficial de MercadoPago vía Context7.

El `design.md` escribió los detalles de esta API **de memoria, sin acceso a documentación**, y lo dejó anotado como riesgo abierto (línea 552). Este documento cierra ese riesgo antes de que se escriba una línea de código de pagos.

---

## 1. Firma del webhook (`x-signature`)

**Formato del header:**

```
ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839
```

Dos partes separadas por coma: `ts` es un timestamp Unix, `v1` es el HMAC en hexadecimal.

**Plantilla del manifiesto** que hay que construir y hashear:

```
id:{data.id};request-id:{x-request-id};ts:{ts};
```

**Tres detalles que se pueden pasar por alto y rompen la validación:**

1. **`data.id` va en minúsculas.** Viene como query param de la URL del webhook y hay que bajarlo a minúsculas antes de armar el manifiesto.
2. **Cada parte se omite si está vacía**, pero el `;` final siempre va. Si no llega `x-request-id`, el manifiesto es `id:123;ts:1704908010;` — no `id:123;request-id:;ts:1704908010;`.
3. **La comparación tiene que ser de tiempo constante.** Un `===` común filtra información por tiempo de respuesta y permite adivinar la firma byte a byte. En Node: `crypto.timingSafeEqual`.

El algoritmo es HMAC-SHA256 con la clave secreta de la integración.

---

## 2. Ventana de reembolso — el riesgo no aplica a este negocio

La documentación **se contradice a sí misma**: un documento dice 180 días (y 72 horas para operaciones de retiro de efectivo), la tabla de errores y la guía de migración a Orders API dicen **360 días**.

**Para nosotros la contradicción es irrelevante.** Los reembolsos de este sistema ocurren en horas o pocos días:

| Cuándo se reembolsa | Plazo real |
|---|---|
| Vencimiento de un hold | 15 minutos |
| Cancelación del cliente | Hasta el día del turno |
| Rechazo de una reasignación por ausencia | El mismo día |

Ninguno se acerca ni de lejos al límite más corto. **No hace falta modelar el vencimiento de la ventana** ni escribir código defensivo para eso. Se documenta el error `refund_period_exceeded` (409) por completitud, pero no es un camino que este sistema pueda alcanzar en operación normal.

---

## 3. Reembolso parcial — probablemente no lo necesitemos

**Total:** `POST /v1/orders/{order_id}/refund` sin cuerpo.

**Parcial:** el mismo endpoint con el monto por transacción:

```json
{ "transactions": [ { "id": "TRANSACTION_ID", "amount": "10.00" } ] }
```

**La seña es indivisible en nuestro modelo.** Se cobra el 50% al reservar y se devuelve completo o no se devuelve nada — no existe ningún caso de negocio que reembolse una fracción de la seña. Salvo que aparezca uno, **el adaptador solo necesita el reembolso total**.

Se deja anotado por si las fases 9 o 10 traen un caso que lo pida.

---

## 4. HALLAZGO PRINCIPAL — `X-Idempotency-Key` es obligatorio y falta en el diseño

```
400  empty_required_header  — The X-Idempotency-Key header is required and was not sent.
```

**El diseño no lo menciona.** Su historia de idempotencia (`payment_id UNIQUE` + `UPDATE ... WHERE status='held'`) es sobre **nuestra** base de datos: evita que un reintento del webhook procese dos veces el mismo pago. Es correcta y sigue siendo necesaria.

Pero es una cosa distinta. `X-Idempotency-Key` protege del lado de MercadoPago: evita que **nuestro** reintento genere dos reembolsos reales.

Los dos hacen falta y resuelven problemas diferentes. Sin el header, el request ni siquiera se procesa.

**Consecuencia de diseño:** la clave de idempotencia tiene que ser **estable entre reintentos del mismo reembolso lógico**. No puede ser un UUID nuevo por intento — eso anula el propósito. Debe derivarse de algo persistente, como el `deposit_id` más el motivo del reembolso. El job `hold.expire` de la fase 6 reintenta, así que esto importa de verdad.

Y el error `409 idempotency_key_already_used` avisa cuando se reusó una clave con un cuerpo distinto: útil como test de que la derivación es correcta.

---

## 5. Errores del reembolso que hay que manejar

`428 insufficient_money_for_refund` — **saldo insuficiente en la cuenta de MercadoPago.**

Este es el que más importa operativamente y no está contemplado en ningún lado. Escenario real: el dueño retira la plata de la cuenta de MercadoPago, después un cliente cancela y el reembolso falla porque no hay fondos.

**No es un error de programación: es un estado del negocio.** El reembolso tiene que quedar pendiente y reintentarse, no perderse. La cola de la fase 6 es el lugar natural para eso, y el cliente no puede quedar sin su plata porque la cuenta estaba vacía en ese momento.

Otros a contemplar:

| Código | Error | Qué hacer |
|---|---|---|
| `409` | `order_already_refunded` | No es error: es el resultado esperado de un reintento. Tratar como éxito |
| `409` | `refund_in_progress` | Ya hay uno en curso. Reintentar más tarde, no duplicar |
| `409` | `cannot_refund_order` | El pago no está en estado reembolsable. Revisar antes de intentar |
| `422` | `max_refunds_exceeded` | Sin acción posible. Requiere intervención humana |
| `425` | `order_payment_not_yet_enabled_for_refund` | Todavía no acreditado. Reintentar |

**El patrón:** `409 order_already_refunded` es éxito disfrazado de error, y los `425`/`428`/`409 refund_in_progress` son reintentables. Confundirlos con fallas definitivas dejaría clientes sin su seña.

---

## 6. Decisión pendiente — qué familia de API usamos

El diseño dice `/v1/payments/{id}/refunds` (Payments API). La documentación de la **Orders API** dice que las integraciones que la usan deben usar exclusivamente `/v1/orders/{order_id}/refund` y que la Payments API ya no debe usarse para reembolsos.

**No está claro cuál aplica a Checkout Pro**, que es lo que el diseño eligió para el cobro.

**Esto hay que resolverlo contra una cuenta de prueba real antes de escribir el adaptador**, no adivinando. Es exactamente el tipo de detalle que la tarea 5.1 existe para evitar.

---

## Resumen de impacto sobre el plan

| Hallazgo | Impacto |
|---|---|
| Plantilla exacta del manifiesto | Cierra el riesgo. Implementable ya |
| Ventana de reembolso | **Riesgo descartado** — nuestros plazos son de horas |
| Reembolso parcial | **Probablemente innecesario** — la seña es indivisible |
| `X-Idempotency-Key` | **Agujero en el diseño.** Clave derivada y estable entre reintentos |
| `insufficient_money_for_refund` | **Escenario de negocio no contemplado.** Reintento en la cola de la fase 6 |
| Familia de API | **Bloqueante.** Verificar contra cuenta de prueba antes del adaptador |
