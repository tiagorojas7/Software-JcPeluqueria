# notification-port — Especificación

## Propósito

El dominio emite intenciones de notificación desconociendo el canal de transporte. El puerto desacopla esa intención de su implementación; el adaptador de Gmail es el único implementado para el MVP.

## Requirements

### Requirement: Puerto de notificación desacoplado del canal

El sistema MUST exponer un puerto de notificación que el dominio invoca para expresar intenciones de aviso al cliente — por ejemplo, código o enlace de acceso, confirmación de cancelación, oferta de reasignación por ausencia de barbero, o recordatorio de turno — y el dominio MUST NOT depender de los detalles de ningún canal de transporte específico.

#### Scenario: El dominio emite una intención sin conocer el canal

- GIVEN un evento de dominio que requiere avisar al cliente
- WHEN el dominio invoca el puerto de notificación
- THEN la invocación no incluye ningún detalle específico de un canal de transporte

### Requirement: Adaptador de Gmail como único canal implementado en el MVP

El sistema MUST implementar exactamente un adaptador para el MVP, que despacha las notificaciones por email a través de Gmail.

#### Scenario: Notificación enviada por Gmail

- GIVEN una intención de notificación emitida por el dominio
- WHEN el puerto la despacha
- THEN el sistema la envía por el adaptador de Gmail

### Requirement: Intercambiar el canal no toca el dominio

Reemplazar o agregar un adaptador de canal — por ejemplo, WhatsApp a futuro — MUST requerir únicamente un nuevo adaptador y su configuración, y MUST NOT requerir cambios en la lógica de negocio del dominio.

#### Scenario: Cambio de adaptador sin tocar el dominio

- GIVEN un adaptador alternativo configurado en lugar de Gmail
- WHEN se dispara la misma intención de notificación
- THEN el dominio emite la misma intención sin modificaciones
- AND solo cambia el adaptador que la despacha

### Requirement: Eventos mínimos que deben notificarse

El sistema MUST despachar, como mínimo, notificación para: el código o enlace de acceso a la cuenta sin contraseña, la confirmación de cancelación con reembolso, la oferta de reasignación por ausencia de barbero, y el recordatorio de turno antes de la hora agendada. El recordatorio MUST enviarse tanto para turnos reservados por la web como para turnos telefónicos, tengan o no seña asociada.

#### Scenario: Envío del código de acceso a la cuenta

- GIVEN un cliente sin contraseña que necesita ingresar a su cuenta
- WHEN el sistema le entrega el acceso
- THEN despacha un código o enlace de un solo uso por el canal de notificación configurado

#### Scenario: Recordatorio para un turno telefónico sin seña

- GIVEN un turno `reservado` creado por teléfono, sin seña
- WHEN se aproxima la hora del recordatorio
- THEN el sistema MUST despachar el recordatorio igual que para un turno reservado por la web
