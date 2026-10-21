-- pgvector for complaints.embedding (FR-2.5, D-08 Q5a). Must exist before the tables.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "complaint_status" AS ENUM ('submitted', 'verified', 'routed', 'assigned', 'in_progress', 'resolved', 'rejected', 'escalated');

-- CreateEnum
CREATE TYPE "category" AS ENUM ('roads', 'sanitation', 'streetlights', 'water_supply', 'drainage');

-- CreateEnum
CREATE TYPE "priority" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "area_type" AS ENUM ('urban', 'rural');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('staff', 'admin');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('email', 'push', 'whatsapp');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('queued', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "delivery_mode" AS ENUM ('log', 'sandbox', 'live');

-- CreateEnum
CREATE TYPE "office_kind" AS ENUM ('gram_panchayat', 'bdo', 'nagar_nigam_zone', 'municipal_commissioner', 'dept_division', 'dept_circle', 'dm_igrs');

-- CreateEnum
CREATE TYPE "status_history_event" AS ENUM ('status_change', 're_routed', 'closed', 'escalated');

-- CreateEnum
CREATE TYPE "closure_reason" AS ENUM ('citizen_confirmed', 'confirmation_timeout');

-- CreateEnum
CREATE TYPE "remark_visibility" AS ENUM ('citizen', 'internal');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('staff', 'admin', 'system', 'citizen', 'office_link');

-- CreateEnum
CREATE TYPE "status_link_revoke_reason" AS ENUM ('superseded', 'office_changed', 'terminal', 'used', 'disabled');

-- CreateEnum
CREATE TYPE "review_reason" AS ENUM ('photo_low_conf', 'photo_dispute', 'retakes_exhausted', 'classification_low_conf');

-- CreateEnum
CREATE TYPE "road_class" AS ENUM ('main', 'local', 'unsure');

-- CreateEnum
CREATE TYPE "priority_source" AS ENUM ('rules', 'manual');

-- CreateEnum
CREATE TYPE "ai_step" AS ENUM ('classify', 'duplicates');

-- CreateEnum
CREATE TYPE "integrity_tier" AS ENUM ('passed', 'failed', 'unknown');

-- CreateEnum
CREATE TYPE "locale" AS ENUM ('hi', 'en');

-- CreateEnum
CREATE TYPE "flag_reason" AS ENUM ('spam', 'abusive', 'duplicate-abuse', 'other');

-- CreateEnum
CREATE TYPE "flag_state" AS ENUM ('open', 'confirmed', 'dismissed');

-- CreateEnum
CREATE TYPE "ulb_kind" AS ENUM ('nagar_nigam', 'nagar_palika_parishad', 'nagar_panchayat');

-- CreateEnum
CREATE TYPE "merge_extent" AS ENUM ('full', 'partial');

-- CreateEnum
CREATE TYPE "coord_source" AS ENUM ('shrug_pc11');

-- CreateEnum
CREATE TYPE "helpline" AS ENUM ('1912', '14420');

-- CreateTable
CREATE TABLE "districts" (
    "id" SERIAL NOT NULL,
    "lgd_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_hi" TEXT,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" SERIAL NOT NULL,
    "district_id" INTEGER NOT NULL,
    "lgd_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_hi" TEXT,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "villages" (
    "id" SERIAL NOT NULL,
    "district_id" INTEGER NOT NULL,
    "block_id" INTEGER NOT NULL,
    "lgd_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_hi" TEXT,
    "area_type" "area_type" NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "pc11_code" TEXT,
    "coord_source" "coord_source",
    "merged_ulb_id" INTEGER,
    "merge_extent" "merge_extent",

    CONSTRAINT "villages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gram_panchayats" (
    "id" SERIAL NOT NULL,
    "lgd_code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_hi" TEXT,
    "block_id" INTEGER NOT NULL,

    CONSTRAINT "gram_panchayats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "village_gp_map" (
    "village_id" INTEGER NOT NULL,
    "gp_id" INTEGER NOT NULL,
    "is_full" BOOLEAN NOT NULL,

    CONSTRAINT "village_gp_map_pkey" PRIMARY KEY ("village_id","gp_id")
);

-- CreateTable
CREATE TABLE "ulbs" (
    "id" SERIAL NOT NULL,
    "lgd_code" TEXT NOT NULL,
    "district_id" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_hi" TEXT,
    "kind" "ulb_kind" NOT NULL,
    "supported" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ulbs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" SERIAL NOT NULL,
    "ulb_id" INTEGER NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_hi" TEXT,
    "source_url" TEXT NOT NULL,
    "as_of" DATE NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wards" (
    "id" SERIAL NOT NULL,
    "ulb_id" INTEGER NOT NULL,
    "lgd_code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_hi" TEXT,
    "as_of" DATE NOT NULL,
    "zone_id" INTEGER,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpline_coverage" (
    "id" SERIAL NOT NULL,
    "district_id" INTEGER NOT NULL,
    "area_type" "area_type" NOT NULL,
    "helpline" "helpline" NOT NULL,
    "source_url" TEXT NOT NULL,
    "last_verified_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpline_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category_map" JSONB NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_contacts" (
    "id" SERIAL NOT NULL,
    "district_id" INTEGER NOT NULL,
    "block_id" INTEGER,
    "department_id" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "office_kind" "office_kind" NOT NULL,
    "office_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "source_url" TEXT NOT NULL,
    "last_verified_at" TIMESTAMP(3) NOT NULL,
    "status_link_enabled" BOOLEAN NOT NULL DEFAULT true,
    "gram_panchayat_id" INTEGER,
    "ulb_id" INTEGER,
    "zone_id" INTEGER,

    CONSTRAINT "office_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "department_id" INTEGER,
    "district_id" INTEGER,
    "office_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citizens" (
    "id" SERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "push_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),
    "integrity_tier" "integrity_tier" NOT NULL DEFAULT 'unknown',
    "integrity_checked_at" TIMESTAMP(3),
    "locale" "locale" NOT NULL DEFAULT 'hi',
    "recovery_lookup" TEXT,
    "recovery_hash" TEXT,
    "recovery_issued_at" TIMESTAMP(3),
    "blocked_at" TIMESTAMP(3),

    CONSTRAINT "citizens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" SERIAL NOT NULL,
    "complaint_no" TEXT NOT NULL,
    "client_ref" TEXT NOT NULL,
    "citizen_id" INTEGER NOT NULL,
    "village_id" INTEGER,
    "ward_id" INTEGER,
    "block_id" INTEGER,
    "area_type" "area_type" NOT NULL,
    "category" "category" NOT NULL,
    "note" TEXT,
    "description_en" TEXT,
    "description_hi" TEXT,
    "priority" "priority",
    "priority_source" "priority_source" NOT NULL DEFAULT 'rules',
    "priority_rules" JSONB,
    "priority_cues" JSONB,
    "priority_critical_rises" INTEGER NOT NULL DEFAULT 0,
    "department_id" INTEGER,
    "office_contact_id" INTEGER,
    "escalation_level" INTEGER,
    "routing_trace" JSONB,
    "road_class" "road_class" NOT NULL DEFAULT 'unsure',
    "status" "complaint_status" NOT NULL DEFAULT 'submitted',
    "image_url" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "gps_accuracy_m" DOUBLE PRECISION,
    "ai_confidence" DOUBLE PRECISION,
    "igrs_ref" TEXT,
    "vision_mode" TEXT NOT NULL DEFAULT 'none',
    "ai_status" TEXT,
    "ai_pending_steps" "ai_step"[] DEFAULT ARRAY[]::"ai_step"[],
    "ai_attempts" INTEGER NOT NULL DEFAULT 0,
    "ai_next_attempt_at" TIMESTAMP(3),
    "ai_first_failed_at" TIMESTAMP(3),
    "ai_last_error" TEXT,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "review_reason" "review_reason",
    "review_flagged_at" TIMESTAMP(3),
    "image_verdict" TEXT,
    "citizen_confirmed_at" TIMESTAMP(3),
    "citizen_action_since" TIMESTAMP(3),
    "photo_attempts" INTEGER NOT NULL DEFAULT 0,
    "withdrawn_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "routed_at" TIMESTAMP(3),
    "last_response_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closure_reason" "closure_reason",
    "reopened_at" TIMESTAMP(3),
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "not_fixed_note" TEXT,
    "duplicate_of_id" INTEGER,
    "duplicate_score" DOUBLE PRECISION,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(384),
    "track_token_hash" TEXT,
    "track_token_rotated_at" TIMESTAMP(3),
    "deletion_requested_at" TIMESTAMP(3),
    "data_deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL,

    CONSTRAINT "complaint_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" SERIAL NOT NULL,
    "complaint_id" INTEGER NOT NULL,
    "old_status" "complaint_status",
    "new_status" "complaint_status" NOT NULL,
    "event" "status_history_event" NOT NULL DEFAULT 'status_change',
    "remark" TEXT,
    "remark_visibility" "remark_visibility" NOT NULL DEFAULT 'citizen',
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" INTEGER,
    "actor_office_contact_id" INTEGER,
    "status_link_id" INTEGER,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalations" (
    "id" SERIAL NOT NULL,
    "complaint_id" INTEGER NOT NULL,
    "from_level" INTEGER NOT NULL,
    "to_level" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "complaint_id" INTEGER,
    "channel" "notification_channel" NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'queued',
    "kind" TEXT NOT NULL,
    "cycle" TIMESTAMP(3),
    "delivery_mode" "delivery_mode" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_links" (
    "id" SERIAL NOT NULL,
    "token_hash" TEXT NOT NULL,
    "complaint_id" INTEGER NOT NULL,
    "office_contact_id" INTEGER NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" "status_link_revoke_reason",
    "used_ip_hash" TEXT,
    "used_ua_summary" TEXT,
    "forensics_clear_at" TIMESTAMP(3),

    CONSTRAINT "status_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_user_id" INTEGER,
    "actor_office_contact_id" INTEGER,
    "status_link_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routing_gaps" (
    "id" SERIAL NOT NULL,
    "complaint_id" INTEGER,
    "level" INTEGER NOT NULL,
    "office_kind" "office_kind",
    "missing" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "routing_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaint_flags" (
    "id" SERIAL NOT NULL,
    "complaint_id" INTEGER NOT NULL,
    "raised_by" INTEGER NOT NULL,
    "reason" "flag_reason" NOT NULL,
    "note" TEXT,
    "state" "flag_state" NOT NULL DEFAULT 'open',
    "decided_by" INTEGER,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaint_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_ledger" (
    "complaint_id" INTEGER NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deletion_ledger_pkey" PRIMARY KEY ("complaint_id")
);

-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("scope","key","window_start")
);

-- CreateIndex
CREATE UNIQUE INDEX "districts_lgd_code_key" ON "districts"("lgd_code");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_lgd_code_key" ON "blocks"("lgd_code");

-- CreateIndex
CREATE INDEX "blocks_district_id_idx" ON "blocks"("district_id");

-- CreateIndex
CREATE UNIQUE INDEX "villages_lgd_code_key" ON "villages"("lgd_code");

-- CreateIndex
CREATE INDEX "villages_block_id_idx" ON "villages"("block_id");

-- CreateIndex
CREATE UNIQUE INDEX "gram_panchayats_lgd_code_key" ON "gram_panchayats"("lgd_code");

-- CreateIndex
CREATE INDEX "gram_panchayats_block_id_idx" ON "gram_panchayats"("block_id");

-- CreateIndex
CREATE UNIQUE INDEX "ulbs_lgd_code_key" ON "ulbs"("lgd_code");

-- CreateIndex
CREATE UNIQUE INDEX "wards_lgd_code_key" ON "wards"("lgd_code");

-- CreateIndex
CREATE INDEX "wards_ulb_id_idx" ON "wards"("ulb_id");

-- CreateIndex
CREATE UNIQUE INDEX "helpline_coverage_district_id_area_type_helpline_key" ON "helpline_coverage"("district_id", "area_type", "helpline");

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE INDEX "office_contacts_district_id_level_idx" ON "office_contacts"("district_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "citizens_token_hash_key" ON "citizens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "citizens_recovery_lookup_key" ON "citizens"("recovery_lookup");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_complaint_no_key" ON "complaints"("complaint_no");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_client_ref_key" ON "complaints"("client_ref");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_track_token_hash_key" ON "complaints"("track_token_hash");

-- CreateIndex
CREATE INDEX "complaints_village_id_idx" ON "complaints"("village_id");

-- CreateIndex
CREATE INDEX "complaints_ward_id_idx" ON "complaints"("ward_id");

-- CreateIndex
CREATE INDEX "complaints_status_idx" ON "complaints"("status");

-- CreateIndex
CREATE INDEX "complaints_created_at_idx" ON "complaints"("created_at");

-- CreateIndex
CREATE INDEX "complaints_office_contact_id_idx" ON "complaints"("office_contact_id");

-- CreateIndex
CREATE INDEX "status_history_complaint_id_changed_at_idx" ON "status_history"("complaint_id", "changed_at");

-- CreateIndex
CREATE INDEX "escalations_complaint_id_idx" ON "escalations"("complaint_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_complaint_id_kind_cycle_key" ON "notifications"("complaint_id", "kind", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "status_links_token_hash_key" ON "status_links"("token_hash");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "villages" ADD CONSTRAINT "villages_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "villages" ADD CONSTRAINT "villages_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "villages" ADD CONSTRAINT "villages_merged_ulb_id_fkey" FOREIGN KEY ("merged_ulb_id") REFERENCES "ulbs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gram_panchayats" ADD CONSTRAINT "gram_panchayats_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "village_gp_map" ADD CONSTRAINT "village_gp_map_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "village_gp_map" ADD CONSTRAINT "village_gp_map_gp_id_fkey" FOREIGN KEY ("gp_id") REFERENCES "gram_panchayats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ulbs" ADD CONSTRAINT "ulbs_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_ulb_id_fkey" FOREIGN KEY ("ulb_id") REFERENCES "ulbs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_ulb_id_fkey" FOREIGN KEY ("ulb_id") REFERENCES "ulbs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpline_coverage" ADD CONSTRAINT "helpline_coverage_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_contacts" ADD CONSTRAINT "office_contacts_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_contacts" ADD CONSTRAINT "office_contacts_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_contacts" ADD CONSTRAINT "office_contacts_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_contacts" ADD CONSTRAINT "office_contacts_gram_panchayat_id_fkey" FOREIGN KEY ("gram_panchayat_id") REFERENCES "gram_panchayats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_contacts" ADD CONSTRAINT "office_contacts_ulb_id_fkey" FOREIGN KEY ("ulb_id") REFERENCES "ulbs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "office_contacts" ADD CONSTRAINT "office_contacts_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "office_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_citizen_id_fkey" FOREIGN KEY ("citizen_id") REFERENCES "citizens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_block_id_fkey" FOREIGN KEY ("block_id") REFERENCES "blocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_office_contact_id_fkey" FOREIGN KEY ("office_contact_id") REFERENCES "office_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "complaints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_office_contact_id_fkey" FOREIGN KEY ("actor_office_contact_id") REFERENCES "office_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_status_link_id_fkey" FOREIGN KEY ("status_link_id") REFERENCES "status_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalations" ADD CONSTRAINT "escalations_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_links" ADD CONSTRAINT "status_links_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_links" ADD CONSTRAINT "status_links_office_contact_id_fkey" FOREIGN KEY ("office_contact_id") REFERENCES "office_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_office_contact_id_fkey" FOREIGN KEY ("actor_office_contact_id") REFERENCES "office_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_status_link_id_fkey" FOREIGN KEY ("status_link_id") REFERENCES "status_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routing_gaps" ADD CONSTRAINT "routing_gaps_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_flags" ADD CONSTRAINT "complaint_flags_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_flags" ADD CONSTRAINT "complaint_flags_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_flags" ADD CONSTRAINT "complaint_flags_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express (I-02 acceptance criteria)
-- ---------------------------------------------------------------------------

-- Exactly one location: a village or a ward (D-06 Q1).
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_one_location_chk"
  CHECK (num_nonnulls("village_id", "ward_id") = 1);

-- Complaint number format JAW-<YYYY>-<6+ digits> (D-15 Q1).
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_complaint_no_format_chk"
  CHECK ("complaint_no" ~ '^JAW-[0-9]{4}-[0-9]{6,}$');

-- Escalation level 1–3 (D-05 Q6), one reopen at most (D-04 Q4), up to 3 retakes (D-03 FU2).
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_escalation_level_chk"
  CHECK ("escalation_level" IS NULL OR "escalation_level" BETWEEN 1 AND 3);
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_reopen_count_chk"
  CHECK ("reopen_count" BETWEEN 0 AND 1);
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_photo_attempts_chk"
  CHECK ("photo_attempts" BETWEEN 0 AND 3);

-- Office ladder level 1–3 (D-05 Q6).
ALTER TABLE "office_contacts" ADD CONSTRAINT "office_contacts_level_chk"
  CHECK ("level" BETWEEN 1 AND 3);

-- Staff users need a login identifier: phone or email (PRD §5.4).
ALTER TABLE "users" ADD CONSTRAINT "users_phone_or_email_chk"
  CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

-- Actor attribution (D-11 Q2): staff/admin need a user; office_link needs the link and office.
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_chk"
  CHECK (
    ("actor_type" NOT IN ('staff', 'admin') OR "actor_user_id" IS NOT NULL)
    AND ("actor_type" <> 'office_link' OR ("status_link_id" IS NOT NULL AND "actor_office_contact_id" IS NOT NULL))
  );
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_chk"
  CHECK (
    ("actor_type" NOT IN ('staff', 'admin') OR "actor_user_id" IS NOT NULL)
    AND ("actor_type" <> 'office_link' OR ("status_link_id" IS NOT NULL AND "actor_office_contact_id" IS NOT NULL))
  );

-- At most one live status link per (complaint, office) (D-11 Q1).
CREATE UNIQUE INDEX "status_links_one_live_per_office_idx"
  ON "status_links" ("complaint_id", "office_contact_id")
  WHERE "used_at" IS NULL AND "revoked_at" IS NULL;
