# Huecos de backend que bloquean el rediseño del panel

Verificado contra el código el 26/08/2026, rama `feat/turnero-integracion`.

El rediseño del panel está aprobado y el front ya se implementó **hasta donde
el backend llega hoy**. Este documento lista lo que falta del lado del
servidor, con el archivo exacto donde está el límite. Cada punto está
verificado leyendo el código, no inferido.

Orden sugerido: 1 y 6 primero (son los que hoy engañan al usuario), después 2,
después 3–5.

---

## 1. La agenda no sabe el horario de cada barbero

**Dónde está el límite:** `packages/contracts/src/agenda.ts:22-25` —
`DayBoardColumn` es exactamente `{ barberId, barberName }`.

**Qué falta:** la columna de cada barbero en la agenda del día tiene que poder
mostrar su horario de ese día (`09:00 – 18:00`), y sin eso tampoco se pueden
calcular los huecos libres.

**Por qué no se resuelve en el front:** no viaja en la respuesta y no es
derivable de los slots — un día sin turnos no dice nada sobre el horario, y un
día con turnos sólo dice cuándo hubo actividad, no cuándo abre.

**Lo que ya existe:** `AgendaRepository.findScheduleFor`
(`packages/domain/src/access-control/agenda-repository.ts:33`) ya lee el
horario. Ninguna ruta HTTP lo expone.

**Propuesta:** agregar `opensAt`/`closesAt` (o `null` si ese día no trabaja) a
`DayBoardColumn`, poblados desde el schedule del barbero para la fecha pedida.

---

## 2. La agenda no distingue un walk-in de un turno reservado

**Dónde está el límite:** la columna `slot_occupancies.channel` existe en la
base con valores `web | phone | walk-in`
(`packages/infrastructure/src/db/migrations/0007_payments.sql:27-30`), pero
`selectSlots()` nunca la selecciona
(`packages/infrastructure/src/agenda/day-board.repository.ts:86-101`) y el
contrato no tiene ningún campo de origen.

**Qué falta:** que el panel pueda decir "esto fue un walk-in" en vez de que el
operador lo deduzca por ausencia de datos del cliente.

**Por qué importa:** hoy el único indicio es que falte `clientPhone`, y eso no
es confiable — un turno telefónico también puede venir sin edad, y un walk-in
puede tener teléfono cargado.

**Propuesta:** exponer `channel` en `DayBoardSlot`. El dato ya está persistido,
es sólo agregarlo al `select` y al contrato.

---

## 3. La facturación del barbero no se puede desglosar

**Dónde está el límite:** `packages/application/src/barbers/get-own-revenue.ts`
devuelve `{ totalListPriceCents, disclaimer }` y
`get-own-stats.ts` devuelve `{ count }`. Los dos colapsan el detalle antes de
salir al wire.

**Qué falta:** cuántos cortes de cada servicio hizo el barbero en el período, y
cuánto facturó cada uno.

**Lo que ya existe y hace fácil el cambio:**
`BarberPerformanceRepository` ya trae `serviceId` y `listPriceCents` por turno
(`packages/domain/src/barbers/barber-performance-repository.ts:12-20`). El dato
está en la mano; se descarta al agregar.

**Propuesta:** agregar `byService: [{ serviceId, serviceName, count,
totalListPriceCents }]` a la respuesta de revenue.

**Nota:** el ticket promedio NO hace falta pedirlo — se deriva de
`totalListPriceCents / count`, y el front ya lo va a calcular así.

---

## 4. El barbero no puede ver cómo cerraron sus turnos

**Dónde está el límite:**
`packages/domain/src/barbers/barber-performance-repository.ts:44-45` — la query
filtra `status = 'realizado'` y nada más.

**Qué falta:** cuántos de sus turnos del período terminaron `cancelado`,
`ausente` o `sin_registrado`.

**Por qué importa:** hoy el barbero ve un número de facturación sin contexto. Si
tuvo 5 ausencias en el mes, eso explica el número y además es la información
que el README pide hacer visible para que el sistema de ausencias sea creíble.

**Propuesta:** agregar un conteo por estado al período, junto al `count` de
realizados.

---

## 5. "Facturación del local" no existe

**Dónde está el límite:** no hay use case, ni controller, ni ruta. El permiso
`finance:read:shop` existe
(`packages/domain/src/access-control/permission.ts:27`) y habilita el ítem de
navegación, pero ningún handler lo usa.
`apps/web/src/pages/ShopRevenuePage.tsx:16-26` es un placeholder que dice "en
construcción".

