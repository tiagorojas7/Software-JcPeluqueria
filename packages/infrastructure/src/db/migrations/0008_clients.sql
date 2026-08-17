-- Numbered 0008, not 0007: the parallel payments branch
-- (feat/turnero-05a-cobro) owns 0007 for `deposits`/`payment_events`. Kept
-- open on purpose so the two branches merge without a filename collision.
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(30) NOT NULL,
	"email" varchar(255),
	"age" integer
);
--> statement-breakpoint
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "slot_occupancies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;