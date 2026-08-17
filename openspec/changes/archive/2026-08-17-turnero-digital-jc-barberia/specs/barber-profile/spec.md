# barber-profile — Especificación

## Propósito

Cada barbero accede a su propio perfil: su agenda del día, la cantidad de cortes realizados y la facturación generada por precio de lista. El acceso queda limitado exclusivamente a sus propios datos.

## Requirements

### Requirement: Agenda propia filtrada

El sistema MUST mostrarle al barbero su propia agenda del día en una vista visual por franjas horarias, con el nombre del cliente y la edad cuando esté cargada, y MUST NOT mostrarle turnos ni columnas de otros barberos. Esta vista es la vista compartida de `admin-operations` filtrada a la columna del barbero autenticado.

#### Scenario: Barbero ve su agenda con edad cargada

- GIVEN un turno del propio barbero con la edad del cliente cargada
- WHEN el barbero abre su agenda del día
- THEN ve el turno con el nombre y la edad del cliente

#### Scenario: Barbero no accede a la agenda de un colega

- GIVEN turnos agendados para otro barbero el mismo día
- WHEN el barbero autenticado consulta su agenda
- THEN el sistema MUST NOT incluir esos turnos ni datos del colega

### Requirement: Estadísticas de cortes propios

El sistema MUST mostrarle al barbero la cantidad de turnos `realizado` propios, agrupada por día, mes y un período seleccionable, sin incluir cortes de otros barberos.

#### Scenario: Conteo de cortes del mes

- GIVEN turnos `realizado` propios dentro del mes en curso
- WHEN el barbero consulta sus estadísticas
- THEN ve la cantidad correcta de cortes propios de ese mes

### Requirement: Facturación teórica por precio de lista

El sistema MUST mostrarle al barbero la suma de los precios de lista de sus propios turnos `realizado` en el período consultado, MUST etiquetar explícitamente esa cifra como facturación según precio de lista y no como ganancia ni como plata efectivamente cobrada, y MUST indicar que el sistema no registra el 50% restante cobrado en el mostrador. El sistema MUST NOT mostrarle al barbero la facturación total del local ni la de otros barberos.

#### Scenario: Facturación mostrada con aclaración

- GIVEN turnos `realizado` propios con sus precios de lista
- WHEN el barbero consulta su facturación
- THEN el sistema muestra el total junto con la aclaración de que es precio de lista, no ganancia ni cobro efectivo

#### Scenario: Barbero no accede a la facturación del local

- GIVEN un barbero autenticado
- WHEN intenta consultar la facturación total del local o la de otro barbero
- THEN el sistema MUST rechazar el acceso

### Requirement: Resolución de los turnos propios

El barbero MUST poder marcar sus propios turnos `reservado` como `realizado`, y MUST poder resolver sus propios turnos en `sin registrar` transicionándolos a `realizado` o a `ausente`, según `appointment-lifecycle`, exista o no seña asociada. El barbero MUST NOT poder ejecutar ninguna de estas acciones sobre turnos asignados a otro barbero.

#### Scenario: Barbero marca su propio corte

- GIVEN un turno propio en `reservado` ya prestado
- WHEN el barbero lo marca `realizado`
- THEN el turno pasa a `realizado`

#### Scenario: Barbero resuelve su propio turno sin registrar como ausente

- GIVEN un turno propio en `sin registrar` con seña retenida
- WHEN el barbero confirma que el cliente no vino
- THEN el turno pasa a `ausente`
- AND la seña queda perdida

#### Scenario: Barbero intenta resolver el turno de un colega

- GIVEN un turno `reservado` o `sin registrar` asignado a otro barbero
- WHEN el barbero autenticado intenta resolverlo
- THEN el sistema MUST rechazar la operación