**Qué falta:** todo. Es la única pantalla del panel que hoy es puro stub.

**Qué sí puede calcular el dominio:** suma de precios de lista de turnos
`realizado`, agrupable por barbero, por servicio y por día. Nada más — el
sistema no ve el 50% que se cobra en el mostrador.

**Propuesta:** `GET /shop/revenue?from&to` con `finance:read:shop`, devolviendo
total, conteo, desglose por barbero y por servicio, y el mismo `disclaimer`
textual que ya devuelve la facturación del barbero. Serie por día si sale
barato; si no, se puede dejar para después.

**Advertencia de producto:** la pantalla tiene que repetir que facturación no es
ganancia. El modelo de comisiones no está definido (README, "Trabajo futuro"), y
el README es explícito en que un número ambiguo genera discusiones.

---

## 6. Apagar un día en Horarios no apaga el día

**Dónde está el límite:**
`packages/application/src/panel/manage-clients-and-barbers.ts:146-150` — al
guardar la semana, los días omitidos **nunca se borran**. El checkbox `enabled`
de `ManagementPage.tsx:153,173` filtra antes de enviar, así que el día
desaparece del payload y el backend simplemente lo deja como estaba.

**Por qué es lo más urgente de esta lista:** es el único punto donde la interfaz
miente. El operador destilda un día, guarda, ve un mensaje de éxito, y el
barbero sigue trabajando ese día.

**Propuesta:** que `PUT /panel/barbers/:barberId/schedule/week` trate el array
recibido como el estado completo de la semana y borre los días que no vengan.
Hoy el contrato exige mínimo 1 día (`packages/contracts/src/panel.ts:31-40`), lo
cual está bien: un barbero sin ningún día es un barbero dado de baja, no un
horario vacío.

**Segunda parte:** decidir qué pasa con los turnos ya reservados en un día que
se apaga. El front hoy avisa "revisá la agenda antes de guardar", pero eso es un
parche: lo correcto es que el backend responda cuántos turnos quedarían
huérfanos y que la UI pida confirmación con ese número.

---

## 7. La cuenta del cliente no sabe qué servicio ni con qué barbero

**Dónde está el límite:** `packages/contracts/src/account.ts:10-23` —
`AccountAppointmentResponse` lleva `barberId` y `serviceId` en crudo, sin
nombres.

**Qué falta:** el cliente entra a "Mi cuenta" y ve una fecha, una hora y un
estado. No ve qué se reservó ni con quién. Los UUID no se pueden mostrar, así
que hoy simplemente no se muestra nada.

**Por qué llama la atención:** el mismo dato ya viaja resuelto del otro lado.
`DayBoardSlot.serviceName` y `DayBoardColumn.barberName` se computan en el
servidor precisamente para que el panel no invente lookups en el navegador
(ver el comentario de `serviceName` en `contracts/agenda.ts`). La cuenta del
cliente quedó sin ese tratamiento.

**Propuesta:** agregar `serviceName` y `barberName` a
`AccountAppointmentResponse`, con el mismo join que ya hace el day board.

**Impacto:** es la pantalla donde el cliente confirma si reservó lo que quería
antes de decidir si lo cancela. Cancelar el turno equivocado por no poder
distinguirlos cuesta la seña.

---

## Fuera de esta lista, pero conviene decidirlo

**La seña 50% vive sólo en el dominio.**
`packages/domain/src/payments/deposit-amount.ts:7-9` calcula
`Math.round(priceCents / 2)` y se usa únicamente en el checkout de MercadoPago.
La pantalla de Precios del panel querría mostrar, al lado de cada precio, cuánto
se va a cobrar de seña. Hacer `/2` en el front duplicaría la regla en dos
lugares: el día que la seña deje de ser 50% fijo, una de las dos queda vieja.

Conviene exponer `depositCents` junto al precio en la respuesta de servicios.

---

## Lo que el front ya resuelve solo (no hace falta backend)

Para que nadie lo tome de esta lista por error:

- **Contadores por estado** en la agenda: se agrupan de `slots[].status`.
- **Ticket promedio**: `totalListPriceCents / count`, con los dos endpoints que
  ya existen.
- **Buscador de clientes**: `GET /panel/clients` devuelve la lista completa sin
  paginar, así que se filtra en el cliente.
