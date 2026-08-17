# Diseño: Turnero Digital — MVP de JC Barbería

> Lógica de negocio: [README](../../../README.md). Alcance y límites: [propuesta](./proposal.md).
> Este documento decide **cómo** se construye. No reabre decisiones de negocio.

## Enfoque técnico

Monorepo TypeScript con arquitectura hexagonal explícita: un núcleo de dominio sin dependencias, casos de uso que solo conocen puertos, y adaptadores intercambiables para persistencia, pagos, notificaciones y ejecución programada. Backend separado del frontend, porque la frontera de autorización y el control de concurrencia del hold tienen que vivir en un lugar único, verificable y del lado del servidor.

Tres afirmaciones sostienen todo el diseño:

1. **La exclusividad del horario es una garantía de la base de datos, no del código.** Un constraint `EXCLUDE` de PostgreSQL sobre rangos temporales hace que la doble reserva sea estructuralmente imposible, aunque la aplicación tenga bugs.
2. **Los procesos de fondo son optimizaciones, nunca la fuente de verdad.** Si el worker está caído una hora, el sistema sigue siendo correcto: el vencimiento se evalúa de forma perezosa en cada lectura y escritura; el job solo ejecuta los efectos que no pueden ser perezosos (reembolso y notificación).
3. **La seña la decide el canal, y eso es un invariante de la base de datos.** No existe camino —ni por bug, ni por endpoint olvidado— para que un turno web llegue a *reservado* sin la seña saldada.

---

## Recomendación de stack

### Decisión principal

| Capa | Elección | Alternativa descartada |
|------|----------|------------------------|
| Backend | **NestJS + TypeScript** | Next.js full-stack, Express plano, Go/.NET |
| Frontend | **React 19 + Vite + TanStack Query** | Next.js, Remix |
| Base de datos | **PostgreSQL 16** | MySQL, SQLite, MongoDB |
| Acceso a datos | **Drizzle ORM + drizzle-kit** | Prisma, TypeORM, SQL crudo |
| Procesos de fondo | **pg-boss** (mismo PostgreSQL) | BullMQ + Redis, cron del sistema |
| Autenticación | **Propia, módulo `identity`**: cliente sin contraseña · staff con contraseña | Auth0/Clerk, better-auth, NextAuth |
| Pagos | **MercadoPago Checkout Pro** detrás de `PaymentPort` | SDK directo en el dominio |
| Testing | **Vitest** en todo el monorepo + Testcontainers + Playwright | Jest |
| Hosting | **Railway o Fly.io** (contenedores persistentes) | Vercel + serverless, VPS propio |

### Por qué NestJS + React separados, y no Next.js

Las dos direcciones son viables. La diferencia no es de gusto: son tres restricciones concretas de este sistema.

| Restricción | NestJS + React | Next.js full-stack |
|-------------|----------------|--------------------|
| **Puertos y adaptadores explícitos** | El contenedor de DI de Nest hace que un puerto sea un token de inyección y un adaptador un provider. Cambiar Gmail por WhatsApp es una línea en un módulo | Alcanzable, pero la gravedad del framework empuja la lógica hacia route handlers y server components. El puerto se sostiene por disciplina, no por estructura |
| **Frontera de autorización** | Un guard global con *deny by default*: un handler sin decorador de permiso **falla cerrado**. Olvidarse no abre un agujero | Cada server action es un endpoint independiente. Olvidar el chequeo en uno **falla abierto**. Es el modo de falla exacto que el negocio prohíbe |
| **Tres procesos de fondo** | Un proceso worker persistente comparte el mismo dominio del monorepo. Cron y jobs diferidos son nativos | Necesita una pieza aparte (Inngest, QStash, Trigger.dev o un worker externo). La ventaja de "menos infraestructura" se pierde justo acá |

Costo honesto de esta elección: **la primera demo llega más tarde**. Hay dos artefactos que desplegar, más ceremonia inicial y más código de cableado. Se mitiga con el monorepo y un paquete de contratos compartidos, pero no desaparece. A cambio, las tres cosas que más caro sale corregir después —autorización, concurrencia y el puerto de notificaciones— quedan bien desde el primer día. Con tres roles y un barbero que no debe ver la facturación del local, agregar la autorización más tarde no es sumar una capa: es rehacer.

Descartados también: **Go/.NET/Kotlin** (mejores primitivas de concurrencia, pero acá la concurrencia la resuelve PostgreSQL, y se perdería el tipado compartido entre front y back con un equipo que ya trabaja en TypeScript); **Express plano** (menos ceremonia, pero hay que construir a mano el guard global, la DI y la validación, que es justo lo que aporta Nest).

### Por qué PostgreSQL — el argumento decisivo

No es preferencia general: es **una** funcionalidad que resuelve el problema más difícil del sistema.

```sql
ALTER TABLE slot_occupancies
  ADD CONSTRAINT no_overlap_per_barber
  EXCLUDE USING gist (
    barber_id WITH =,
    time_range WITH &&
  ) WHERE (status IN ('held', 'reservado', 'realizado'));
```

Con eso, dos transacciones concurrentes que intentan ocupar el mismo rango del mismo barbero **no pueden ganar las dos**: PostgreSQL serializa sobre el índice GiST y la perdedora recibe `23P01 exclusion_violation`. No hace falta `SERIALIZABLE`, ni locks de aplicación, ni `SELECT` antes de `INSERT`. El patrón clásico "consultar disponibilidad y después insertar" bajo `READ COMMITTED` es exactamente el bug que produce doble reserva; este constraint lo elimina de raíz.

