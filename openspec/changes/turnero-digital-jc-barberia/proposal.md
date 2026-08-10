# Propuesta: Turnero Digital — MVP de JC Barbería

> La lógica de negocio completa vive en el [README](../../../README.md). Este documento define el alcance, el enfoque y los límites del cambio.

## Intención

Reemplazar la agenda telefónica en papel por un sistema digital que cubra tres frentes: la reserva de turnos por parte del cliente, el manejo de ausencias de barberos por parte del local, y la operación diaria de la barbería.

Hoy no existe una fuente de verdad consultable sobre quién está reservado con quién. Eso obliga a llamar cliente por cliente cada vez que falta un barbero, limita las reservas al horario en que hay alguien atendiendo el teléfono, y deja el ausentismo sin ninguna barrera.

El MVP se le presenta al dueño como una solución funcionando. **El sistema es híbrido a propósito:** lo digital convive con el teléfono y el walk-in, no los reemplaza.

## Alcance

### Adentro

**Reserva y pago**
- Cuenta de cliente obligatoria, sin contraseña, creada al final del flujo de reserva
- Acceso por código o link enviado al canal de notificación
- Reserva desde la web con seña del 50% vía MercadoPago
- Cancelación del cliente hasta 1 hora antes, con reembolso automático
- Hold de 15 minutos sobre cualquier horario ofrecido o seleccionado

**Ciclo de vida del turno**
- Estados explícitos: reservado, realizado, cancelado, sin registrar, ausente
- Barrido diario a las 23:59 (UTC-3 fijo) que pasa los turnos sin marcar a *sin registrar*
- Resolución humana de los turnos *sin registrar* al día siguiente
- La seña solo se pierde con una ausencia confirmada por una persona

**Ausencia del barbero**
- La secretaria marca a un barbero como no disponible para una franja
- El sistema ofrece huecos libres del mismo día, de cualquier barbero
- Cada oferta queda protegida por el hold de 15 minutos
- Sin aceptación, reembolso automático. Nunca se modifican turnos de otros clientes

**Panel admin**
- Crear turnos telefónicos, editar, cancelar, marcar realizados, resolver pendientes
- Vista del día con una columna por barbero
- Carga de walk-ins con servicio y barbero
- Gestión de clientes y de barberos
- Configuración de horarios del local, horarios por barbero y precios

**Perfil del barbero**
- Agenda propia del día en vista visual
- Cantidad de cortes y facturación generada según precio de lista
- Marcado de sus propios cortes como realizados

**Base**
- Tres roles con permisos aplicados en el backend: dueño, secretaria, barbero
- Puerto de notificaciones con adaptador de email (Gmail) para el MVP
- Disponibilidad modelada por barbero

### Afuera

- Inventario y stock de productos
- Modelo de comisiones y liquidación de sueldos
- POS completo del corte (más allá de la seña)
- Programas de fidelización, marketing masivo, reseñas y calificaciones
- Multi-sucursal
- Reportes y analítica más allá de lo operativo
- Reprogramación en el lugar por parte del cliente: solo cancelar y reservar de nuevo
- Integración con WhatsApp Business API: queda como trabajo futuro para sacar la verificación de Meta del camino crítico
- Cobro de seña en turnos telefónicos durante la transición

## Capacidades nuevas

| Capacidad | Qué cubre |
|-----------|-----------|
| `client-booking` | Cuenta sin contraseña, búsqueda y selección de horarios, pago de seña, cancelación |
| `appointment-lifecycle` | Máquina de estados y barrido diario de las 23:59 |
| `slot-hold` | Hold de 15 minutos, vencimiento, reembolso automático, re-validación |
| `barber-absence-reassignment` | Flujo de oferta del mismo día, cualquier barbero, montado sobre `slot-hold` |
| `admin-operations` | Turnos telefónicos, edición, cancelación, marcado, walk-ins, gestión y configuración |
| `barber-profile` | Agenda propia, estadísticas de cortes y facturación |
| `access-control` | Tres roles con permisos aplicados en el backend |
| `notification-port` | Interfaz de adaptadores + adaptador Gmail |

Este es un proyecto desde cero: no hay capacidades existentes que modificar.

## Enfoque

**Primero el modelo de disponibilidad** — barberos, servicios, horarios por barbero, huecos. Es prerequisito duro del flujo de ausencias: sin el concepto de "hueco libre" no hay nada que ofrecer.

Sobre esa base va el hold de 15 minutos como infraestructura compartida de reservas, después la máquina de estados, después los procesos programados, y por último el puerto de notificaciones.

**Los permisos van desde el arranque, no después.** Con tres roles y un barbero que no debe ver la facturación del local, la autorización es estructural. Agregarla más tarde significa rehacer lo construido, no sumarle una capa.

