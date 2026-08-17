# Tasks: Cablear el MVP — de "probado" a "usable en pantalla"

> Fuente: auditoría del 2026-08-17 sobre `feat/turnero-integracion`, tras levantar
> la aplicación por primera vez.

## Por qué existe este cambio

El tracker `turnero-digital-jc-barberia` cerró 192/192 y sus 40 requisitos están
implementados y probados. Pero ese tracker pedía **dominio y aplicación**: solo
unas pocas tareas pedían endpoint (la 10.2 lo dice literal, y es de las que hoy
funcionan). Ninguna fase fue dueña de "cablear todo a HTTP y construir los
adaptadores que faltan", así que ese trabajo no estaba en ningún lado.

La consecuencia se vio recién al ejecutar la aplicación: buena parte del sistema
tiene casos de uso escritos, testeados y **inalcanzables**.

Tres tareas del tracker anterior quedaron marcadas completas sin estarlo, y se
corrigen acá:

- **7.8** decía "plantillas conectadas a los outbox-writers". No hay tabla
  `notification_outbox` ni adaptador: no están conectadas a nada.
- **6.13** decía "consumidor del outbox". El caso de uso existe pero no está
  cableado al worker y no tiene de dónde consumir.
- **10.11** decía "conectar el panel a MarkCompleted/ConfirmAbsence". No existe
  ningún controller.

Pasaron los tests porque los tests usan el fake. Esa es la lección que gobierna
este tracker.

## Criterio de aceptación — uno solo, y no se negocia

**Cada función se ejecuta desde la pantalla, con datos reales, contra Postgres
real.** Un test verde no cierra ninguna tarea de acá. La evidencia es la
secuencia de pasos en la interfaz y lo que se ve al final.

Un caso de uso alcanzable solo por `curl` tampoco cierra la tarea: si la
secretaria no puede hacerlo desde el panel, no está hecho.

## Estado actual (auditado, no estimado)

**Ya funciona de punta a punta**: disponibilidad pública · creación de hold ·
alta de cuenta al confirmar · checkout · turno telefónico · vista del día ·
estadísticas y facturación del barbero · gestión de clientes y barberos ·
marcar barbero ausente · login de personal · webhook de MercadoPago.

**Escrito, testeado e inalcanzable**: marcar realizado (admin y barbero) ·
confirmar ausencia (admin y barbero) · walk-in · editar turno · cancelación
administrativa · cancelación propia del cliente · aceptar oferta · rechazar
oferta · solicitar acceso web · login de cliente.

**Infraestructura que no existe**: tabla `notification_outbox` · su adaptador
Drizzle · consumidor del outbox en el worker · handler `hold.expire` ·
`appointment.reminder`.

---

## Slice A: Notificaciones de punta a punta

Sin esto el sistema no entrega **ni un solo mensaje**: ni recordatorio, ni código
de acceso, ni aviso de cancelación con reembolso, ni oferta de reasignación.
Todo escribe contra un puerto cuya única implementación es un doble de test.

- [ ] A.1 Migración `0011`: tabla `notification_outbox` (`notification_type`,
      `recipient_email`, `payload jsonb`, `attempts`, `status`, `last_error`,
      `created_at`). Aplicada y verificada contra Postgres real.
- [ ] A.2 RED (Testcontainers): `pickPendingForDelivery` toma una fila pendiente
      y no la vuelve a entregar en la misma tanda; `markDelivered`/`markFailed`
      dejan el estado correcto; el backoff respeta `attempts`.
- [ ] A.3 GREEN: `DrizzleNotificationOutboxRepository`.
- [ ] A.4 Cablear `NotificationOutboxConsumer` en `apps/worker` con el adaptador
      real y `createNotificationPort` (Gmail o console según config).
- [ ] A.5 Cablear el handler `hold.expire` (`ExpireHold` + `RefundUseCase` +
      notificación). Hoy la cola existe pero nadie la consume.
- [ ] A.6 Cablear `appointment.reminder` y encolarlo desde el camino de
      confirmación, vía `ScheduleAppointmentReminder`.
- [ ] A.7 **Evidencia en pantalla**: reservar un turno, forzar el vencimiento del
      hold, y ver el mail salir por el canal `console` en el log del worker.

## Slice B: Panel — acciones sobre el turno

Hoy la agenda del día se ve, pero **no se puede hacer nada sobre un turno**.

- [ ] B.1 Endpoints de `AdminMarkCompletedUseCase` y `AdminConfirmAbsenceUseCase`,
      con `@RequiresPermission`. Cierra la deuda de la tarea 10.11.
- [ ] B.2 Endpoints de `BarberMarkCompletedUseCase` y `BarberConfirmAbsenceUseCase`
      (acotados por `actor.barberId`). Los use cases existen desde la 11.13 y
      nunca tuvieron ruta.
- [ ] B.3 Endpoint de `EditAppointmentUseCase` (servicio, barbero, horario).
- [ ] B.4 Endpoint de `AdminCancelAppointmentUseCase`.
- [ ] B.5 Endpoint de `CreateWalkInUseCase`.
- [ ] B.6 Acciones en `DayBoard`: los botones que hoy están montados y muertos
      pasan a llamar a los endpoints de arriba, respetando el `allowedActions`
      que el servidor ya calcula (tarea 8.3/8.4).
- [ ] B.7 **Evidencia en pantalla**: entrar como dueño, marcar un turno realizado,
      editar otro, cancelar un tercero, y cargar un walk-in. Luego entrar como
      barbero y confirmar que solo puede resolver los propios.

## Slice C: Cliente — autogestión

El cliente puede reservar y pagar, pero **no puede volver a entrar ni cancelar**.

- [ ] C.1 Endpoint de `RequestClientAccessUseCase` (`@Public()`).
- [ ] C.2 Endpoint de `ClientLoginUseCase` (`@Public()`), que emite la sesión de
      cliente vía `SessionService` con el TTL de 30 días de la tarea 3a.19.
- [ ] C.3 Página "Mi cuenta": el cliente autenticado ve sus turnos.
- [ ] C.4 Endpoint de `SelfCancelAppointmentUseCase`, acotado al `clientId` de la
      sesión, nunca al que venga en el body.
- [ ] C.5 Botón de cancelar en "Mi cuenta", que respeta la ventana de 1h y
      muestra el instante de corte cuando la rechaza.
- [ ] C.6 Endpoints de `AcceptOfferUseCase` y `RejectOfferUseCase`, alcanzables
      desde el enlace de la oferta de reasignación.
- [ ] C.7 **Evidencia en pantalla**: pedir código de acceso, entrar con el código
      del log, ver el turno propio, cancelarlo dentro de la ventana, y confirmar
      que el intento fuera de ventana se rechaza con el mensaje correcto.

---

## Fuera de alcance, explícito

`ActivateStaffUseCase` y `ResetPasswordUseCase` (alta y reseteo de personal) se
dejan sin interfaz a propósito: el alta de personal la hace el seed, y en un
local de tres barberos el reseteo se resuelve hablando. No son parte de la demo.