Descartados: **MySQL** (sin tipos de rango ni exclusion constraints; habría que emular con locks de aplicación); **SQLite** (un solo escritor: fatal para el hold); **MongoDB** (sin exclusión por solapamiento y con transacciones multi-documento que no encajan con la forma del problema).

### Por qué Drizzle y no Prisma

Las dos consultas que deciden si este sistema es correcto —exclusión por solapamiento y `UPDATE ... RETURNING` condicional— tienen forma de SQL. Drizzle deja escribirlas sin pelear con una abstracción, y su schema tipado no se disfraza de modelo de dominio, lo cual mantiene honesta la frontera del repositorio-adaptador.

Prisma es una alternativa aceptable: mejor DX de migraciones y mejor legibilidad del schema para un equipo mixto. Pierde por poco, y por dos motivos concretos: tampoco expresa `EXCLUDE` en su schema (igual hay que escribir SQL a mano en la migración), y su cliente generado invita a filtrarse hacia arriba. Contra-argumento válido a favor de Prisma: `drizzle-kit` es menos opinado con las migraciones y requiere más revisión manual.

En ambos casos la regla es la misma: **el ORM vive solo en `packages/infrastructure`**. `packages/domain` no lo importa nunca, y eso se verifica en CI.

### Por qué pg-boss y no BullMQ + Redis

| | pg-boss | BullMQ + Redis |
|---|---|---|
| Infraestructura | Ninguna extra: usa el PostgreSQL que ya existe | Un servicio más que operar y pagar |
| Encolado transaccional | **Sí** — el job se encola en la misma transacción que crea el hold | No. Si el commit sale bien y el encolado falla, queda un hold huérfano cuyo reembolso nunca dispara |
| Cron con múltiples réplicas | Singleton nativo | Requiere configuración extra |
| Throughput alto | Peor | Mejor |

Este sistema mueve unos ~100 jobs por día. El throughput de BullMQ es irrelevante; el encolado transaccional de pg-boss no lo es, porque acá hay plata de por medio. `@nestjs/schedule` queda descartado incluso para el cron: dispararía dos veces si algún día corren dos réplicas de la API, y el barrido de las 23:59 no debe ejecutarse dos veces.

### Por qué autenticación propia

No hay proveedores OAuth ni SSO, y hay dos mecanismos acotados: challenge sin contraseña para clientes y contraseña para staff. La superficie completa es *challenge + credencial + sesión + rol*, testeable de punta a punta sobre primitivas de la librería estándar (`crypto.randomInt`, `timingSafeEqual`, `createHash`) más `argon2` para el hash.

Conviene decirlo con honestidad: **la decisión de darle contraseña al staff fortalece el caso de una librería**. Login, reset, rotación e invalidación de sesiones al cambiar la contraseña son código que ya está escrito y probado en otro lado. **better-auth** cubre las dos modalidades y es la alternativa a tomar en serio si el equipo prefiere no escribir el login a mano. Se mantiene la implementación propia porque el módulo `identity` ya tiene que modelar rol, `barberId` y `clientId` para la autorización, y porque la semántica de sesión —revocable, con vidas distintas por tipo de usuario— es más simple de controlar directamente que de doblegar. Auth0/Clerk se descartan por costo y por sobredimensión.

### Hosting

**Railway o Fly.io** para el MVP: contenedores persistentes (sin cold starts, que romperían los webhooks de MercadoPago), PostgreSQL gestionado con backups, un solo proveedor, y despliegue desde el mismo `docker-compose`/Dockerfile. Fly tiene región `gru` (São Paulo), mucho más cerca de Córdoba que us-east.

Descartado **Vercel + Postgres serverless**: obliga a partir los procesos de fondo en otro proveedor y a lidiar con cold starts en el endpoint que menos los tolera. Descartado **VPS propio** *para el MVP*, aunque es el destino natural cuando importe el costo (Hetzner CX22, ~€4/mes): todo va containerizado, así que migrar es mover un `docker-compose.yml`. El precio de un VPS es hacerse cargo de backups y uptime a mano.

---

## Estructura del monorepo (screaming architecture)

```
apps/
  api/                    NestJS: HTTP + webhooks
  worker/                 mismo contenedor Nest, entrypoint de pg-boss + cron
  web/                    React SPA (pública + panel + agenda)
packages/
  domain/                 entidades, value objects, máquina de estados, PUERTOS. Cero dependencias
  application/            casos de uso. Depende solo de domain
  infrastructure/         adaptadores: drizzle, mercadopago, gmail, pg-boss
  contracts/              esquemas zod compartidos api <-> web
```

Dentro de `domain/` las carpetas gritan el negocio, no el framework:
`availability/` · `booking/` · `appointments/` · `identity/` · `access-control/` · `notifications/` · `payments/`

**La frontera se verifica en CI**, no se confía a la disciplina: `dependency-cruiser` falla el build si `domain` importa algo de `infrastructure`, de `application` o de cualquier paquete de terceros que no sea de tipos.

---

## El hold de 15 minutos — control de concurrencia

### Modelo: una tabla de ocupación, dos agregados de dominio

Un hold y un turno son la misma cosa desde el punto de vista físico: **ocupan el tiempo de un barbero**. También lo ocupa un walk-in. Por eso hay **una sola tabla**, `slot_occupancies`, protegida por un único constraint.

La consecuencia es importante: confirmar un turno es una **transición de estado** (`held → reservado`), no un `INSERT`. Nunca existe la ventana entre "liberé el hold" y "creé el turno" en la que otro se cuela.

