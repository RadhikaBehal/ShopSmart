BEGIN;

-- CreateEnum
CREATE TYPE "ProductModerationStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'DISABLED');

-- CreateEnum
CREATE TYPE "InventoryAdjustmentReason" AS ENUM ('INITIAL_STOCK', 'RESTOCK', 'CORRECTION', 'DAMAGE', 'RETURN', 'OTHER');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "moderatedAt" TIMESTAMP(3),
ADD COLUMN "moderatedById" TEXT,
ADD COLUMN "moderationNote" VARCHAR(2000),
ADD COLUMN "moderationStatus" "ProductModerationStatus" NOT NULL DEFAULT 'PENDING_REVIEW';

-- Pre-existing listings retain their prior catalog eligibility. No moderation actor or
-- timestamp is fabricated for these grandfathered approvals.
UPDATE "Product"
SET "moderationStatus" = 'APPROVED'::"ProductModerationStatus";

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "ProductInventoryAdjustment" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "actorId" TEXT,
    "quantityBefore" INTEGER NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "quantityAfter" INTEGER NOT NULL,
    "reason" "InventoryAdjustmentReason" NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductInventoryAdjustment_pkey" PRIMARY KEY ("id")
);

-- Preserve each existing positive stock balance as an opening balance. These
-- records mark the ledger start; they do not claim to reconstruct prior history.
INSERT INTO "ProductInventoryAdjustment" (
    "id", "variantId", "actorId", "quantityBefore", "quantityChange",
    "quantityAfter", "reason", "note", "createdAt"
)
SELECT
    'initial-stock-' || variant."id",
    variant."id",
    NULL,
    0,
    variant."stockOnHand",
    variant."stockOnHand",
    'INITIAL_STOCK'::"InventoryAdjustmentReason",
    'Opening balance at inventory-ledger rollout; prior adjustment history is unavailable.',
    CURRENT_TIMESTAMP
FROM "ProductVariant" AS variant
WHERE variant."stockOnHand" > 0;

-- CreateIndex
CREATE INDEX "ProductInventoryAdjustment_variantId_createdAt_idx"
    ON "ProductInventoryAdjustment"("variantId", "createdAt");
CREATE INDEX "ProductInventoryAdjustment_actorId_createdAt_idx"
    ON "ProductInventoryAdjustment"("actorId", "createdAt");
CREATE INDEX "Product_moderationStatus_status_publishedAt_idx"
    ON "Product"("moderationStatus", "status", "publishedAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_moderatedById_fkey"
    FOREIGN KEY ("moderatedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductInventoryAdjustment" ADD CONSTRAINT "ProductInventoryAdjustment_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductInventoryAdjustment" ADD CONSTRAINT "ProductInventoryAdjustment_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve invariants even if a future writer bypasses application validation.
ALTER TABLE "Product" ADD CONSTRAINT "Product_disabled_requires_moderation_note"
    CHECK (
        "moderationStatus" <> 'DISABLED'::"ProductModerationStatus"
        OR (
            NULLIF(BTRIM("moderationNote"), '') IS NOT NULL
            AND "moderatedAt" IS NOT NULL
        )
    );
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_lowStockThreshold_nonnegative"
    CHECK ("lowStockThreshold" >= 0);
ALTER TABLE "ProductInventoryAdjustment" ADD CONSTRAINT "ProductInventoryAdjustment_quantities_consistent"
    CHECK (
        "quantityBefore" >= 0
        AND "quantityChange" <> 0
        AND "quantityAfter" >= 0
        AND "quantityAfter" = "quantityBefore" + "quantityChange"
    );

COMMIT;
