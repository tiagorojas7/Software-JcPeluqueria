-- El dueño reportó dos huecos que son la misma causa: no había forma de
-- reactivar a un barbero dado de baja (una gripe de un día obligaba a
-- reconfigurar el horario entero al volver), y no había forma de eliminar a
-- un barbero que nunca llegó a trabajar (email mal tipeado, nunca activó la
-- cuenta). La causa: `active=false` significaba "de baja" sin distinguir
-- temporal de definitiva, así que ni siquiera existía la pregunta "¿este
-- barbero puede volver?".
--
-- `active` sigue siendo el ÚNICO gate de disponibilidad — todo lector
-- existente de esa columna (AvailabilityService, ListPublicBarbersUseCase,
-- ...) sigue funcionando sin tocarlo. `permanent_leave` es la columna nueva,
-- y el CHECK hace irrepresentable el único estado que no tiene sentido: un
-- barbero activo Y de baja definitiva a la vez.
ALTER TABLE "barbers" ADD COLUMN "permanent_leave" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "barbers" ADD CONSTRAINT "barbers_active_permanent_leave_check" CHECK (NOT ("active" AND "permanent_leave"));