El dominio, en cambio, expone dos agregados separados —`Hold` y `Appointment`—, y el repositorio los mapea sobre la misma tabla. Es exactamente para eso que existe la frontera hexagonal.

| `status` | Qué es | ¿Ocupa el horario? |
|----------|--------|--------------------|
| `held` | Retención provisoria de 15 min | ✅ |
| `liberado` | Hold vencido o ya consumido (con `release_reason`) | ❌ |
| `reservado` · `realizado` · `cancelado` · `sin_registrar` · `ausente` | Los cinco estados del turno, nunca colapsados | `reservado` y `realizado` ✅ · el resto ❌ |

`held` y `liberado` son **anteriores** al ciclo de vida del turno, no estados del turno. Los cinco estados del README quedan intactos.

### Cómo se resuelve el vencimiento: perezoso **y** por job, con responsabilidades distintas

El predicado de un `EXCLUDE` no puede referenciar `now()` (no es inmutable), así que un hold vencido seguiría bloqueando. La solución es también la respuesta a "¿job o evaluación perezosa?": **las dos, para cosas diferentes.**

| Mecanismo | De qué se encarga | Si falla |
|-----------|-------------------|----------|
| **Perezoso** (en cada lectura de disponibilidad y en la transacción de reserva) | Que un hold vencido no ocupe. `UPDATE ... SET status='liberado' WHERE status='held' AND hold_expires_at <= now() AND barber_id = :b AND time_range && :r` antes del `INSERT` | Nada: es el mismo camino que hace la reserva |
| **Job `hold.expire`** (pg-boss, `startAfter` 15 min) | Los **efectos que no pueden ser perezosos**: reembolso del turno de origen y notificación al cliente | El horario ya se ve libre igual. Solo se demora el reembolso, y el job es idempotente |

El job **no** libera el horario — eso ya lo hace la consulta. El job existe por la plata y por el aviso.

### Regla que elimina el peor caso

> **Un hold con un pago en curso nunca lo libera el temporizador.** Solo se libera cuando el pago alcanza un estado terminal.

Sin esta regla existe el caso feo: el cliente paga en el minuto 14:50, el hold vence, y queda un pago aprobado sin horario. Con ella ese caso **no puede ocurrir**, porque la fila sigue ocupando el rango durante toda la ventana de pago. Si MercadoPago responde `rejected` o `cancelled`, se libera de inmediato sin esperar los 15 minutos.

### Re-validación justo antes de confirmar

No hay "leer y después escribir". La confirmación es una sola sentencia atómica:

```sql
UPDATE slot_occupancies
   SET status = 'reservado'
 WHERE id = :id AND status = 'held' AND hold_expires_at > now()
RETURNING *;
```

Cero filas devueltas significa hold perdido o vencido → se ofrece automáticamente el siguiente hueco más cercano del mismo día. Una fila significa confirmado. No hay estado intermedio observable.

### El constraint también protege a la secretaria

El hold es propio del canal web, pero la exclusividad no: la secretaria cargando un turno telefónico escribe contra la misma tabla y el mismo `EXCLUDE`. Puede perder una carrera contra un hold web que todavía no se confirmó.

**Comportamiento especificado**: el mismo `409` con huecos alternativos del mismo día que recibe un cliente. Idéntico camino de código, idéntica semántica; lo único que cambia es la redacción en pantalla —"ese horario se está reservando desde la web en este momento"— para que la secretaria entienda que no es un error del sistema y pueda ofrecerle otra opción al cliente que tiene en el teléfono. Nunca se le permite forzar la escritura por encima de un hold vigente: eso reintroduciría la doble reserva por la puerta de atrás.

### Diagrama: reserva web con dos clientes compitiendo

```mermaid
sequenceDiagram
    autonumber
    participant A as Cliente A (web)
    participant B as Cliente B (web)
    participant API as API booking
    participant DB as PostgreSQL
    participant MP as MercadoPago
    participant W as Worker (pg-boss)

    A->>API: POST /holds {barbero, servicio, inicio}
    API->>DB: BEGIN
    API->>DB: UPDATE holds vencidos que solapan → 'liberado'
    API->>DB: INSERT status='held', hold_expires_at = now() + 15 min
    Note over DB: EXCLUDE gist (barber_id =, time_range &&)<br/>WHERE status IN ('held','reservado','realizado')
    API->>DB: pgboss.send('hold.expire', startAfter = 15 min)
    API->>DB: COMMIT
    API-->>A: 201 {hold_id, expires_at}

    B->>API: POST /holds (mismo barbero, mismo rango)
    API->>DB: BEGIN → INSERT
    DB--)API: 23P01 exclusion_violation
    API->>DB: ROLLBACK
    API-->>B: 409 + huecos alternativos del mismo día

    A->>API: POST /holds/:id/checkout
    API->>DB: UPDATE ... SET payment_pending = true, hold_expires_at = now() + 15 min<br/>WHERE id AND status='held' AND hold_expires_at > now() RETURNING *
    alt cero filas
        API-->>A: 410 hold vencido + huecos alternativos
    else una fila
        API->>MP: crear preference (50% del precio de lista)
        MP-->>API: init_point
        API-->>A: redirect a MercadoPago
    end

    A->>MP: paga la seña
    MP->>API: webhook payment.updated (x-signature)
    API->>API: verificar HMAC — 401 si no valida
    API->>DB: encolar 'payment.process' con el payload crudo
    API-->>MP: 200 inmediato

    W->>MP: GET /v1/payments/:id (fuente de verdad, no el redirect)
    MP-->>W: approved
    W->>DB: INSERT deposit (payment_id UNIQUE)
    W->>DB: UPDATE ... SET status='reservado' WHERE id AND status='held' RETURNING *
    Note over W,DB: idempotente: un reintento del webhook afecta cero filas
    W->>DB: INSERT notification_outbox (turno confirmado)

    Note over W: 'hold.expire' a los 15 min:<br/>payment_pending → NO libera, espera estado terminal<br/>si no → 'liberado'; si hay origin_occupancy_id → cancelar origen + reembolsar
```

