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

- [x] A.1 Migración `0011`: tabla `notification_outbox` (`notification_type`,
      `recipient_email`, `payload jsonb`, `attempts`, `status`, `last_error`,
      `created_at`). Aplicada y verificada contra Postgres real.
      - Verificado 2026-08-18 contra el Postgres real de `cablear-a-pg` (puerto
        5442): `DATABASE_URL=...5442... pnpm db:migrate` → "migrations applied
        successfully"; `\dt` confirma la tabla con sus 9 columnas (incluye
        `next_attempt_at`, el timestamp de backoff que el enunciado no lista
        pero que la implementación necesita).
- [x] A.2 RED (Testcontainers): `pickPendingForDelivery` toma una fila pendiente
      y no la vuelve a entregar en la misma tanda; `markDelivered`/`markFailed`
      dejan el estado correcto; el backoff respeta `attempts`.
      - Verificado 2026-08-18: historia real RED→GREEN en el branch (commit
        `964a314` RED, `93322a0` GREEN), re-ejecutada ahora en limpio —
        `pnpm --filter @jc-barberia/infrastructure exec vitest run
        src/notifications/notification-outbox.repository.spec.ts` → 6/6 tests
        verdes contra un Postgres real levantado por Testcontainers (93.9s).
- [x] A.3 GREEN: `DrizzleNotificationOutboxRepository`.
      - Misma corrida que A.2 — GREEN real, no el fake de dominio.
- [x] A.4 Cablear `NotificationOutboxConsumer` en `apps/worker` con el adaptador
      real y `createNotificationPort` (Gmail o console según config).
      - Verificado 2026-08-18 en vivo: worker real contra Postgres real
        entregó un mensaje y lo marcó `delivered` en la tabla. Ver evidencia
        completa de A.7 más abajo — misma corrida.
