# client-booking — Especificación

## Propósito

Permite a un cliente explorar la disponibilidad de turnos sin necesidad de cuenta, crear una cuenta sin contraseña al confirmar una reserva, pagar la seña del 50% por la pasarela de pago, y cancelar su propio turno hasta 1 hora antes con reembolso automático. Cubre exclusivamente el canal web.

## Requirements

### Requirement: Exploración sin cuenta

El sistema MUST permitir a cualquier visitante consultar servicios, barberos y horarios disponibles sin crear una cuenta ni autenticarse.

#### Scenario: Consulta de disponibilidad anónima

- GIVEN un visitante sin cuenta en el sistema
- WHEN consulta los horarios disponibles para un servicio
- THEN el sistema muestra los horarios libres sin pedir registro

### Requirement: Cuenta sin contraseña creada al final del flujo

El sistema MUST diferir la creación de la cuenta del cliente hasta el paso de confirmación final de la reserva, y MUST NOT exigir contraseña en ningún momento. Esta ausencia de contraseña aplica únicamente a los clientes; el personal (dueño, secretaria, barbero) se autentica con usuario y contraseña según `access-control`. El acceso del cliente a su cuenta MUST realizarse mediante un código o enlace enviado por el canal de notificación configurado (ver `notification-port`); ese código o enlace MUST ser de un solo uso, MUST expirar en un plazo acotado, y el sistema MUST limitar la frecuencia de solicitudes de acceso de un mismo cliente para evitar abuso. Los datos obligatorios de la cuenta son nombre, teléfono y email; la edad es OPCIONAL. El email es obligatorio en este flujo específicamente porque el acceso sin contraseña depende de él para entregar el código o enlace; un cliente cuyo único registro proviene de un turno telefónico sin email (ver `admin-operations`) MUST NOT poder acceder a la cuenta web hasta que se cargue un email válido.

#### Scenario: Registro al confirmar la reserva

- GIVEN un cliente sin cuenta que seleccionó un horario y lo mantiene retenido (ver `slot-hold`)
- WHEN confirma la reserva indicando nombre, teléfono y email
- THEN el sistema crea la cuenta sin contraseña asociada a esos datos
- AND no solicita ni almacena ninguna contraseña

#### Scenario: Intento de confirmar sin los datos obligatorios

- GIVEN un cliente en el paso de confirmación de la reserva
- WHEN falta el nombre, el teléfono o el email
- THEN el sistema MUST rechazar la confirmación
- AND MUST NOT crear el turno ni cobrar la seña

#### Scenario: Código de acceso vencido

- GIVEN un cliente que recibió un código o enlace de acceso a su cuenta
- WHEN intenta usarlo después de su plazo de expiración
- THEN el sistema MUST rechazarlo
- AND MUST exigir una nueva solicitud de acceso

### Requirement: Reserva web con seña obligatoria del 50%

El sistema MUST exigir el pago del 50% del precio del servicio como seña para toda reserva realizada por el canal web, cobrada al confirmar. Esta exigencia depende del canal, no de una elección del cliente: el sistema MUST NOT ofrecer ninguna vía para completar una reserva web sin pagar la seña (ni pago diferido ni omisión). El turno resultante MUST quedar en estado `reservado` únicamente si el cobro de la seña fue exitoso.

#### Scenario: Reserva confirmada con seña cobrada

- GIVEN un horario retenido y los datos de cuenta completos
- WHEN el cliente completa el pago del 50% por la pasarela de pago
- THEN el turno pasa a estado `reservado`
- AND queda asociada la seña cobrada al turno

#### Scenario: Falla el cobro de la seña

- GIVEN un horario retenido y los datos de cuenta completos
- WHEN el pago de la seña es rechazado o no se completa
- THEN el sistema MUST NOT crear el turno en estado `reservado`
- AND el horario permanece sujeto a las reglas de expiración de `slot-hold`

### Requirement: Cancelación del cliente con reembolso automático

El sistema MUST permitir que el cliente cancele su propio turno reservado por la web hasta 1 hora antes de la hora del turno. Toda cancelación dentro de esa ventana MUST disparar un reembolso automático de la seña por la pasarela de pago, sin aprobación manual. El recordatorio de turno (ver `notification-port`), despachado 2 horas antes, es la última notificación que le da al cliente un margen real —aproximadamente 1 hora— para usar esta ventana antes de que se cierre.

#### Scenario: Cancelación dentro de la ventana permitida

- GIVEN un turno propio en `reservado` con más de 1 hora de anticipación
- WHEN el cliente lo cancela desde la web
- THEN el turno pasa a `cancelado`
- AND el sistema dispara el reembolso automático de la seña

#### Scenario: Intento de cancelación fuera de la ventana permitida

- GIVEN un turno propio en `reservado` con menos de 1 hora de anticipación
- WHEN el cliente intenta cancelarlo desde la web
- THEN el sistema MUST rechazar la cancelación de autoservicio

### Requirement: El cliente solo actúa sobre sus propios datos

El sistema MUST restringir toda acción de autoservicio a los turnos y datos de cuenta que pertenecen al cliente autenticado.

#### Scenario: Intento de cancelar el turno de otro cliente

- GIVEN un cliente autenticado y un turno que pertenece a otra cuenta
- WHEN intenta cancelarlo
- THEN el sistema MUST rechazar la operación