---

## La seña la decide el canal — invariante estructural

La seña **no es un campo opcional que el cliente pueda saltear**. Es una consecuencia del canal de creación, y el modelo lo representa así en los dos niveles.

### En el dominio: unión discriminada, no `Deposit | null`

```ts
type DepositState =
  | { kind: 'not_applicable' }                                  // teléfono, walk-in
  | { kind: 'pending';  paymentIntentId: PaymentIntentId }      // web, hold con pago en curso
  | { kind: 'settled';  paymentId: PaymentId; amount: Money }
  | { kind: 'refunded'; refundId: RefundId;  amount: Money }
  | { kind: 'forfeited'; amount: Money };                       // ausencia confirmada
```

Cada operación que toca plata —reembolso por cancelación, pérdida por ausencia confirmada, reembolso al vencer un hold, reembolso al rechazar una reasignación— es un `switch` **exhaustivo** sobre `DepositState`. El compilador obliga a resolver `not_applicable` en cada una. No es un `if (deposit)` colgado al final: es una rama de primera clase, que además será la mayoritaria durante la transición.

Comportamiento de `not_applicable`: la operación de plata es un no-op, **pero el resto del efecto ocurre igual**. Cancelar un turno telefónico no reembolsa nada y sí manda la notificación de cancelación; marcar *ausente* a un turno sin seña no pierde plata y sí registra la ausencia en el historial del cliente. Ese historial es la palanca que el dueño va a poder usar más adelante para exigir seña a quien falta seguido.

### En la base de datos: el invariante no se puede violar por bug

```sql
-- Un turno web que salió de la etapa de hold DEBE tener seña
CHECK (channel <> 'web' OR status IN ('held','liberado') OR deposit_id IS NOT NULL)

-- Teléfono y walk-in NUNCA llevan seña
CHECK (channel = 'web' OR deposit_id IS NULL)
```

Consecuencia de diseño, deliberada: **no existe ningún endpoint que transicione `held → reservado` en el canal web fuera del handler de pago aprobado**. La confirmación web es la consecuencia del pago, no una acción separada que el pago acompaña. Un checkout con "pagar después" es literalmente irrepresentable: la base de datos rechaza la fila.

Los otros dos canales tienen sus propios caminos de escritura: la secretaria inserta `channel='telefono'`, `status='reservado'`, `deposit_id NULL`; el walk-in entra como `channel='walk_in'`, `status='realizado'` con servicio y barbero, ocupando el hueco.

---

## Ausencia del barbero — reasignación

El punto fino: cuando el cliente acepta un hueco nuevo, el turno **no se cancela y se vuelve a crear**. Se **mueve**. La misma fila cambia de `barber_id` y `time_range`, conserva su `deposit_id` y nunca sale de `reservado`. Así el cliente no pierde la seña sin que haga falta un reembolso y un cobro nuevo, y la máquina de estados del README no ve un `cancelado` espurio.

```mermaid
sequenceDiagram
    autonumber
    participant S as Secretaria
    participant API as API absence
    participant DB as PostgreSQL
    participant OB as Outbox + NotificationPort
    participant C as Cliente
    participant MP as MercadoPago

    S->>API: POST /barbers/:id/absences {franja}
    API->>API: PermissionsGuard → barber:mark-absent
    API->>DB: BEGIN
    API->>DB: INSERT barber_time_off
    API->>DB: SELECT turnos 'reservado' del barbero en la franja FOR UPDATE
    loop por cada turno afectado
        API->>DB: buscar huecos libres del MISMO DÍA, de CUALQUIER barbero
        API->>DB: INSERT status='held' (15 min), origin_occupancy_id = turno afectado
        Note over DB: el EXCLUDE impide ofrecer un hueco ya tomado.<br/>Nunca se toca un turno de otro cliente
        API->>DB: pgboss.send('hold.expire', startAfter = 15 min)
        API->>DB: INSERT notification_outbox (oferta de huecos)
    end
    API->>DB: COMMIT
    OB->>C: notificación con las opciones del día

    alt Acepta una opción
        C->>API: POST /offers/:holdId/accept
        API->>DB: UPDATE hold SET status='liberado', release_reason='consumed'<br/>WHERE id AND status='held' AND hold_expires_at > now() RETURNING barber_id, time_range
        alt cero filas
            API-->>C: ese hueco ya no está → ofrecer el siguiente del mismo día
        else una fila
            API->>DB: UPDATE turno original SET barber_id, time_range<br/>WHERE id AND status='reservado'
            Note over DB: el turno se MUEVE. Sigue 'reservado',<br/>conserva su deposit_id. No hay reembolso ni cobro nuevo
            API->>DB: liberar los holds hermanos del mismo origen
            API->>DB: INSERT notification_outbox (turno reagendado)
        end
    else Rechaza
        C->>API: POST /offers/:originId/reject
        API->>DB: UPDATE turno original SET status='cancelado'; liberar holds hermanos
        API->>MP: refund — solo si DepositState = settled
        API->>DB: INSERT notification_outbox (cancelación + reembolso si corresponde)
    else No responde en 15 min
        Note over DB: job 'hold.expire' encuentra origin_occupancy_id
        DB->>API: cancelar turno original + liberar holds hermanos
        API->>MP: refund — solo si DepositState = settled
        API->>DB: INSERT notification_outbox (cancelación + reembolso si corresponde)
    end
```