- [x] A.5 Cablear el handler `hold.expire` (`ExpireHold` + `RefundUseCase` +
      notificación). Hoy la cola existe pero nadie la consume.
      - Verificado 2026-08-18 en vivo, las 3 ramas alcanzables sin credenciales
        reales de MercadoPago: hold simple sin origen → `no-op`; hold de oferta
        con turno origen sin seña → `cancelled-no-refund` (el turno origen
        pasa a `cancelado` de verdad en la base); hold de oferta con seña
        `settled` simulada → el adaptador hace el POST real a
        `api.mercadopago.com/v1/payments/.../refunds`, recibe un 404 real (sin
        `MERCADOPAGO_ACCESS_TOKEN` no hay cuenta que consultar), y el error se
        propaga fuerte tal como documenta `refund.ts` ("Lost payments must be
        loud") — pg-boss reintenta y el job termina en `failed` tras agotar
        `retry_limit`. La rama `refunded-and-notified` (la única que dispara
        la notificación de cancelación) NECESITA un refund exitoso contra
        MercadoPago real: bloqueo de credenciales de entorno, no un defecto de
        este slice. Ver evidencia completa en A.7.
- [x] A.6 Cablear `appointment.reminder` y encolarlo desde el camino de
      confirmación, vía `ScheduleAppointmentReminder`.
      - Consumidor cableado y verificado (worker registra y consume la cola —
        ver A.7). El productor —encolar desde `CreatePhoneAppointmentUseCase`/
        `ProcessPaymentUseCase`— sigue sin ningún llamador real: requiere
        tocar constructores en `packages/application` y su wiring de DI en
        `apps/api` (`appointments.module.ts`/`payments.module.ts`), ninguno de
        los dos en la lista de archivos que este slice puede tocar. Gap
        explícito, igual que lo dejó el commit anterior (`9bcace7`) — no se
        repite el error de marcarlo hecho.
- [ ] A.7 **Evidencia en pantalla**: reservar un turno, forzar el vencimiento del
      hold, y ver el mail salir por el canal `console` en el log del worker.
      - **Verificado 2026-08-18, con un límite real y documentado — no se
        cierra completo.** Stack real: `cablear-a-pg` (Postgres 16, puerto
        5442, contenedor reusado de la sesión anterior), API real en :3001,
        worker real, canal `console`. Secuencia real por HTTP: login
        (`POST /auth/staff-login`) → `POST /holds` (hold simple) → forzado su
        `start_after` → log real: `[worker] hold.expire <id> -> no-op`
        (correcto: un hold sin turno origen no tiene nada que reembolsar).
        `POST /appointments/phone` (turno origen real, sin seña) → `POST
        /holds` (hold de oferta) → vinculado a ese origen (`UPDATE
        origin_occupancy_id`, porque `GenerateAbsenceReassignmentOffers` —la
        única pieza real que arma ese vínculo— no tiene endpoint en
        `apps/api`, mismo gap que A.6) → forzado su `start_after` → log real:
        `[worker] hold.expire <id> -> cancelled-no-refund`, turno origen
        confirmado `cancelado` en la base. Para la rama que sí notifica
        (`refunded-and-notified`) hace falta un refund `settled` exitoso
        contra MercadoPago real — bloqueado por falta de
        `MERCADOPAGO_ACCESS_TOKEN` en este entorno (ver A.5): el intento real
        contra `api.mercadopago.com` devolvió 404 real, no una simulación.
        Para probar el tramo de DESPACHO (A.3/A.4) igual, se insertó una fila
        realista en `notification_outbox` (mismo payload que
        `GenerateAbsenceReassignmentOffers.notifyClient` produciría, mismo gap
        de endpoint) y el consumer real la entregó al minuto:
        `[notifications] to=cliente-demo-slicea@jcbarberia.test
        template=absence_reassignment_offer data={...}` seguido de
        `[worker] notification_outbox.consume delivered=1 failed=0`; la fila
        quedó `delivered` en Postgres. Conclusión: cada pieza individual
        (booking real, expiración forzada real, consumer+adaptador real) está
        probada en vivo; la única cadena causal que el enunciado pide entera
        —expiración de hold → reembolso real → notificación— no se pudo cerrar
        de punta a punta porque ese reembolso necesita una cuenta real de
        MercadoPago que no existe en este entorno. No es un test verde
        disfrazado de hecho: es exactamente lo que sí y lo que no funciona,
        dicho en claro.

## Slice B: Panel — acciones sobre el turno

Hoy la agenda del día se ve, pero **no se puede hacer nada sobre un turno**.

- [x] B.1 Endpoints de `AdminMarkCompletedUseCase` y `AdminConfirmAbsenceUseCase`,
      con `@RequiresPermission`. Cierra la deuda de la tarea 10.11.
      - `AppointmentActionsController` (`apps/api/src/appointments/appointment-actions.controller.ts`),
        commits `2f8e095` (RED, 14 casos) / `cd10eaa` (GREEN). 14/14 tests
        de `apps/api/test/appointment-actions.spec.ts` verdes (re-ejecutado
        2026-08-18, Nest real + fakes).
      - Verificado 2026-08-18 contra Postgres real (`cablear-b-pg`, puerto
        5443): login real como `dueno@jcbarberia.test` → `POST
        /appointments/562f5fe9.../mark-completed` → 200, `status:"realizado"`;
        confirmado con `SELECT` directo contra `slot_occupancies`. Mismo turno
        real usado para B.7 más abajo.
- [x] B.2 Endpoints de `BarberMarkCompletedUseCase` y `BarberConfirmAbsenceUseCase`
      (acotados por `actor.barberId`). Los use cases existen desde la 11.13 y
      nunca tuvieron ruta.
      - Mismos commits que B.1; el dispatch admin/barbero vive en el mismo
        controller y se decide por `actor.barberId`, nunca por `actor.role`.
      - Verificado 2026-08-18 contra Postgres real: login como
        `cristian@jcbarberia.test` → `mark-completed` sobre turno propio → 200;
        sobre turno de `facundo@jcbarberia.test` → 403 "No podés resolver un
        turno de otro barbero." y `SELECT` confirma que la fila del colega
        sigue en `reservado` (ninguna escritura). `confirm-absence` probado
        igual: propio → 200 `ausente`; ajeno → 403 sin escritura.
- [x] B.3 Endpoint de `EditAppointmentUseCase` (servicio, barbero, horario).
      - Verificado 2026-08-18 contra Postgres real: `PUT
        /appointments/8aa6f9a3.../` con nuevo horario (18:00-18:30 local) →
        200, `startsAt` recalculado a UTC correctamente (21:00 UTC).
- [x] B.4 Endpoint de `AdminCancelAppointmentUseCase`.
      - Verificado 2026-08-18 contra Postgres real: `POST
        /appointments/57f35a1c.../cancel` → 200, `status:"cancelado"`.
- [x] B.5 Endpoint de `CreateWalkInUseCase`.
      - Verificado 2026-08-18 contra Postgres real: `POST /appointments/walk-in`
        → primer intento 409 (horario ocupado por un hold real, con las
        alternativas reales devueltas por el servidor); reintento en un hueco
        libre → 201, `channel:"walk_in"`, `status:"realizado"` directo, sin
        pasar por `reservado`.
- [x] B.6 Acciones en `DayBoard`: los botones que hoy están montados y muertos
      pasan a llamar a los endpoints de arriba, respetando el `allowedActions`
      que el servidor ya calcula (tarea 8.3/8.4).
      - `AdminDayBoardPanel`/`BarberDayBoardPanel` (`apps/web/src/agenda/`),
        commits `970b192` (RED) / `d972a1b` (GREEN) / `c906759` (rescate:
        `AdminDayBoardPage`/`BarberDayBoardPage` ahora renderizan estos paneles
        en vez del container "no wireado" de la fase 8). Ninguno de los dos
        containers de fase 8/11 fue tocado — siguen siendo forwarders puros.
      - 10/10 tests de panel verdes (`AdminDayBoardPanel.spec.tsx`,
        `BarberDayBoardPanel.spec.tsx`), con `fireEvent.click` sobre el árbol
        real de componentes de producción (incluye `EditAppointmentForm` y
        `WalkInForm` reales, no stubs); solo `apiGet/apiPost/apiPut` están
        mockeados. Reejecutado 2026-08-18: 27/27 tests de `apps/web/src/agenda`
        verdes en corrida limpia (una falla por timeout en la corrida con
        varios jobs en paralelo resultó ser contención de CPU, no un bug:
        el mismo archivo pasa 3/3 en solitario).
      - `pnpm typecheck`, `pnpm lint` y `pnpm depcruise` verdes en todo el
        workspace (verificados 2026-08-18, no asumidos).
- [ ] B.7 **Evidencia en pantalla**: entrar como dueño, marcar un turno realizado,
      editar otro, cancelar un tercero, y cargar un walk-in. Luego entrar como
      barbero y confirmar que solo puede resolver los propios.
      - Sin marcar a propósito: este agente no tiene una herramienta de
        automatización de navegador (no hay Playwright/Puppeteer/computer-use
        disponible en este entorno), así que no puede probar el click físico
        sobre el DOM renderizado — el propio criterio de aceptación de este
        tracker dice explícitamente que curl no alcanza para cerrar esta
        tarea, y no quiero declarar hecho algo que no pude ejecutar.
      - Lo que SÍ se hizo, como evidencia parcial verificable (2026-08-18,
        contra `cablear-b-pg` puerto 5443, API real en :3002, web real en
        :5175, exactamente el mismo camino de red que usaría el navegador —
        mismo `Access-Control-Allow-Origin: http://localhost:5175`, misma
        cookie de sesión `HttpOnly`, mismo proxy de Vite):
        1. Owner (`dueno@jcbarberia.test`): login real → `mark-completed` sobre
           un turno real de Cristian (200, `realizado`) → `edit` sobre otro
           (200, horario recalculado) → `cancel` sobre un tercero (200,
           `cancelado`) → `walk-in` (409 en el primer horario ocupado con
           alternativas reales, 201 en un hueco libre).
        2. Barbero (`cristian@jcbarberia.test`): login real → `mark-completed`
           sobre turno propio (200) → sobre turno de Facundo (403, "No podés
           resolver un turno de otro barbero.", sin escritura) →
           `confirm-absence` propio (200, `ausente`) → ajeno (403, sin
           escritura).
        3. Cada paso se confirmó con `SELECT` directo contra `slot_occupancies`
           en Postgres, no solo con la respuesta HTTP.
      - Lo que esto NO prueba: que el botón exacto en el DOM renderizado, al
        recibir un click real, dispare esta misma llamada. Esa parte queda
        cubierta indirectamente por los tests de B.6 (`fireEvent.click` sobre
        los componentes de producción reales) pero no por una sesión de
        navegador real. Falta un agente con herramienta de navegador (o un
        humano) para el paso final de click-through antes de cerrar esta
        tarea con confianza total.

## Slice C: Cliente — autogestión

El cliente puede reservar y pagar, pero **no puede volver a entrar ni cancelar**.

- [x] C.1 Endpoint de `RequestClientAccessUseCase` (`@Public()`).
- [x] C.2 Endpoint de `ClientLoginUseCase` (`@Public()`), que emite la sesión de
      cliente vía `SessionService` con el TTL de 30 días de la tarea 3a.19.
- [x] C.3 Página "Mi cuenta": el cliente autenticado ve sus turnos.
- [x] C.4 Endpoint de `SelfCancelAppointmentUseCase`, acotado al `clientId` de la
      sesión, nunca al que venga en el body.
- [x] C.5 Botón de cancelar en "Mi cuenta", que respeta la ventana de 1h y
      muestra el instante de corte cuando la rechaza.
- [x] C.6 Endpoints de `AcceptOfferUseCase` y `RejectOfferUseCase`, alcanzables
      desde el enlace de la oferta de reasignación.
      - `OffersController` (`apps/api/src/absence-reassignment/offers.controller.ts`),
        commit `0f78d90`. 8/8 tests de `apps/api/test/offers.spec.ts` verdes.
        La identidad sale de `@RequiresClientSession()`/`@CurrentClient()` y la
        pertenencia se verifica contra el hold de la oferta ANTES de invocar
        ningún caso de uso: inexistente, ajena, vencida y no-oferta responden
        todas lo mismo, para no ser un oráculo de enumeración.
      - Verificado 2026-08-19 sobre el stack del usuario: la API arranca con
        `Mapped {/api/account/offers/:holdId/accept, POST}` y `.../reject`.
- [x] C.7 **Evidencia en pantalla**: pedir código de acceso, entrar con el código
      del log, ver el turno propio, cancelarlo dentro de la ventana, y confirmar
      que el intento fuera de ventana se rechaza con el mensaje correcto.
      - Verificado 2026-08-19 clickeando en Chrome contra el Postgres real del
        proyecto (5432), API real y web real. Secuencia: `/acceder` → "Pedir
        código" con el teléfono de un cliente real → el código se leyó de
        `notification_outbox` → "Ingresar" → **la app navegó sola a
        `/mi-cuenta`** → se vio el turno propio (`reservado 11:00`, en hora del
        local) → clic en "Cancelar" → mensaje "Turno cancelado" y `SELECT`
        directo confirmando `slot_occupancies.status = 'cancelado'`.
        La no-divulgación se mantiene: pedir código responde igual esté o no
        registrado el teléfono.
      - Rama fuera de ventana: NO ejercitada desde la pantalla (haría falta un
        turno a menos de 1h). El caso está cubierto por los tests de
        `account.spec.ts`, no por un click.

---

## Fuera de alcance, explícito

`ActivateStaffUseCase` y `ResetPasswordUseCase` (alta y reseteo de personal) se
dejan sin interfaz a propósito: el alta de personal la hace el seed, y en un
local de tres barberos el reseteo se resuelve hablando. No son parte de la demo.

---

## Slice D: Las dos secciones de verdad

La pantalla actual es un **arnés de verificación**, no la aplicación: un solo menú
con los enlaces de cliente, dueño, barbero y secretaria mezclados, sin estilos.
Se especificó así a propósito para comprobar el cableado, y no sirve para
mostrarle el sistema a nadie.

Son **dos aplicaciones distintas**, y así se construyen.

### Qué ve cada uno — derivado de la matriz ya sembrada en la migración 0006

**Cliente** (no tiene rol; no aparece en `role_permissions`): sitio público.
Reservar, pagar la seña, pedir código de acceso, ver sus turnos, cancelar dentro
de la ventana. **Nunca ve el panel ni sabe que existe.**

**Barbero** — `agenda:read:own` · `appointment:mark-completed:own` ·
`finance:read:own`: su agenda del día, resolver sus propios turnos, su
facturación teórica. Nada de otros barberos, nada de la facturación del local.

**Secretaria** — todo lo del dueño MENOS `finance:read:shop`, `barber:manage`,
`pricing:configure` y `schedule:configure`: agenda completa, crear/editar/cancelar
turnos, marcar realizado cualquiera, marcar barbero ausente, gestionar clientes,
walk-ins. **Sin plata, sin alta de barberos, sin precios ni horarios.**

**Dueño** — la matriz completa, incluida la facturación del local.

- [x] D.1 Separar en dos áreas: sitio público (`/`) y panel (`/panel`). El panel
      exige sesión; sin ella redirige al login, nunca muestra la pantalla vacía.
      (`shared/router.tsx`, `layout/panel-guard.ts` + `.spec.ts`, `App.tsx`.)
- [x] D.2 Layout e identidad visual de barbería para el sitio público. Sin
      framework de CSS pesado; prolijo, legible en celular, que parezca un
      negocio real y no una lista de enlaces. (`styles/tokens.css`,
      `layout/PublicLayout.*`, `pages/HomePage.*`, `pages/BookingPage.*`,
      `pages/StaffLoginPage.*`.) Continuado a las seis pantallas del panel que
      todavía no tenían CSS propio — ver nota de esta vuelta más abajo.
- [x] D.3 Layout del panel con navegación **construida desde los permisos del
      actor**, no desde el rol hardcodeado: cada ítem aparece solo si el actor
      tiene el permiso que la ruta exige. Un barbero no ve el ítem de facturación
      del local; la secretaria no ve el de precios. (`layout/PanelLayout.*`,
      `layout/nav-items.ts` + `.spec.ts` — matriz completa probada por rol.)
- [x] D.4 Sacar del sitio público todo rastro del panel: enlaces, rutas y textos.
      (`PublicLayout.spec.tsx` lo prueba explícitamente: sin enlaces a `/panel`,
      sin la palabra "panel" en ningún texto visible.)
- [x] D.5 Arreglar el estado inicial de `AvailabilityPicker`: hoy dice "No hay
      horarios disponibles" **antes de que el visitante busque**, lo que hace
      parecer que el local no tiene lugar nunca. Debe distinguir "todavía no
      buscaste" de "buscaste y no hay". Resuelto en `pages/BookingPage.tsx`
      (`hasSearched`), no en `AvailabilityPicker` mismo (`booking/`, fuera de
      esta slice): la página no monta `BookingFlowContainer` hasta que hubo una
      búsqueda real. `pages/BookingPage.spec.tsx` (D.5) prueba los tres casos.
- [x] D.6 **Evidencia en pantalla**: recorrer el sitio público como visitante sin
      ver nada del panel; entrar al panel como dueño, como secretaria y como
      barbero, y mostrar que la navegación de cada uno es distinta y coherente
      con la matriz.

---

## Slice E: Cerrar los productores que quedaron mudos

Detectado al verificar el slice A contra Postgres real. Dos casos de uso
existen, están probados y **nadie los invoca**, así que su funcionalidad está
muerta desde la pantalla aunque el código esté escrito:

- [x] E.1 `MarkBarberAbsentController` detecta los turnos afectados pero
      **nunca llama a `GenerateAbsenceReassignmentOffers`**. Su propio comentario
      explica por qué: cuando se escribió no existía un
      `NotificationOutboxRepository` de producción, así que componer el paso de
      ofertas habría significado descartar en silencio el "MUST notificar al
      cliente" o fabricar un adaptador falso. **El slice A ya cerró ese hueco**,
      así que el bloqueo desapareció: marcar un barbero ausente tiene que generar
      las ofertas y despacharlas.
      - Cableado en el commit `0f78d90` (rescate del trabajo que el agente dejó
        sin commitear al cortarse su sesión). 6/6 tests de
        `apps/api/test/mark-barber-absent.spec.ts` verdes.
- [x] E.2 (era A.6) `ScheduleAppointmentReminder` no se encola desde el camino de
      confirmación, así que **ningún turno agenda su recordatorio de 2h**. Toca
      `packages/application` y `apps/api`.
      - Cableado en los dos caminos de confirmación (turno telefónico y pago
        acreditado), commits `1933066`/`982bdd0` y `fae69cc`/`12e060b`.
      - **Verificado 2026-08-19 desde la pantalla**, primera vez que este
        productor dispara: turno telefónico cargado desde el panel como dueño
        (`6cd9b5ae`, 21/08 11:00 hora del local = `14:00+00`) y
        `select name, data, start_after from pgboss.job where
        name='appointment.reminder'` devuelve `start_after =
        2026-08-21 12:00:00+00` — exactamente 2 horas antes del turno.
- [ ] E.3 **Evidencia en pantalla**: marcar un barbero ausente desde el panel y
      ver la oferta salir por el log del worker; confirmar un turno y ver el job
      `appointment.reminder` encolado con su `start_after` correcto.

**Bloqueado por credenciales, no por código** (era A.7): la cadena completa
"vence el hold → reembolso real de MercadoPago → notificación" no se puede
probar sin un `MERCADOPAGO_ACCESS_TOKEN` de prueba. El slice A lo comprobó en
vivo: la llamada sale de verdad a `api.mercadopago.com` y vuelve 404 porque no
hay token. `ExpireHold` solo notifica en la rama `refunded`, que exige un
reembolso exitoso. Se cierra cuando el usuario cargue el token de prueba.
      con la matriz. Hecho contra Postgres real (puerto 5445), API real (3004)
      y web real (5177) — ver el reporte de esta vuelta para el detalle
      pantalla por pantalla y las llamadas HTTP reales de cada rol.

---

## Slice F: El viaje real del cliente — pagar, volver, recibir el mail

Detectado al auditar el flujo completo desde el teléfono (dueño): el cliente
paga y no pasa nada. Tres huecos independientes, todos en el mismo camino:

- [x] F.1 Plantilla y disparo de `booking_confirmed`. `NotificationTemplate`
      no tenía ningún evento para "tu turno quedó confirmado" — un cliente que
      pagaba no recibía nada. Agregado a `packages/domain/src/notifications/notification-port.ts`,
      con su plantilla (`packages/infrastructure/src/notifications/templates/booking-confirmed.template.ts`,
      cableada en el registry) y su disparo en `ProcessPaymentUseCase`
      (`packages/application/src/payments/process-payment.ts`), en la MISMA
      rama `outcome === 'confirmed'` y por la MISMA razón que ya agenda el
      recordatorio de 2h: un webhook reintentado (`already-processed`) nunca
      dispara un segundo mail. Escribe al outbox real vía
      `NotificationOutboxRepository`, igual que `GenerateAbsenceReassignmentOffers`
      — nunca `NotificationPort` directo. TDD real: RED en `27fd48d` (tests
      contra fakes: barbero/servicio/hora, sin email no encola, retry no
      duplica), GREEN en `1e20150`.
      - Verificado 2026-08-19 contra Postgres real (`cablear-a-pg`, puerto
        5442): reservé un hold real (`POST /holds`, `POST /holds/confirm`)
        con cliente y email reales, y corrí `ProcessPaymentUseCase` con los
        repos Drizzle reales (deposits/appointments/outbox/clients/barbers/services)
        contra esa base — el único componente sustituido fue el propio
        `PaymentPort.getPayment` (ver F.2 para por qué: no hay credencial de
        MercadoPago en este entorno). `SELECT` directo confirma
        `slot_occupancies.status = 'reservado'` y una fila real en
        `notification_outbox`: `{"barberName":"Cristian Gómez","serviceName":"Corte
        clásico","appointmentId":"7e1950b8-...","appointmentTime":"2026-08-20T12:00:00.000Z"}`.
        El worker REAL (ya corriendo, canal `console`) la recogió en su
        siguiente tick y la marcó `delivered` — confirmado de nuevo con
        `SELECT`. Cuerpo renderizado (vía la plantilla real, `ShopClock`
        real): hora mostrada **09:00** para un turno a las 12:00 UTC (offset
        -03:00 correcto, nunca la hora UTC cruda):
        ```
        Confirmamos tu turno en JC Barberia.

        Barbero: Cristian Gómez
        Servicio: Corte clásico
        Fecha: 2026-08-20
        Hora: 09:00

        Ya pagaste la seña. El resto del precio se paga en el local, el dia del turno.
        ```
- [x] F.2 `back_urls` / `auto_return` / `notification_url` en la preferencia de
      MercadoPago. Sin esto MercadoPago nunca redirige al cliente de vuelta ni
      llama a nuestro webhook — el turno queda `held` para siempre aunque el
      pago se haya acreditado. `MercadoPagoPaymentAdapter` (`packages/infrastructure/src/payments/mercadopago-payment.adapter.ts`)
      toma un tercer parámetro opcional `publicBaseUrl` (default `undefined`,
      cero cambio de comportamiento sin configurar); `BookingModule`
      (`apps/api/src/booking/booking.module.ts`, el único módulo cuyo
      `PAYMENT_PORT` llega a `createPreference` vía `CheckoutUseCase`) lo
      pasa desde `process.env.PUBLIC_BASE_URL`. TDD real: RED en `10ae8ec`,
      GREEN en `43cda87`.
      - Verificado 2026-08-19 con tests reales (no simulados): con
        `PUBLIC_BASE_URL` configurado, el body de `createPreference` lleva
        `back_urls` apuntando a `/pago/retorno?estado=success|pending|failure`,
        `auto_return:"approved"` y `notification_url` a
        `/api/webhooks/mercadopago`; sin configurar, los tres campos se
        omiten — nunca se manda una URL localhost (MercadoPago la rechaza,
        confirmado contra la documentación oficial vía Context7:
        "Do not use local domains like localhost... these will cause
        errors").
      - Verificado 2026-08-19 contra el flujo real: `POST /holds/checkout`
        real (sin `PUBLIC_BASE_URL` ni `MERCADOPAGO_ACCESS_TOKEN` en este
        entorno) devuelve `500`, y el log de la API real muestra la llamada
        HTTP real a `api.mercadopago.com` volviendo `403
        PA_UNAUTHORIZED_RESULT_FROM_POLICIES` — el mismo bloqueo de
        credenciales que A.5/A.7 ya documentaron, no un defecto de este
        slice. `beginCheckout` sí deja el estado real en la base
        (`held`/`payment_pending=true`), confirmado con `SELECT`.
- [x] F.3 Página pública `/pago/retorno`, adonde apuntan los `back_urls`.
      Nueva (`apps/web/src/pages/PaymentReturnPage.tsx`, ruteada en
      `apps/web/src/App.tsx`'s `renderPublicRoute`). Honesta a propósito: con
      `estado=success` NUNCA dice "turno confirmado" (design.md: "el redirect
      del navegador no es fuente de verdad" — el webhook puede llegar
      después), solo que el pago se recibió y que el mail de confirmación
      (F.1) llega en unos minutos; con `pending`/`failure`/desconocido cada
      uno con su propio mensaje, nunca inventando un resultado. Ofrece un
      enlace real a "Mi cuenta". TDD real: RED en `dd704c9`, GREEN en
      `652dff0`.
      - Verificado 2026-08-19 en un navegador real (Chrome, pestaña propia en
        el puerto 5175, nunca la 5173 del dueño): `/pago/retorno?estado=success`
        renderiza dentro del layout público real ("Recibimos tu pago" +
        el texto honesto); `estado=failure` renderiza "El pago no se pudo
        completar"; el enlace "Entrar a Mi cuenta" navega de verdad a
        `/acceder` (confirmado por la URL de la pestaña tras el click, no
        solo por el `href` en el DOM).
- [x] F.4 **Evidencia en pantalla — la cadena completa que se puede probar sin
      credenciales de MercadoPago real**: login no aplica (ruta pública) →
      `POST /holds` real → `POST /holds/confirm` real (cliente con email
      real) → `POST /holds/checkout` real (falla con 500, `403
      PA_UNAUTHORIZED_RESULT_FROM_POLICIES` real de MercadoPago, sin
      credenciales) → `beginCheckout` deja el hold real en
      `held`+`payment_pending` (SQL) → el pago aprobado se simula SOLO en el
      punto donde no hay alternativa (`PaymentPort.getPayment`, ver F.1) →
      `reservado` real + `booking_confirmed` real `pending` → worker real lo
      entrega → `delivered` real. Aparte, el webhook HTTP se probó de punta a
      punta por su cuenta, con un `payment_id` inventado (ya que no hay
      credencial real para generar uno de verdad): firma HMAC real calculada
      (`ts=...,v1=...`) → `POST /api/webhooks/mercadopago` real → `200
      {"received":true}` → job real encolado en `pgboss.job` → worker real lo
      toma → `getPayment` real contra `api.mercadopago.com` → `404 resource
      not found` real, job `failed` con el stack real guardado en
      `pgboss.job.output`. Firma inválida sigue rechazada con `401` (la
      validación no se debilitó). `/pago/retorno` verificada en Chrome (ver
      F.3).
      - **No se pudo probar, y no se fingió**: el round-trip real
        "MercadoPago aprueba el pago → redirige al navegador → llama al
        webhook con datos reales" necesita una cuenta de prueba real de
        MercadoPago (`MERCADOPAGO_ACCESS_TOKEN`/`MERCADOPAGO_WEBHOOK_SECRET`
        de un panel real) que no existe en este entorno — igual que A.5/A.7.
        Ninguna fila de `notification_outbox` ni de `slot_occupancies` fue
        insertada a mano: todo lo verificado arriba salió de correr el código
        de producción real contra Postgres real, sustituyendo únicamente la
        llamada de red a MercadoPago donde no había forma de evitarlo.

### Esta vuelta (continuación tras corte de sesión)

D.1-D.5 ya estaban resueltos y probados en los 6 commits previos de
`d-secciones-cont`; lo que faltaba de verdad era: (a) las seis pantallas del
panel sin CSS propio (`AdminDayBoardPage`, `BarberDayBoardPage`,
`PhoneAppointmentPage`, `RevenuePage`, `ShopRevenuePage`, `AccessCodePage`) y
(b) la evidencia en vivo (D.6). Hecho en esta vuelta:

- `pages/DayBoardPage.css` (nueva, compartida por Admin/BarberDayBoardPage):
  `DayBoard` (agenda/, fuera de esta slice) renderiza `<section>`/`<ul>`/`<li>`
  sin ninguna clase propia — igual que los tags de formulario que
  `tokens.css` ya documentaba — así que se estiliza por selector descendiente
  bajo `.day-board`, el div que cada página agrega alrededor del contenedor.
- `pages/PhoneAppointmentPage.css` (nueva): el formulario de 9 campos de
  `PhoneAppointmentForm` (appointments/, fuera de esta slice) se estiraba
  hasta el ancho completo del panel (1200px); acotado a 480px desde la
  página.
- `pages/RevenuePage.css` (nueva): `RevenueSummary` (barbers/, fuera de esta
  slice) no tenía envoltorio visual; ahora vive dentro de `.card` con el
  monto como titular.
- `ShopRevenuePage`/`AccessCodePage` ya usaban `.panel-page`/`.empty-state`/
  `.card`/`.container` (definidos en `tokens.css`) — se verificaron en vivo,
  sin cambios de código.
- D.6 ejecutado contra Postgres real en el puerto 5445 (nunca 5432), API en
  3004, web en 5177 — login real de las tres cuentas de seed, llamadas HTTP
  reales a endpoints protegidos por permiso, confirmando que la agenda del
  barbero llega ya filtrada a una sola columna desde el servidor (no solo
  desde el cliente).

---

## Slice G: Paneles usables y turno telefónico operable

Detectado por el dueño mientras probaba la app en vivo (rama
`feat/paneles-y-turno-telefonico`, sobre `feat/turnero-integracion`). Cuatro
gaps de producto reales, no de dominio:

- [x] G.1 **El day board no mostraba nada útil**. `DayBoardSlot`
      (`packages/contracts/src/agenda.ts`) ya declaraba `clientName`/
      `clientAge`, pero su propio comentario decía que `GetDayBoardUseCase`
      los dejaba siempre `undefined` — escrito cuando la tabla `clients`
      todavía no existía. Tampoco había `serviceName`: el slot traía
      `serviceId` pero ningún nombre. `DrizzleDayBoardRepository`
      (`packages/infrastructure/src/agenda/day-board.repository.ts`) suma un
      `innerJoin` real a `services` (todo slot tiene uno) y un `leftJoin` a
      `clients` (`NULL` hasta que el turno está vinculado); `GetDayBoardUseCase`
      pasa `serviceName`/`clientName`/`clientAge` sin condición y
      `clientPhone` **solo** cuando el actor tiene `client:manage` (dueño o
      secretaria) vía `RolePermissionRepository` — nunca hardcodeado por rol,
      nunca en el navegador. Un barbero ve el mismo nombre/edad de cliente
      que la secretaria, pero nunca el teléfono. `DayBoard.tsx` (compartido
      por `AdminDayBoardPanel` y `BarberDayBoardPanel` vía sus containers)
      ahora muestra hora local del comercio (`utcIsoToShopLocalTime`, nunca
      un slice del ISO crudo), servicio, estado, cliente y teléfono cuando
      llega. TDD real: RED en `12b4527`, GREEN en `891c12f`.
- [x] G.2 **Verificación real de los tres paneles** — ver evidencia abajo.
- [x] G.3 **Barbero y Servicio eran texto libre con una tarjeta de UUIDs al
      lado para copiar a mano** (`PhoneAppointmentForm.tsx`,
      `PhoneAppointmentPage.tsx`) — un arnés de desarrollador, no algo
      operable con un cliente esperando al teléfono. Ahora son `<select>`
      reales sobre `DEMO_BARBERS`/`DEMO_SERVICES` (los mismos que
      `BookingPage` ya usa — sin fetch nuevo, no hay endpoint que liste
      barberos/servicios), con el precio incluido en el nombre del servicio
      igual que la pantalla de reserva. `Fecha` pasa de texto libre
      `YYYY-MM-DD` a `input type="date"`. La tarjeta de referencia
      desaparece junto a su CSS muerto (`tokens.css`). TDD real: RED en
      `fbbf6d2`, GREEN en `fc2b2fa`.
- [x] G.4 **La secretaria tenía que escribir `Hora de fin` a mano.**
      `CreatePhoneAppointmentRequestSchema` la exigía, pero esa duración es
      una propiedad del servicio que ya eligió, no algo que ella calcule —
      pedírsela habilita turnos cuya duración contradice su servicio.
      `endTime` pasa a opcional en el contrato; `CreatePhoneAppointmentUseCase`
      recibe un `ServiceRepository` y un `Clock`, busca el `Service` por
      `serviceId` y computa `timeRange.end = clock.addMinutes(startsAt,
      service.durationMinutes)` — nunca confía en un `endTime` del llamador.
      Un `serviceId` inexistente lanza `PhoneAppointmentServiceNotFoundError`,
      que el controller traduce a 400 en vez de romper con 500.
      `PhoneAppointmentForm` ya no tiene campo de hora de fin. Deriva
      server-side, la opción más fuerte de las dos que planteaba la tarea (la
      alternativa — derivarla en el formulario a partir de la duración del
      servicio — habría dejado la garantía dependiendo de que el frontend no
      se rompa; server-side ningún llamador puede eludirla). TDD real: RED en
      `dcc6de7`, GREEN en `43eaf6b`.

**G.2 — evidencia en pantalla, contra Postgres real (puerto 5442), API en
3001, web en 5175**:

- Cliente real por **reserva web**: `/reservar` → Cristian Gómez, Corte
  clásico, 2026-08-24 10:00 → cuenta creada al confirmar (Marcos Rivero,
  3511112222, marcos.rivero@example.com, 29) → "Pagar la seña" devuelve
  `Internal server error` real (sin `MERCADOPAGO_ACCESS_TOKEN` real en este
  entorno — el mismo bloqueo que A.5/A.7/F.4 ya documentaron, no un defecto
  de esta slice). Confirmado con SQL: la fila queda `status='held'`,
  `payment_pending=true` — nunca se fabricó un `reservado` a mano.
- Cliente real por **turno telefónico** (secretaria, `/panel/turno-telefonico`):
  Laura Fernandez, 3512223344, Cristian Gómez, Corte + Barba, 2026-08-24,
  hora de inicio 14:00, sin campo de hora de fin — "Turno creado ... estado
  reservado."
- **Dueño** (`dueno@jcbarberia.test`) y **secretaria**
  (`secretaria@jcbarberia.test`) en `/panel`, agenda del 2026-08-24: la
  columna de Cristian Gómez muestra `14:00-14:45 · Corte + Barba · reservado
  · Laura Fernandez · 3512223344` con los botones Editar/Cancelar/Marcar
  realizado — idéntico para ambos roles.
- **Barbero** (`cristian@jcbarberia.test`) en la misma fecha: una sola
  columna (la propia — ni Facundo ni Nahuel aparecen), mismo turno con
  `14:00-14:45 · Corte + Barba · reservado · Laura Fernandez`, **sin el
  teléfono** (`client:manage` no alcanza a `barber` en la migración 0006), y
  un solo botón, Marcar realizado (sin `appointment:update`/`:cancel`).
- **Gestión de clientes** (`/panel/gestion`, dueño y secretaria): la tabla
  `Nombre/Teléfono/Email/Edad` trae tanto a Marcos Rivero (reserva web, con
  email y edad) como a Laura Fernandez (turno telefónico, sin email) desde
  `GET /panel/clients` real.

**G.4 — prueba SQL directa** (acceptance bar de la tarea), contra
`jc_barberia_test` real:

```
SELECT so.id, b.name barber, s.name service, s.duration_minutes,
       c.name client, c.phone,
       lower(so.time_range) starts_utc, upper(so.time_range) ends_utc,
       EXTRACT(EPOCH FROM (upper(so.time_range)-lower(so.time_range)))/60 stored_minutes,
       so.status, so.channel
FROM slot_occupancies so
JOIN services s ON s.id = so.service_id
JOIN barbers b ON b.id = so.barber_id
LEFT JOIN clients c ON c.id = so.client_id
WHERE c.name = 'Laura Fernandez';

                  id                  |     barber     |    service    | duration_minutes |     client      |   phone    |     starts_utc      |      ends_utc       |   stored_minutes    |  status   |  channel
--------------------------------------+----------------+---------------+------------------+-----------------+------------+---------------------+---------------------+---------------------+-----------+------------
 46ca9cba-e68c-472e-937c-c0f87ffb5ad1 | Cristian Gómez | Corte + Barba |               45 | Laura Fernandez | 3512223344 | 2026-08-24 17:00:00 | 2026-08-24 17:45:00 | 45.0000000000000000 | reservado | telefonico
```

`stored_minutes` (45) coincide exactamente con `services.duration_minutes`
(45, "Corte + Barba") aunque la secretaria solo tipeó `14:00` como hora de
inicio — nunca escribió una hora de fin. `starts_utc`/`ends_utc` (17:00-17:45
UTC) son 14:00-14:45 en hora del comercio (UTC-3), lo mismo que muestran los
tres paneles.

**Suites ejecutadas por separado (nunca en paralelo con otras — la nota del
tracker sobre contención real bajo carga aplica también a `apps/web`, no
solo a `apps/api`), todas verdes**:
`packages/application` (`get-day-board.spec.ts` + `create-phone-appointment.spec.ts`,
17/17) · `packages/infrastructure` (`day-board.repository.spec.ts` contra
Testcontainers real, 5/5) · `apps/api` (`day-board.spec.ts` +
`barber-day-board-access.spec.ts` + `phone-appointment.spec.ts`, 10/10) ·
`apps/web` (specs de `agenda/` y `appointments/PhoneAppointmentForm`, 35/35).
`pnpm typecheck`, `pnpm lint` y `pnpm depcruise` verdes en todo el workspace.

**Abierto**: la confirmación real del pago web (MercadoPago aprueba →
`reservado` con seña) sigue bloqueada por la falta de credenciales reales de
prueba en este entorno, igual que en A.5/A.7/F.4 — no es un defecto
introducido ni corregido por esta slice.

## Slice H: Datos reales en vez de demo-data.ts

Reportado por el dueño probando la app en vivo: `apps/web/src/shared/demo-data.ts`
hardcodeaba barberos y servicios, con el precio horneado en el string de
display (`'Corte clásico ($8.000)'`). Ninguna de las tres pantallas que lo
importaban (`HomePage`, `BookingPage`, `PhoneAppointmentPage`) le preguntaba
nunca a la base. Consecuencia exacta que el dueño reportó: desactivó a
Facundo Díaz desde el panel y el sitio lo siguió listando y dejando
elegirlo (mostraba cero horarios porque `GetPublicAvailabilityUseCase` sí
respetaba la baja — la UI y la lógica estaban en desacuerdo); dio de alta a
"roberto carlos" y quedó invisible en todos lados; cambió un precio y el
sitio siguió mostrando el viejo.

- [x] H.1 **Dos endpoints públicos nuevos, `GET /barbers` y `GET /services`**
      (`@Public()`, sin `ActorContext`) — no existían, `AvailabilityController`
      solo servía `/availability`. `BarberRepository.list()`/
      `ServiceRepository.list()` ya existían en `packages/domain` con sus
      adaptadores Drizzle ya implementados y ya cableados en `BookingModule`
      (`BARBER_REPOSITORY`/`SERVICE_REPOSITORY`) — no hizo falta tocar
      dominio ni infraestructura, solo dos casos de uso finos:
      `ListPublicBarbersUseCase` (filtra `active`, la única regla — un
      barbero dado de baja nunca llega al visitante) y
      `ListPublicServicesUseCase` (pass-through: `Service` no tiene flag
      `active`). Controllers en
      `apps/api/src/booking/public-offerings.controller.ts`
      (`ListPublicBarbersController`/`ListPublicServicesController`, dos
      clases — cada una con su propio prefijo `barbers`/`services`, sin
      colisionar con las rutas `:barberId/...` que ya existían en ese mismo
      prefijo). Precio viaja como `priceCents` entero
      (`PublicServiceResponse`, `packages/contracts/src/booking.ts`) — nunca
      un string formateado. TDD real: RED en `18981a4`/`e2eed3e`, GREEN en
      `5d5708c`/`1336606`.
- [x] H.2 **Las cuatro pantallas que importaban `demo-data.ts` pasan a pedir
      los dos endpoints al montar** — `HomePage`, `BookingPage`,
      `PhoneAppointmentPage` (las tres nombradas en el reporte) y también
      `ManagementPage` (no nombrada explícitamente, pero tenía el mismo bug:
      es la pantalla donde el dueño da de baja un barbero y cambia precios,
      y sus tres selects — dar de baja, horarios, precios — también leían de
      `DEMO_BARBERS`/`DEMO_SERVICES`). Cada una maneja loading/error/vacío
      explícitos — nunca un formulario vacío silencioso. `priceCents` se
      formatea del lado del browser (`shared/money.ts`,
      `formatPriceArs`) con separador de miles armado a mano
      (`Math.round` + regex), no con `Number.prototype.toLocaleString()`:
      esa llamada está prohibida por `no-restricted-syntax` en
      `eslint.config.js` fuera de `ShopClock`/`FakeClock`, y el selector del
      ESLint no distingue el receptor — cualquier `.toLocaleString()` cae la
      regla. `PhoneAppointmentForm` no cambió de forma (`{id, name}`), solo
      quién le da los datos. `shared/demo-data.ts` y sus cuatro imports se
      borraron enteros. TDD real: rewire con specs reescritos en `1ce8d3c`
      (las cuatro páginas mockean `apiGet` por path en vez de datos fijos).

**Verificación real, contra Postgres real (puerto 5442), API en 3001, web en
5175** — el intento de abrir el navegador (`mcp__claude-in-chrome__*`) se
frenó ahí: la extensión reportó "Browser extension is not connected", así
que la prueba visual del punto 5 del criterio de aceptación (turno
telefónico con las mismas listas reales) no se hizo con captura de pantalla.
Se cae al fallback explícito de la consigna — `curl` más SQL directa —, sin
fabricar evidencia de pantalla que no se obtuvo:

```
POST /api/auth/staff-login  dueno@jcbarberia.test           → 200, role=owner
GET  /api/barbers  (antes)  → Cristian Gómez, Facundo Díaz, Nahuel Torres

POST /api/panel/barbers/<id-facundo>/deactivate              → {"deactivated":true}
GET  /api/barbers  (después) → Cristian Gómez, Nahuel Torres        (Facundo ya no está)

POST /api/panel/barbers  {"name":"Roberto Carlos", schedule:[...]}  → 201
GET  /api/barbers  (después) → ...Nahuel Torres, Roberto Carlos     (aparece)

PUT  /api/panel/services/<id-corte-clasico>/price  {"priceCents":950000} → {"configured":true}
GET  /api/services (después) → "Corte clásico", priceCents: 950000  (el nuevo precio)

GET  /api/availability?barberId=<id-facundo>&serviceId=...&date=2026-08-24
                                                               → {"slots":[]}
```

SQL directa (`jc_barberia_test`) confirma que `barbers.active=false` para
Facundo — la UI y `GetPublicAvailabilityUseCase` ahora están de acuerdo,
que era el reclamo original del dueño. `curl http://localhost:5175/api/barbers`
(a través del proxy de Vite, la misma ruta exacta que ve el browser) devuelve
idéntico JSON que `curl http://localhost:3001/api/barbers` directo — el
`VITE_API_ORIGIN` del proxy quedó bien apuntado.

**Suites ejecutadas por separado, todas verdes**: `packages/application`
(41/41 archivos, 198/198 tests, incluye `list-public-barbers.spec.ts` +
`list-public-services.spec.ts`) · `apps/api` (18/18 archivos, 119/119 tests,
incluye `public-offerings.spec.ts`) · `apps/web` (32/32 archivos, 138/138
tests, incluye `HomePage.spec.tsx`/`BookingPage.spec.tsx`/
`ManagementPage.spec.tsx`/`money.spec.ts` reescritos o nuevos).
`pnpm typecheck` (7/7 paquetes), `pnpm lint` (`eslint .`, sin hallazgos) y
`pnpm depcruise` (483 módulos, 1453 dependencias, sin violaciones) verdes en
todo el workspace.

**Nota de entorno, no de producto**: `apps/web`'s vitest suite fallaba por
completo antes de empezar (`Cannot find module './xhr-sync-worker.js'`,
jsdom) en este worktree — el archivo faltaba en el store de pnpm
(`node_modules/.pnpm/jsdom@25.0.1.../lib/jsdom/living/xhr/`), y faltaba
igual en los demás worktrees hermanos (`web-cliente`, `cuenta-cliente`),
confirmando que no era nada de esta rama. Se bajó el archivo puntual desde
el registry de npm y se copió a mano en el store local para poder correr la
suite; no se tocó nada fuera de ese archivo de jsdom.

**Abierto**: la verificación visual en navegador (paso 5 del criterio de
aceptación) no se completó porque la extensión de Chrome no está conectada
en este entorno — no es un defecto de este slice, es una limitación del
entorno de verificación. La secuencia curl+SQL de arriba prueba el mismo
camino de datos que el navegador vería (mismo proxy, misma respuesta).
