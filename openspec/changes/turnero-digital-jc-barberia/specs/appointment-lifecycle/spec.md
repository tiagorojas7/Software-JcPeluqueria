# appointment-lifecycle — Especificación

## Propósito

Define los cinco estados posibles de un turno, las transiciones válidas entre ellos, y el barrido automático diario de las 23:59 que resuelve los turnos no marcados. Un turno puede tener o no tener seña asociada según el canal por el que se creó (obligatoria en la web; no aplica en turnos telefónicos ni walk-ins) — nunca por elección del cliente. Esta especificación es la fuente de verdad sobre qué le pasa a la seña en cada transición, incluyendo cuando no existe seña.

## Requirements

### Requirement: Cinco estados explícitos y no colapsables

El sistema MUST modelar el turno con exactamente cinco estados: `reservado`, `realizado`, `cancelado`, `sin registrar` y `ausente`. El sistema MUST NOT combinar ni inferir un estado a partir de otro fuera de las transiciones definidas en esta especificación.

| Estado | Significado | Seña |
|---|---|---|
| `reservado` | Turno confirmado (con seña si es web, sin seña si es telefónico) | Retenida si existe; sin efecto si no existe |
| `realizado` | El servicio se prestó y alguien lo marcó | Si existía seña, se considera aplicada al servicio; si no existía, no hay ningún efecto monetario registrado |
| `cancelado` | El cliente canceló a tiempo, o canceló el local | Si existía seña, se reembolsa automáticamente; si no existía, no corresponde ninguna acción |
| `sin registrar` | Pasó el día y nadie lo marcó; el sistema no sabe qué ocurrió | Si existía seña, queda retenida sin cambios; si no existía, no hay ningún movimiento pendiente |
| `ausente` | Una persona confirmó que el cliente no vino | Si existía seña, se pierde; si no existía, no hay ningún efecto monetario, pero el evento queda registrado en el historial de ausencias |

#### Scenario: Turno realizado sin seña previa

- GIVEN un turno telefónico en `reservado` sin seña asociada
- WHEN el personal autorizado lo marca `realizado`
- THEN el turno pasa a `realizado`
- AND el sistema no ejecuta ningún cobro ni reembolso, porque no había seña que aplicar

### Requirement: El sistema nunca marca ausencias por su cuenta

El sistema MUST NOT transicionar automáticamente ningún turno al estado `ausente`. Únicamente una confirmación humana explícita MUST poder mover un turno de `sin registrar` a `ausente`, y solo esa confirmación MUST disparar la pérdida de la seña cuando existe.

#### Scenario: Ausencia confirmada con seña

- GIVEN un turno en `sin registrar` con seña retenida
- WHEN una persona autorizada confirma que el cliente no vino
- THEN el turno pasa a `ausente`
- AND la seña queda perdida, sin reembolso

#### Scenario: Ausencia confirmada sin seña previa

- GIVEN un turno en `sin registrar` creado por el canal telefónico, sin seña
- WHEN una persona autorizada confirma que el cliente no vino
- THEN el turno pasa a `ausente`
- AND el sistema no ejecuta ningún movimiento de dinero, pero el evento queda registrado en el historial de ausencias del cliente

### Requirement: Barrido diario de las 23:59 en horario fijo de Argentina

Todos los días a las 23:59 en horario de Argentina (UTC-3 fijo, sin ajuste de horario de verano), el sistema MUST identificar todo turno en `reservado` programado para ese mismo día calendario que no fue marcado `realizado` ni `cancelado`, y MUST transicionarlo a `sin registrar`. El barrido MUST incluir por igual los turnos con seña y los turnos sin seña: la existencia de una seña MUST NOT determinar si un turno entra al barrido, solo determina qué pasa con la seña una vez que el turno llega a `sin registrar`. Si el turno tenía seña, esta MUST permanecer retenida sin cambios; si no tenía seña, la transición MUST NOT generar ningún movimiento de dinero, pero el turno MUST quedar igualmente registrado en `sin registrar` para su resolución posterior. El sistema MUST NOT usar la hora local del servidor ni UTC para calcular este corte.

#### Scenario: Turno no marcado cae a sin registrar

- GIVEN un turno en `reservado` con hora ya transcurrida ese día, sin marcar
- WHEN corre el barrido de las 23:59 hora Argentina
- THEN el turno pasa a `sin registrar`
- AND la seña, si existía, permanece retenida sin cambios

#### Scenario: Turno telefónico sin seña también cae a sin registrar

- GIVEN un turno telefónico en `reservado`, sin seña asociada, con hora ya transcurrida ese día, sin marcar
- WHEN corre el barrido de las 23:59 hora Argentina
- THEN el turno pasa a `sin registrar` igual que un turno con seña
- AND queda disponible para resolución humana al día siguiente, preservando el historial de ausencias del cliente aunque no haya seña en juego

#### Scenario: Turnos futuros no son afectados por el barrido

- GIVEN un turno en `reservado` programado para un día calendario posterior
- WHEN corre el barrido de las 23:59 del día actual
- THEN el sistema MUST NOT modificar ese turno

### Requirement: Los walk-ins ingresan directamente como realizado

El sistema MUST permitir que un turno de walk-in se cree directamente en estado `realizado`, sin pasar por `reservado` y sin seña asociada. Como nunca pasa por `reservado`, el walk-in MUST NOT quedar sujeto al barrido diario de las 23:59. La operación de carga del walk-in se rige por `admin-operations`.

#### Scenario: Walk-in registrado sin pasar por reservado

- GIVEN un cliente atendido sin turno previo
- WHEN el personal autorizado carga el walk-in con servicio y barbero
- THEN el turno se crea directamente en `realizado`, sin seña