---

## Zona horaria: UTC-3 fijo

Dos cosas necesitan el offset y **ambas usan el mismo valor de configuración**, nunca la hora del servidor ni `Intl` con la zona por defecto:

| Qué | Cómo |
|-----|------|
| **Cuándo** dispara el barrido | Cron de pg-boss en UTC: `59 2 * * *` (= 23:59 en UTC-3). No depende de la tzdb |
| **Qué turnos** entran en el día hábil | `ShopClock.businessDayBounds(fecha)` → `[fecha T00:00-03:00, fecha T23:59:59.999-03:00)` como `timestamptz` |

**Cobertura del barrido**: alcanza a **todo turno que siga en `reservado`, tenga seña o no**. No hay filtro por `deposit_id`. El barrido detecta turnos sin resolver; que un turno telefónico no tenga plata en juego no lo hace menos pendiente, y el historial de ausencias —que es la palanca comercial futura del dueño— necesita registrarse igual. Los walk-ins entran directamente como `realizado`, así que el barrido no los ve.

Todo instante se guarda como `timestamptz` (UTC internamente). Los horarios del local y de cada barbero se guardan como **hora de pared local + día de la semana** y se materializan a instantes vía `ShopClock`; son dos conceptos distintos y mezclarlos es el error clásico.

`SHOP_UTC_OFFSET=-03:00` es un único valor de configuración leído por un único servicio. Se prohíbe por lint (`no-restricted-globals` / regla de import) el uso directo de `Date.now()`, `new Date()` y `toLocaleString` fuera de `ShopClock`, y `ShopClock` se inyecta como puerto `Clock` para poder congelar el tiempo en los tests.

Se elige **offset fijo explícito y no la zona IANA** `America/Argentina/Buenos_Aires` porque la decisión de negocio dice "UTC-3 fijo, sin horario de verano". Hoy ambas coinciden; si Argentina reinstaurara el horario de verano, la zona IANA movería el barrido una hora y el offset fijo no. Ver riesgos.

---

## Autorización: permiso como unidad, rol como configuración

El rol **no** se codifica. Se codifican los **permisos**; el mapa rol → permisos vive en una tabla sembrada (`role_permissions`). Cambiar los permisos de la secretaria el día de la entrega es actualizar filas, no desplegar.

```
appointment:create · appointment:update · appointment:cancel
appointment:mark-completed:any · appointment:mark-completed:own
walkin:create · barber:mark-absent · client:manage · barber:manage
schedule:configure · pricing:configure
finance:read:shop · finance:read:own · agenda:read:any · agenda:read:own
```

Dos capas, porque una sola no alcanza:

**1. Gruesa — guard global con deny by default.** Cada handler declara `@RequiresPermission('appointment:cancel')`. Un handler **sin** decorador y sin `@Public()` explícito es **rechazado**. Olvidarse falla cerrado, nunca abierto. Este es el detalle que hace que la regla se sostenga con el tiempo y no solo el primer día.

**2. Fina — alcance por fila, en el dominio.** `agenda:read:own` no lo puede evaluar un guard: depende de la fila. Cada caso de uso recibe un `ActorContext { userId, role, barberId?, permissions }` y el dominio decide. Además, **el repositorio estrecha la consulta**: para un barbero, `WHERE barber_id = :actorBarberId` se aplica en la query, no como filtro posterior. No hay ruta —ni adivinando un id— por la que un barbero alcance datos de un compañero, porque la consulta nunca se ensancha.

La facturación del local y la del barbero son **dos read models distintos**, no el mismo con un filtro. `finance:read:own` computa solo sobre turnos del propio `barberId` y a precio de lista; la pantalla debe decir con todas las letras que es facturación según precio de lista y no plata contada.

**Verificación:** un test de contrato de autorización que enumera **cada ruta × cada rol** y afirma la matriz completa de permitido/denegado. Es el artefacto que convierte "no alcanza con esconder botones" en algo comprobable en CI.

---

## Autenticación: dos modalidades según quién entra

El sistema **no** es enteramente sin contraseña. La fricción que se quiere evitar es la del **cliente ocasional**, que entra dos veces al año; no la de tres a seis personas que abren el sistema todas las mañanas. Para el staff, pedir un magic link por sesión de trabajo es peor experiencia, no mejor.

| | Cliente | Staff (dueño, secretaria, barbero) |
|---|---|---|
| Credencial | **Sin contraseña**: código de 6 dígitos o magic link | **Contraseña** |
| Canal en el login diario | Notificación (email hoy, WhatsApp después) | Ninguno — entra offline |
| Rol del email | Indispensable en cada acceso | Solo para **recuperar** la contraseña |
| Sesión | 30 días deslizantes | 12 horas deslizantes (un turno de trabajo) |

### Cliente — challenge sin contraseña

