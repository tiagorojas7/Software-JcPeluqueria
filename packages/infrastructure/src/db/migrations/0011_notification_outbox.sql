-- Hand-written, same reason as migrations 0009/0010 (drizzle-kit generate
-- fails on the pre-existing snapshot-lineage collision from the parallel
-- phase branches merged into this history). The migrator only reads this
-- file + meta/_journal.json, never the snapshots.
--
-- Closes the gap tasks.md's Slice A opens with: "7.8 decia 'plantillas
-- conectadas a los outbox-writers'. No hay tabla notification_outbox ni
-- adaptador: no estan conectadas a nada." This table never existed anywhere
-- in this codebase before this migration — the only prior
-- `NotificationOutboxRepository` was `FakeNotificationOutboxRepository`
-- (domain testing), so every writer/consumer built against the port ran only
-- against an in-memory double until now.
--
-- Column set matches the tracker's A.1 list (notification_type/
-- recipient_email/payload/attempts/status/last_error/created_at) plus
-- `next_attempt_at`, the backoff-due timestamp the domain port's own contract
-- asks the infra implementation to own (packages/domain/src/notifications/
-- notification-outbox.ts: "the backoff handled entirely HERE so the consumer
-- never computes a due time").
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_type" varchar(40) NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Supports `pickPendingForDelivery`'s exact predicate (`status = 'pending'
-- AND next_attempt_at <= now()`), partial so a table full of
-- `delivered`/`dead` rows never bloats the index the live queue actually scans.
CREATE INDEX "notification_outbox_pending_idx" ON "notification_outbox" ("status","next_attempt_at") WHERE "status" = 'pending';
