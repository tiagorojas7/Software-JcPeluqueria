# barber-absence-reassignment — Especificación

## Propósito

Cuando un barbero queda marcado no disponible para una franja horaria, el sistema ofrece automáticamente a los clientes afectados horarios libres del mismo día, de cualquier barbero, sin tocar turnos de otros clientes. Se apoya en `slot-hold` para proteger cada oferta. El turno original puede tener o no tener seña asociada según el canal por el que se creó; ambos casos deben resolverse correctamente.

## Requirements

### Requirement: Detección de turnos afectados

Cuando el personal autorizado marca a un barbero como no disponible para una franja horaria, el sistema MUST identificar todos los turnos en `reservado` de ese barbero dentro de esa franja.

#### Scenario: Ausencia marcada detecta turnos afectados

- GIVEN un barbero con turnos `reservado` dentro de una franja
- WHEN el personal autorizado lo marca no disponible para esa franja
- THEN el sistema identifica esos turnos como afectados

### Requirement: Ofertas del mismo día, de cualquier barbero

Para cada turno afectado, el sistema MUST buscar horarios libres del mismo día calendario del turno original, entre cualquier barbero disponible y no solo el ausente, MUST crear un hold de 15 minutos (ver `slot-hold`) sobre cada horario ofrecido, y MUST notificar al cliente por el canal de notificación configurado.

#### Scenario: Oferta incluye barberos distintos del ausente

- GIVEN un turno afectado por la ausencia del barbero A
- WHEN el sistema genera las ofertas
- THEN incluye horarios libres de otros barberos además de, o en lugar de, el barbero A
- AND cada horario ofrecido queda protegido por un hold de 15 minutos

### Requirement: Aceptación reagenda sin mover dinero

Si el cliente acepta un horario ofrecido dentro de la ventana del hold, el sistema MUST re-validar su disponibilidad y MUST reasignar el turno original a ese barbero y horario, conservando el estado de la seña sin generar un nuevo cobro ni un reembolso, exista o no seña.

#### Scenario: Cliente acepta la reasignación

- GIVEN una oferta con hold activo
- WHEN el cliente la acepta y la re-validación es exitosa
- THEN el turno se reagenda al nuevo barbero y horario
- AND la seña, si existía, se mantiene asociada sin cobro ni reembolso adicional

### Requirement: Rechazo o falta de respuesta cancela el turno original

Si el cliente rechaza todas las ofertas o no responde dentro de la ventana del hold, el sistema MUST transicionar el turno original a `cancelado`. Si el turno original tenía seña, el sistema MUST reembolsarla automáticamente; si no tenía seña (turno telefónico), no corresponde ninguna acción de reembolso. El cliente MUST volver a reservar manualmente si lo desea; el sistema MUST NOT reservarle un turno nuevo de forma automática.

#### Scenario: Cliente rechaza explícitamente, con seña

- GIVEN una oferta activa para un turno original con seña
- WHEN el cliente rechaza todas las opciones
- THEN el turno original pasa a `cancelado`
- AND el sistema reembolsa automáticamente la seña

#### Scenario: El cliente no responde, sin seña previa

- GIVEN una oferta activa para un turno original telefónico, sin seña
- WHEN transcurren los 15 minutos sin respuesta
- THEN el turno original pasa a `cancelado`
- AND el sistema no ejecuta ninguna acción de reembolso, porque no había seña que devolver

### Requirement: No interferencia con otros turnos

El sistema MUST NOT modificar turnos ya agendados de otros clientes al generar o resolver ofertas de reasignación. El sistema únicamente MUST ofrecer horarios genuinamente libres, sin reprogramación en cascada.

#### Scenario: Turnos de otros clientes permanecen intactos

- GIVEN turnos `reservado` de otros clientes en la misma franja, con barberos no afectados
- WHEN se resuelve la ausencia de un barbero distinto
- THEN esos turnos permanecen sin cambios
