-- Hand-written: Drizzle cannot express an EXCLUDE constraint. This is the
-- single guarantee that makes double booking structurally impossible — two
-- concurrent transactions claiming the same barber and range cannot both
-- win, the loser gets 23P01. btree_gist is what lets the plain-equality
-- barber_id share a GiST index with the range operator.
--
-- The predicate cannot reference now() (not immutable), so an expired hold
-- keeps occupying until something flips its status to 'liberado'. That lazy
-- release is task 2.9, not this migration.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "slot_occupancies"
  ADD CONSTRAINT "no_overlap_per_barber"
  EXCLUDE USING gist (barber_id WITH =, time_range WITH &&)
  WHERE (status IN ('held', 'reservado', 'realizado'));
