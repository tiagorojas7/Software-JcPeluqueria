CREATE TABLE "slot_occupancies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"barber_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"client_id" uuid,
	"channel" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"time_range" "tstzrange" NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"payment_pending" boolean DEFAULT false NOT NULL,
	"origin_occupancy_id" uuid,
	"deposit_id" uuid
);
--> statement-breakpoint
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "slot_occupancies_barber_id_barbers_id_fk" FOREIGN KEY ("barber_id") REFERENCES "public"."barbers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "slot_occupancies_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "slot_occupancies_origin_occupancy_id_slot_occupancies_id_fk" FOREIGN KEY ("origin_occupancy_id") REFERENCES "public"."slot_occupancies"("id") ON DELETE no action ON UPDATE no action;