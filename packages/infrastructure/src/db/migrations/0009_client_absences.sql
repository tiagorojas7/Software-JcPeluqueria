-- The absence history the appointment-lifecycle spec calls "historial de
-- ausencias del cliente" (task 10.11: the repository seam ConfirmAbsenceUseCase
-- waited for). One row per confirmed absence — written whether or not a seña
-- was forfeited, because when there is no money to move the history entry is
-- the entire effect of confirming an absence.
CREATE TABLE "client_absences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"confirmed_by_user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	"deposit_forfeited" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_absences" ADD CONSTRAINT "client_absences_appointment_id_slot_occupancies_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."slot_occupancies"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_absences" ADD CONSTRAINT "client_absences_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "client_absences" ADD CONSTRAINT "client_absences_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
