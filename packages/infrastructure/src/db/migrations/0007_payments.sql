CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount_cents" integer NOT NULL,
	"payment_id" varchar(100) NOT NULL,
	"state" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_payment_id_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" varchar(100) NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"signature_valid" boolean NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Hand-written, same reason as migration 0003: drizzle-kit generate cannot
-- express CHECK constraints, only CREATE TABLE/ALTER TABLE ADD COLUMN. Now
-- that `deposits` exists, `slot_occupancies.deposit_id` also gets its FK —
-- deferred from Phase 2 for the same reason client_id/deposit_id in general
-- were deferred (the referenced table did not exist yet).
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "slot_occupancies_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- design.md "La seña la decide el canal": a web-channel row that left the
-- hold stage (status no longer 'held'/'liberado') MUST carry a deposit.
-- Structurally makes "pagar despues" on the web channel unrepresentable.
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "web_channel_requires_deposit_once_settled" CHECK ("channel" <> 'web' OR "status" IN ('held', 'liberado') OR "deposit_id" IS NOT NULL);--> statement-breakpoint
-- The inverse: phone and walk-in bookings NEVER carry a deposit — the shop
-- never takes a deposit outside the web checkout flow.
ALTER TABLE "slot_occupancies" ADD CONSTRAINT "only_web_channel_carries_deposit" CHECK ("channel" = 'web' OR "deposit_id" IS NULL);
