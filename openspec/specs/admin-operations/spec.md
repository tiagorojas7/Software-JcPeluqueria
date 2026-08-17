# admin-operations — Especificación

## Propósito

Cubre las acciones operativas que el dueño y la secretaria ejecutan desde el panel: turnos telefónicos, edición y cancelación, marcado de realizados, resolución de turnos sin registrar, walk-ins, gestión de clientes y barberos, y configuración de horarios y precios. Qué rol puede hacer qué se rige por `access-control`.

## Requirements

### Requirement: Creación de turnos telefónicos sin seña

El sistema MUST permitir que el personal autorizado cree un turno directamente en `reservado` para un cliente que llama por teléfono, asociado a un registro de cliente nuevo o existente, sin exigir el flujo de cuenta sin contraseña de `client-booking`. Los datos mínimos obligatorios del registro de cliente telefónico son nombre y teléfono; email y edad son OPCIONALES. El sistema MUST NOT bloquear la creación del turno ni del registro de cliente por la ausencia de email. La seña no aplica en el canal telefónico: el sistema MUST NOT cobrarla ni condicionarla a una elección del personal o del cliente.

#### Scenario: Turno telefónico creado sin seña

- GIVEN un cliente que llama por teléfono
- WHEN el personal autorizado carga el turno con servicio, barbero y horario
- THEN el turno queda en `reservado` sin ninguna seña asociada

#### Scenario: Turno telefónico creado sin email

- GIVEN un cliente que llama por teléfono y no provee un email
- WHEN el personal autorizado carga el turno con nombre y teléfono
- THEN el sistema crea el turno y el registro de cliente sin exigir email
- AND MUST NOT bloquear la operación por esa ausencia

### Requirement: Consecuencias de un turno telefónico sin email

Un cliente cuyo registro no incluye email MUST NOT recibir ningún recordatorio ni ninguna otra notificación, porque el único canal implementado en el MVP es email (ver `notification-port`). Ese mismo cliente MUST NOT poder acceder a la cuenta web self-service, porque el acceso sin contraseña de `client-booking` depende de un email válido para entregar el código o enlace. Combinado con la ausencia de seña en el canal telefónico, este cliente queda sin ninguna mitigación de ausentismo: ni dinero comprometido ni aviso previo del turno.

Este riesgo se acepta conscientemente para el MVP porque se resuelve con la futura migración a WhatsApp Business API (ver `notification-port`), donde el canal de notificación pasa a ser el número de teléfono — dato que la secretaria ya recolecta en este mismo flujo. No corresponde resolverlo haciendo obligatorio el email telefónico: eso reintroduciría la fricción de registro que la cuenta sin contraseña buscó eliminar.

#### Scenario: Cliente telefónico sin email no recibe recordatorio

- GIVEN un turno telefónico `reservado` cuyo cliente no tiene email registrado
- WHEN se aproxima la hora del recordatorio
- THEN el sistema MUST NOT despachar ningún recordatorio a ese cliente

#### Scenario: Cliente telefónico sin email no puede acceder a la cuenta web

- GIVEN un cliente cuyo único registro proviene de un turno telefónico sin email
- WHEN intenta solicitar acceso a la cuenta web
- THEN el sistema MUST NOT poder entregarle un código o enlace de acceso

### Requirement: Edición y cancelación administrativa

El personal autorizado MUST poder editar el servicio, el barbero o el horario de cualquier turno, y MUST poder cancelarlo. La cancelación administrativa MUST seguir la misma regla que toda cancelación: reembolso automático si el turno tiene seña, sin ninguna acción de reembolso si no la tiene.

#### Scenario: Cancelación administrativa de un turno con seña

- GIVEN un turno `reservado` con seña, reservado por la web
- WHEN el personal autorizado lo cancela desde el panel
- THEN el turno pasa a `cancelado`
- AND el sistema reembolsa la seña automáticamente

#### Scenario: Cancelación administrativa de un turno sin seña

- GIVEN un turno `reservado` telefónico, sin seña
- WHEN el personal autorizado lo cancela desde el panel
- THEN el turno pasa a `cancelado` sin ninguna acción de reembolso

### Requirement: Marcado de realizados y resolución de pendientes

El personal autorizado MUST poder marcar `realizado` cualquier turno, independientemente del barbero asignado, y MUST poder resolver turnos en `sin registrar` transicionándolos a `realizado` o a `ausente`, según `appointment-lifecycle`. Esta resolución MUST aplicarse por igual a turnos con seña y sin seña: la ausencia de seña no exime al personal de resolver el pendiente ni de registrar el resultado en el historial del cliente.

#### Scenario: Resolución de un turno sin registrar como ausente, con seña

- GIVEN un turno en `sin registrar` con seña retenida
- WHEN el personal autorizado confirma que el cliente no vino
- THEN el turno pasa a `ausente`
- AND la seña queda perdida

#### Scenario: Resolución de un turno sin registrar como ausente, sin seña

- GIVEN un turno telefónico en `sin registrar`, sin seña
- WHEN el personal autorizado confirma que el cliente no vino
- THEN el turno pasa a `ausente`
- AND no se ejecuta ningún movimiento de dinero, pero el evento queda registrado en el historial de ausencias del cliente

### Requirement: Carga de walk-ins

El personal autorizado MUST poder registrar un walk-in indicando obligatoriamente servicio y barbero. La seña no aplica en este canal: el turno se crea directamente en `realizado`, y el horario correspondiente MUST dejar de estar disponible para reserva online.

#### Scenario: Walk-in ocupa el horario correspondiente

- GIVEN un horario que un walk-in va a ocupar
- WHEN el personal autorizado carga el walk-in con servicio y barbero
- THEN el turno se crea en `realizado`, sin seña
- AND ese horario deja de figurar como disponible para reserva online

### Requirement: Gestión de clientes y de barberos

El personal autorizado MUST poder ver y administrar los registros de clientes. El alta y baja de barberos, y la configuración de horarios base y precios de servicios, MUST quedar restringidas a los roles autorizados según `access-control`.

#### Scenario: Alta de un nuevo barbero

- GIVEN un rol autorizado para configuración
- WHEN da de alta un nuevo barbero con su horario base
- THEN el barbero queda disponible para asignación de turnos

### Requirement: Vista del día por columnas de barbero

El sistema MUST ofrecer una vista del día con una columna por barbero, mostrando los turnos, su estado, el nombre del cliente y su edad cuando esté cargada. Esta vista es la base que `barber-profile` reutiliza filtrada a un solo barbero.

#### Scenario: Vista admin muestra todos los barberos

- GIVEN turnos agendados para varios barberos en el mismo día
- WHEN el personal autorizado abre la vista del día
- THEN ve una columna por cada barbero con sus turnos correspondientes