| Aspecto | Decisión |
|---------|----------|
| Challenge | Un código de 6 dígitos **y** un magic link, ambos derivados de la misma fila `auth_challenges` |
| Almacenamiento | Solo el **hash** (SHA-256) del código y del token. Nunca el texto plano |
| Expiración | 10 minutos |
| Uso único | `UPDATE ... SET consumed_at = now() WHERE id AND consumed_at IS NULL RETURNING *` — atómico, sin carrera |
| Intentos | 5 fallidos invalidan el challenge |
| Rate limit | Por email y por IP, en la emisión y en la verificación |

El envío del código sale por `NotificationPort`, igual que todo lo demás: cambiar el canal de acceso a WhatsApp es el mismo cambio de adaptador.

### Staff — contraseña

| Aspecto | Decisión |
|---------|----------|
| Hash | **argon2id**, parámetros por defecto de OWASP (19 MiB, 2 iteraciones, paralelismo 1), vía la librería `argon2` |
| Longitud mínima | 12 caracteres, sin reglas de composición ni expiración forzada |
| Comparación | La propia de argon2 (tiempo constante). El usuario inexistente igual paga el costo de un hash falso, para no filtrar qué emails existen |
| Rate limit | Por email y por IP; backoff progresivo tras 5 fallos |
| Alta | El dueño da de alta al barbero o a la secretaria; la contraseña inicial se define con un **link de activación de un solo uso** por `NotificationPort`. El sistema nunca genera ni envía una contraseña en texto plano |
| Reset | Token de 32 bytes, hash en base, 30 minutos, un solo uso, por `NotificationPort`. Reutiliza la misma tabla `auth_challenges` con un `purpose` distinto |
| Efecto del cambio | Cambiar o resetear la contraseña **revoca todas las sesiones activas** de ese usuario |

Elección de **argon2id** sobre bcrypt: es la recomendación actual de OWASP, resiste ataques con GPU y con hardware dedicado gracias al costo en memoria, y no tiene el límite de 72 bytes de bcrypt. bcrypt sería aceptable; scrypt y PBKDF2 quedan como opciones peores para un proyecto nuevo. No hay razón para elegir lo viejo cuando no hay nada que migrar.

**Consecuencia sobre la dependencia del email**: sigue siendo una dependencia, pero cambió de categoría. Antes bloqueaba el **acceso diario** de todo el local: un Gmail en spam o pasado de cuota dejaba a la secretaria afuera del panel un lunes a la mañana. Ahora solo bloquea la **recuperación**, que es un evento raro y con salida manual (el dueño puede reenviar el link de activación). Es una mejora concreta de disponibilidad operativa, además de una de experiencia.

### La cuenta del dueño

Es la única que ve la facturación del local. Recomendación —y nada más que eso, esto es una barbería, no un banco—:

- **Sí**, y sin costo: sesión más corta que la del resto del staff (**8 horas**, no 12), y registro en `security_events` de cada login, cambio de contraseña y lectura de `finance:read:shop`. Es una tabla de auditoría, no un mecanismo de defensa, y sirve para responder "quién miró qué" sin discusiones.
- **No** por ahora: segundo factor. Sumar TOTP significa sumar recuperación de TOTP, y un dueño que pierde el teléfono y queda afuera de su propio negocio es un problema peor que el que se está evitando. Queda anotado como trabajo futuro, para cuando el sistema registre plata real del mostrador y no solo señas.

### Sesión — común a ambos

Cookie `httpOnly` + `Secure` + `SameSite=Lax` con un id **opaco** contra la tabla `sessions`. Con estado en la base y **no** un JWT sin estado, deliberadamente: cuando el dueño da de baja a un barbero o le cambia los permisos a la secretaria el día de la entrega, un JWT con el rol adentro seguiría funcionando hasta expirar. Acá se revoca en una sentencia.

---

## Puertos y adaptadores

| Puerto (en `domain/`) | Adaptador MVP | Futuro |
|-----------------------|---------------|--------|
| `NotificationPort` | `GmailNotificationAdapter` (SMTP + App Password) | `WhatsAppBusinessAdapter` |
| `PaymentPort` | `MercadoPagoPaymentAdapter` (Checkout Pro + `/v1/payments/{id}/refunds`) | — |
| `Clock` | `ShopClock` con `SHOP_UTC_OFFSET` | — |
| `JobScheduler` | `PgBossScheduler` | — |
| Repositorios (`AppointmentRepository`, `AvailabilityRepository`, …) | Drizzle + PostgreSQL | — |

### Outbox transaccional para notificaciones

El dominio no manda mensajes: **escribe una intención** en `notification_outbox` dentro de la misma transacción que produjo el hecho. Un consumidor del worker la entrega vía `NotificationPort` con reintentos y backoff.

Vale la ceremonia porque "tu barbero faltó, elegí otro horario" es un mensaje que no se puede perder: sin outbox, una transacción que commitea y un SMTP que falla dejan al cliente sin enterarse. Además refuerza el puerto: el consumidor es el único que conoce el transporte, así que migrar a WhatsApp no toca ni una línea de dominio.

### Webhook de MercadoPago

Es una superficie pública y hay plata en juego:

- Verificación **obligatoria** de la firma HMAC (`x-signature`). Sin firma válida → `401`, sin tocar el dominio.
- Responder `200` de inmediato y procesar de forma asíncrona por pg-boss. Un webhook lento provoca reintentos y tormentas.
- **El redirect del navegador no es fuente de verdad.** El worker consulta `GET /v1/payments/:id` contra MercadoPago antes de confirmar.
- Idempotencia por `payment_id UNIQUE` + `UPDATE ... WHERE status='held'`: un reintento afecta cero filas y es un no-op.
- Tabla `payment_events` con el payload crudo y el veredicto de firma, para conciliación.