**La vista del día por columnas se comparte.** El panel admin la necesita para manejar ausencias y cargar walk-ins; la agenda del barbero es esa misma vista filtrada a su columna.

**El stack no se elige acá** — corresponde a la fase de diseño. Esta propuesta fija las restricciones que el stack tiene que satisfacer:

- Integración real con pasarela de pago (MercadoPago: cobros y reembolsos automáticos)
- Ejecución programada confiable: vencimiento de holds, barrido diario y recordatorios
- Autenticación sin contraseña, con roles y autorización en el backend

## Restricciones de diseño

| Restricción | Detalle |
|-------------|---------|
| **El canal decide si hay seña** | En la web es obligatoria y no existe camino para reservar sin pagarla; por teléfono y walk-in no aplica. El cliente nunca elige. Como conviven turnos con seña y sin seña, toda la lógica de reembolso, pérdida y vencimiento tiene que funcionar cuando no hay nada que devolver. No es un caso borde: al principio va a ser la mayoría |
| **Zona horaria** | El barrido de las 23:59 usa UTC-3 fijo de Argentina, sin horario de verano. Nunca hora del servidor ni UTC |
| **Procesos de fondo** | Tres procesos independientes: vencimiento de holds, barrido diario, recordatorios |
| **Canal intercambiable** | El dominio emite intenciones de notificación y desconoce el transporte. Migrar a WhatsApp debe ser cambiar de adaptador |
| **La facturación es teórica** | Sale de precios de lista. El sistema no registra el 50% del mostrador, y la interfaz debe decirlo |

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| El turno telefónico sin seña deja el ausentismo sin resolver donde más volumen hay, y genera un incentivo a seguir llamando | Alta (aceptada) | Los recordatorios llegan igual. El historial de ausencias se registra aunque no haya seña, habilitando exigir seña más adelante a quienes faltan seguido |
| El personal no resuelve los turnos *sin registrar* y se acumulan | Media | Los pendientes deben ser lo primero visible al abrir el panel. Cada barbero marca sus propios cortes, repartiendo la carga |
| El alcance creció con roles, perfiles y estadísticas | Media | Muy probable que haga falta partir la entrega en PRs encadenados. Presupuesto de revisión: 400 líneas |
| Límites de Gmail: ~500 envíos/día, App Password, entregabilidad pobre | Alta (aceptada) | Detrás del puerto desde el día uno. Migrar a WhatsApp es cambiar de adaptador |
| El email tiene la peor tasa de apertura para cambios del mismo día | Media | Aceptado como tradeoff temporal hasta migrar a WhatsApp |
| Permisos aplicados solo en la interfaz | Baja | Explícitamente prohibido: la autorización se resuelve en el backend |

## Plan de reversión

Antes del lanzamiento no hay datos productivos: revertir es descartar la rama.

Después del lanzamiento: se deshabilita la reserva online y se vuelve temporalmente a teléfono y papel, conservando el historial de turnos y las cuentas para conciliar. Las transacciones de MercadoPago quedan auditables por su lado.

## Dependencias

- Cuenta de comercio de MercadoPago con credenciales de API
- Cuenta de Gmail con App Password para las notificaciones del MVP
- Elección de stack y test runner en la fase de diseño. El proyecto todavía no tiene runner, por eso `strict_tdd` está en `false`; corresponde activarlo cuando exista

## Criterios de éxito

- [ ] Un cliente crea su cuenta sin contraseña, reserva, paga la seña del 50% y cancela hasta 1 hora antes con reembolso automático
- [ ] La ausencia de un barbero dispara ofertas del mismo día de cualquier barbero, protegidas por el hold, con reembolso automático si no acepta
- [ ] Los turnos sin marcar caen a *sin registrar* y solo pierden la seña cuando una persona confirma la ausencia
- [ ] La secretaria crea turnos telefónicos sin seña, carga walk-ins con servicio y barbero, y configura lo que le corresponde
- [ ] Un barbero entra a su perfil, ve su agenda del día y sus cortes, marca los suyos como realizados, y no accede a la facturación del local ni a datos de sus compañeros
- [ ] Las notificaciones salen por el puerto con Gmail como único adaptador implementado, y migrar a WhatsApp no toca el dominio

## Trabajo futuro

- Adaptador de WhatsApp Business API y migración desde Gmail
- Modelo de comisiones, para mostrar ganancia real en vez de facturación
- Cobro de seña en turnos telefónicos, una vez pasada la transición
- Reprogramación en el lugar por parte del cliente, manteniendo la seña
- Corrección de un turno mal marcado después de resuelto
- Registro del 50% cobrado en el mostrador
- Activar TDD estricto cuando exista stack y test runner

## Para revisar el día de la entrega

- Si la secretaria debería tener los mismos permisos que el dueño
- Si conviene empezar a cobrar seña en los turnos telefónicos
