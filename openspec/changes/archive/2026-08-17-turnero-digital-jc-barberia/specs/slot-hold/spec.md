# slot-hold — Especificación

## Propósito

Define el mecanismo de retención provisoria de 15 minutos sobre un horario específico (barbero, fecha y franja). Es infraestructura compartida: protege tanto la reserva ordinaria por la web, cuando dos clientes compiten por el mismo horario, como las ofertas del flujo de `barber-absence-reassignment`.

## Requirements

### Requirement: Creación del hold al ofrecer o seleccionar un horario

Cuando el sistema ofrece un horario a un cliente o un cliente selecciona un horario disponible, el sistema MUST crear un hold provisorio de 15 minutos sobre ese horario específico.

#### Scenario: Hold creado al seleccionar un horario

- GIVEN un horario disponible para un barbero, fecha y franja específicos
- WHEN un cliente lo selecciona
- THEN el sistema crea un hold de 15 minutos sobre ese horario exacto

### Requirement: Exclusividad del horario retenido

Mientras un hold esté activo, el sistema MUST NOT permitir que otro cliente reserve o retenga ese mismo horario.

#### Scenario: Segundo cliente intenta tomar el mismo horario

- GIVEN un horario con un hold activo de otro cliente
- WHEN un segundo cliente intenta seleccionarlo
- THEN el sistema MUST rechazar la selección y ofrecer horarios alternativos

### Requirement: Expiración automática y liberación del horario

Si el hold no se confirma dentro de los 15 minutos, el sistema MUST liberarlo automáticamente y MUST devolver el horario a disponible. Si existía un cobro retenido específicamente para ese hold, el sistema MUST reembolsarlo automáticamente por la pasarela de pago; si no existía ningún cobro asociado, no corresponde ninguna acción de reembolso.

#### Scenario: Hold vencido sin cobro asociado

- GIVEN un hold activo sin ningún cobro asociado
- WHEN transcurren 15 minutos sin confirmación
- THEN el hold se libera y el horario vuelve a disponible
- AND el sistema no ejecuta ninguna acción de reembolso, porque no hubo cobro

#### Scenario: Hold vencido con cobro asociado

- GIVEN un hold activo con un cobro ya retenido para ese horario específico
- WHEN transcurren 15 minutos sin confirmación
- THEN el hold se libera y el horario vuelve a disponible
- AND el sistema dispara el reembolso automático de ese cobro

### Requirement: Re-validación inmediatamente antes de confirmar

El sistema MUST re-validar la disponibilidad del horario retenido inmediatamente antes de confirmar el turno. Si la re-validación falla porque el horario dejó de estar libre, el sistema MUST ofrecer automáticamente el horario más cercano disponible dentro del alcance de días que define el flujo que originó el hold: sin restricción de día para una reserva ordinaria de `client-booking`, y limitado al mismo día calendario para una oferta de `barber-absence-reassignment`. La restricción de mismo día es una regla propia de `barber-absence-reassignment` (el local canceló y le debe al cliente una resolución rápida ese mismo día); no aplica por defecto a una reserva ordinaria, donde el cliente navega y elige libremente — los dos flujos no convergen en la misma regla. Si no existe ningún horario disponible dentro de ese alcance, el sistema MUST NOT crear un nuevo hold automático, y MUST mostrarle al cliente la disponibilidad actualizada para que elija manualmente.

#### Scenario: Re-validación exitosa

- GIVEN un hold activo dentro de la ventana de 15 minutos
- WHEN el cliente confirma y el sistema re-valida el horario
- THEN el horario sigue libre y el turno se confirma sobre ese hold

#### Scenario: Re-validación falla en una reserva ordinaria, sin restricción de día

- GIVEN un hold activo de una reserva ordinaria cuyo horario dejó de estar libre por un cruce
- WHEN el sistema re-valida inmediatamente antes de confirmar
- THEN el sistema MUST ofrecer automáticamente el horario más cercano disponible, sin restringirlo al mismo día
- AND MUST crear un nuevo hold de 15 minutos sobre ese horario alternativo

#### Scenario: Re-validación falla en una oferta de ausencia de barbero, limitada al mismo día

- GIVEN un hold activo de una oferta de `barber-absence-reassignment` cuyo horario dejó de estar libre por un cruce
- WHEN el sistema re-valida inmediatamente antes de confirmar
- THEN el sistema MUST ofrecer automáticamente el horario más cercano disponible del mismo día calendario
- AND MUST NOT ofrecer horarios de otro día

#### Scenario: No queda ningún horario disponible tras la falla de re-validación

- GIVEN un hold activo de una reserva ordinaria cuyo horario dejó de estar libre, sin ningún otro horario disponible dentro del alcance correspondiente
- WHEN el sistema re-valida inmediatamente antes de confirmar
- THEN el sistema MUST NOT crear un nuevo hold automático
- AND MUST mostrarle al cliente la disponibilidad actualizada para que elija manualmente