---

## Modelo de datos (esquema)

| Tabla | Notas |
|-------|-------|
| `users` | email, `role_id`, `barber_id?`, `client_id?`, `active`, **`password_hash?`** (argon2id; `NULL` en clientes), `password_changed_at?` |
| `roles` · `role_permissions` | El mapa rol → permisos, sembrado y editable |
| `auth_challenges` | `purpose`: `client_login` · `staff_activation` · `staff_password_reset`. Hash, expiración, `consumed_at`, intentos |
| `sessions` | Id opaco, `expires_at`, `revoked_at`, `last_seen_at` |
| `security_events` | Auditoría de la cuenta del dueño: logins, cambios de contraseña, lecturas de `finance:read:shop` |
| `clients` | nombre, teléfono, email, **edad opcional** |
| `barbers` | vinculado a `users`; alta/baja |
| `services` | duración, `price_cents` |
| `shop_hours` · `barber_schedules` | hora de pared local + día de la semana |
| `barber_time_off` | días libres **y** ausencias puntuales |
| `slot_occupancies` | **la tabla del constraint**: `barber_id`, `service_id`, `client_id?`, `channel`, `status`, `time_range tstzrange`, `hold_expires_at`, `payment_pending`, `origin_occupancy_id`, `deposit_id`, `created_by_user_id`, `marked_by_user_id` |
| `deposits` | `amount_cents`, `payment_id UNIQUE`, `state` |
| `payment_events` | auditoría cruda |
| `notification_outbox` | intención, payload, estado, intentos |

---

## Frontend

React 19 + Vite, **una sola SPA** con tres grupos de rutas separados por code splitting: pública (`/`), panel (`/panel`) y agenda del barbero (`/mi-agenda`). SSR no aporta acá: la reserva está detrás de interacción y el valor de SEO es marginal; si el local quiere presencia, una landing estática al frente resuelve mejor.

Estructura que grita el negocio: `booking/` · `agenda/` · `appointments/` · `barbers/` · `identity/`, cada una con sus containers. Atomic design para lo transversal (`components/atoms|molecules|organisms`).

### La vista del día es un componente, no dos

`DayBoard` es un **organism presentacional puro**: recibe `columns: BarberColumn[]`, `slots` y `onSlotAction`. No sabe qué rol lo está mirando.

- `AdminDayBoardContainer` → todas las columnas.
- `BarberDayBoardContainer` → la misma vista filtrada a su propia columna.

El detalle que evita que esto se degrade: **el servidor devuelve `allowedActions` por slot**. El cliente nunca decide qué puede hacer el usuario; lo dibuja. Así la UI no puede desviarse de la autorización real, y esconder o no un botón deja de tener consecuencias de seguridad.

---

## Estrategia de testing

`strict_tdd` está en `false` solo porque no hay runner. **Debe pasar a `true` al cerrar la Fase 0**, junto con `test_command: pnpm test` en `openspec/config.yaml`.

| Capa | Qué se prueba | Cómo |
|------|---------------|------|
| Dominio (unit) | Máquina de estados: las cinco transiciones válidas y **las inválidas**. `DepositState` exhaustivo. `ShopClock` en los bordes | Vitest puro, sin I/O, con `Clock` congelado |
| Aplicación | Orquestación: reasignación por ausencia, resolución de *sin registrar* | Casos de uso con adaptadores en memoria (`FakePaymentPort`, `FakeNotificationPort`) |
| Integración | **El constraint `EXCLUDE`**, el `UPDATE ... RETURNING` de confirmación, la query del barrido, el estrechamiento por `barber_id` | Testcontainers con PostgreSQL real |
| **Concurrencia** | 20 transacciones simultáneas sobre el mismo hueco → **exactamente una** gana | Testcontainers + promesas en paralelo. **Obligatorio**: es la única prueba del hold |
| Autorización | Matriz completa ruta × rol, incluyendo el fallo cerrado del handler sin decorador | Test de contrato sobre la app Nest levantada |
| Autenticación | Uso único del challenge bajo concurrencia · expiración · límite de intentos · verificación argon2id · usuario inexistente sin filtrar existencia · revocación de sesiones al cambiar la contraseña | Vitest + Testcontainers. El hash real, no un doble |
| E2E | Reservar y pagar (sandbox de MercadoPago) · ausencia y reasignación · barbero marcando lo suyo | Playwright |

Vitest en todo el monorepo (con `unplugin-swc` para los decoradores de Nest) para tener un solo runner y una sola configuración. Alternativa de menor riesgo si el plugin da problemas: Jest en `apps/api` —el camino pavimentado de Nest— y Vitest en el frontend.

---

## Matriz de amenazas

| Frontera | Aplicabilidad | Respuesta de diseño | Test RED planificado |
|----------|---------------|---------------------|----------------------|
| Rutas tipo documentación | **N/A** — no hay clasificación ni ejecución de archivos | — | — |
| Selección de repositorio git | **N/A** — sin automatización de VCS | — | — |
| Estado de commit / push / comandos de PR | **N/A** — sin automatización de PR | — | — |
| Comandos de shell / subprocesos | **N/A** — ningún adaptador ejecuta procesos externos | — | — |
| **Webhook público de MercadoPago** (integración de procesos) | **Aplicable** | Firma HMAC obligatoria; `401` sin tocar el dominio; procesamiento asíncrono; idempotencia por `payment_id UNIQUE`; el redirect del navegador no es fuente de verdad | Firma inválida → `401` y cero efectos · reintento del mismo `payment_id` → cero filas afectadas · payload `approved` falsificado sin firma → rechazado |
| **Endpoints autenticados** (routing) | **Aplicable** | Guard global deny-by-default; alcance por fila en el repositorio | Handler sin decorador → `403` · barbero pidiendo la agenda de un compañero por id → `403` · barbero pidiendo facturación del local → `403` |

