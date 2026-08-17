# access-control — Especificación

## Propósito

Define los tres roles del sistema — dueño, secretaria y barbero — la matriz de permisos que el backend aplica en cada acción, y los dos mecanismos de autenticación que coexisten en el sistema: código o enlace sin contraseña para clientes (ver `client-booking`), y usuario y contraseña para el personal. La autorización es una frontera de backend, no una cuestión de ocultar botones en la interfaz.

Los dos mecanismos de autenticación son una decisión deliberada, no una inconsistencia: la fricción que el sistema busca eliminar es la del cliente ocasional (en particular, el público de 40 años o más que abandonaría un alta con contraseña), no la del personal que abre el sistema todos los días. Además, un código de 6 dígitos por mail es una protección floja para la cuenta del dueño, que expone la facturación del local.

## Requirements

### Requirement: Autenticación diferenciada según tipo de usuario

El sistema MUST autenticar a los clientes exclusivamente mediante el mecanismo sin contraseña de `client-booking` (código o enlace de un solo uso). El sistema MUST autenticar al personal — dueño, secretaria y barbero — mediante usuario y contraseña. El mecanismo de autenticación usado MUST NOT alterar el modelo de roles y permisos: una vez autenticado, cada usuario queda sujeto exactamente a la matriz de permisos de esta especificación, sin importar cómo inició sesión.

#### Scenario: Personal se autentica con usuario y contraseña

- GIVEN un usuario de personal (dueño, secretaria o barbero) con credenciales válidas
- WHEN inicia sesión con usuario y contraseña
- THEN el sistema lo autentica y le aplica los permisos correspondientes a su rol

#### Scenario: Cliente se autentica sin contraseña

- GIVEN un cliente con una cuenta creada a través de `client-booking`
- WHEN solicita acceso e ingresa el código o enlace recibido
- THEN el sistema lo autentica sin haber solicitado ni almacenado ninguna contraseña

### Requirement: Contraseñas del personal almacenadas de forma segura

El sistema MUST almacenar las contraseñas del personal únicamente en forma hasheada, MUST NOT almacenarlas ni exponerlas en texto plano en ningún momento, y MUST NOT ofrecer ninguna función que las recupere en texto plano. El sistema MUST ofrecer un flujo de restablecimiento de contraseña que despache su aviso a través de `notification-port`.

#### Scenario: Restablecimiento de contraseña vía el puerto de notificación

- GIVEN un usuario de personal que olvidó su contraseña
- WHEN solicita restablecerla
- THEN el sistema despacha el aviso de restablecimiento a través del puerto de notificación configurado
- AND el sistema MUST NOT revelar la contraseña anterior en ningún momento

### Requirement: Tres roles con aplicación en el backend

El sistema MUST reconocer exactamente tres roles — dueño, secretaria y barbero — y MUST verificar los permisos de cada acción en el backend, independientemente de lo que la interfaz muestre u oculte.

#### Scenario: Acceso directo a una acción no autorizada

- GIVEN un usuario con rol secretaria
- WHEN intenta ejecutar, por cualquier vía, una acción reservada al dueño
- THEN el sistema MUST rechazarla en el backend, aunque la interfaz no hubiera mostrado esa opción

### Requirement: Matriz de permisos por rol

El sistema MUST aplicar exactamente la siguiente matriz de permisos:

| Acción | Dueño | Secretaria | Barbero |
|---|---|---|---|
| Turnos: crear, editar, cancelar | Sí | Sí | No |
| Marcar realizado / resolver pendientes | Sí | Sí | Solo los propios |
| Cargar walk-ins | Sí | Sí | No |
| Marcar ausencia de un barbero | Sí | Sí | No |
| Gestión de clientes | Sí | Sí | No |
| Alta/baja de barberos, horarios base, precios | Sí | No | No |
| Facturación y señas del local | Sí | No | No |
| Perfil y agenda propios | No aplica | No aplica | Sí |

#### Scenario: Dueño accede a la facturación del local

- GIVEN un usuario con rol dueño
- WHEN consulta la facturación y las señas del local
- THEN el sistema MUST permitir el acceso

#### Scenario: Secretaria opera el día a día

- GIVEN un usuario con rol secretaria
- WHEN gestiona turnos, walk-ins, clientes, o marca la ausencia de un barbero
- THEN el sistema MUST permitir la acción

#### Scenario: Secretaria no accede a la configuración de fondo

- GIVEN un usuario con rol secretaria
- WHEN intenta dar de alta un barbero o modificar precios de servicios
- THEN el sistema MUST rechazar la acción

### Requirement: El barbero queda acotado a sus propios datos

El sistema MUST limitar el acceso del rol barbero exclusivamente a su propio perfil, su propia agenda y sus propias estadísticas, y MUST NOT permitirle ver la facturación del local ni los datos de otros barberos.

#### Scenario: Barbero sin acceso a datos de un colega

- GIVEN un usuario con rol barbero
- WHEN intenta consultar la agenda o las estadísticas de otro barbero
- THEN el sistema MUST rechazar el acceso

### Requirement: Permisos de secretaria ajustables sin cambio de código

El conjunto de permisos asignado al rol secretaria SHOULD poder ampliarse hasta igualar al del dueño mediante un cambio de configuración, sin requerir modificar el código de la aplicación. Esta capacidad responde a una revisión explícitamente pendiente para el día de la entrega del MVP y no altera la matriz vigente descrita arriba.

#### Scenario: Ampliación de permisos por configuración

- GIVEN el rol secretaria con su matriz de permisos actual
- WHEN se decide equipararlo al rol dueño
- THEN el ajuste SHOULD realizarse mediante configuración de permisos, sin desplegar un cambio de código
