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
- [ ] A.6 Cablear `appointment.reminder` y encolarlo desde el camino de
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

- [ ] E.1 `MarkBarberAbsentController` detecta los turnos afectados pero
      **nunca llama a `GenerateAbsenceReassignmentOffers`**. Su propio comentario
      explica por qué: cuando se escribió no existía un
      `NotificationOutboxRepository` de producción, así que componer el paso de
      ofertas habría significado descartar en silencio el "MUST notificar al
      cliente" o fabricar un adaptador falso. **El slice A ya cerró ese hueco**,
      así que el bloqueo desapareció: marcar un barbero ausente tiene que generar
      las ofertas y despacharlas.
- [ ] E.2 (era A.6) `ScheduleAppointmentReminder` no se encola desde el camino de
      confirmación, así que **ningún turno agenda su recordatorio de 2h**. Toca
      `packages/application` y `apps/api`.
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