---

## Secuencia de construcción por fases

Presupuesto de revisión: **400 líneas por PR**. El alcance no entra en un solo PR.

**Estrategia de entrega: `feature-branch-chain`.** Existe una rama tracker del feature; el PR #1 apunta a ella y **cada PR siguiente apunta a la rama del PR inmediatamente anterior**. Solo la rama tracker mergea a `main`. Si GitHub llega a mostrar los slices anteriores dentro del diff de un PR hijo, hay que rebasar o reapuntar hasta que el diff quede limpio: un diff sucio arruina justamente el presupuesto de revisión que motiva la cadena.

| # | Fase | ~Líneas | Depende de |
|---|------|---------|------------|
| 0 | Fundación: monorepo, Vitest, Docker Compose, Drizzle, CI, `dependency-cruiser`, `ShopClock`. **Flip `strict_tdd: true`** | 350 | — |
| 1 | **Modelo de disponibilidad**: barberos, servicios, horarios del local y por barbero, días libres, generación de huecos (solo lectura) | 400 | 0 |
| 2 | **Ocupación + `EXCLUDE` + hold**: el núcleo de concurrencia con sus tests de integración. Sin UI | 400 | 1 |
| 3a | **Identidad**: challenge sin contraseña del cliente, contraseña de staff (argon2id), login, activación, reset, sesiones revocables | 400 | 0 |
| 3b | **Autorización**: `role_permissions` sembrado, guard deny-by-default, estrechamiento por repositorio, test de contrato ruta × rol | 350 | 3a |
| 4 | **Ciclo de vida del turno**: cinco estados, transiciones, marcar realizado, resolver *sin registrar*, `DepositState` con `FakePaymentPort` | 350 | 2, 3b |
| 5 | **Pagos**: adaptador MercadoPago, checkout, webhook + firma, reembolsos, `payment_events`, invariantes `CHECK` del canal | 400 | 4 |
| 6 | **Procesos de fondo**: pg-boss, `hold.expire`, barrido 23:59, recordatorios, consumidor del outbox | 300 | 5 |
| 7 | **Notificaciones**: `NotificationPort` + adaptador Gmail + plantillas | 250 | 6 |
| 8 | **Vista del día**: organism `DayBoard` + container admin + `allowedActions` del servidor | 400 | 1, 3b |
| 9 | **Web pública**: selección de hueco, hold, checkout, cuenta al final, cancelación | 400 | 5, 8 |
| 10 | **Operación del panel**: turnos telefónicos, walk-ins, edición, cancelación, clientes, configuración | 400 | 8 |
| 11 | **Perfil del barbero**: agenda propia, estadísticas a precio de lista, marcado propio | 300 | 8, 10 |
| 12 | **Reasignación por ausencia**: orquestación sobre hold + notificaciones | 350 | 2, 6, 7, 10 |

Total estimado: **~5.050 líneas en 14 PRs encadenados**.

La fase 3 se parte en dos porque la contraseña de staff la empujó por encima del presupuesto: hash, login, activación, reset y revocación de sesiones no entran junto con el modelo de permisos y su test de contrato. El corte además es limpio —3a deja al usuario autenticado, 3b decide qué puede hacer— y cada mitad tiene su propia verificación.

Las fases 1 y 3a pueden ir en paralelo si hay dos personas. La 12 va última a propósito: es la que más dependencias acumula, y es también la que le demuestra el valor al dueño. La 8 va antes que la 9 y la 11 porque `DayBoard` se comparte entre las tres.

---

## Migración y despliegue

No hay migración de datos: proyecto desde cero, sin datos productivos. La carga inicial de barberos, servicios, horarios y precios es una tarea de configuración del panel el día de la entrega, no un script.

Reversión antes del lanzamiento: descartar la rama. Después del lanzamiento: apagar el punto de entrada de reserva online (flag de configuración) y volver temporalmente a teléfono, conservando el historial. Las transacciones de MercadoPago quedan auditables por su lado.

---

## Preguntas abiertas

- [ ] **Detalles vigentes de la API de MercadoPago** (formato exacto de `x-signature`, ventana de reembolso, comportamiento de reembolso parcial). Verificar contra la documentación oficial al implementar la Fase 5; el diseño no depende de ninguno en particular, pero la Fase 5 sí.

### Resueltas durante el diseño

| Pregunta | Resolución |
|----------|------------|
| Entropía del código de 6 dígitos para cuentas de staff | **El staff usa contraseña.** La pregunta se disuelve: no hay código por mail que proteger. La fricción que se quería evitar era la del cliente ocasional, no la de quien entra todas las mañanas. Ver [Autenticación](#autenticación-dos-modalidades-según-quién-entra) |
| ¿El barrido de las 23:59 alcanza a los turnos sin seña? | **Sí, a todo turno en `reservado`.** El "con seña pagada" del README era un resto de cuando todos los turnos llevaban seña; el README ya se corrigió |
| Qué ve la secretaria al perder una carrera contra un hold web | **`409` con huecos alternativos**, idéntico al camino del cliente, con distinta redacción en pantalla. Nunca puede forzar la escritura sobre un hold vigente |
