BEGIN;

CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ProductImage" ("id", "productId", "url", "altText", "sortOrder", "isPrimary")
SELECT 'legacy-image-' || p."id", p."id", COALESCE(p."imageUrl", ''), p."imageAlt", 0, true
FROM "Product" p
WHERE p."imageUrl" IS NOT NULL OR p."imageAlt" IS NOT NULL;

CREATE TABLE "ProductSpecification" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProductSpecification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductImage_productId_isPrimary_idx"
    ON "ProductImage"("productId", "isPrimary");
CREATE UNIQUE INDEX "ProductImage_productId_sortOrder_key"
    ON "ProductImage"("productId", "sortOrder");
CREATE UNIQUE INDEX "ProductImage_one_primary_per_product_key"
    ON "ProductImage"("productId")
    WHERE "isPrimary" = true;
CREATE INDEX "ProductSpecification_productId_sortOrder_idx"
    ON "ProductSpecification"("productId", "sortOrder");
CREATE UNIQUE INDEX "ProductSpecification_productId_name_key"
    ON "ProductSpecification"("productId", "name");

ALTER TABLE "ProductImage"
    ADD CONSTRAINT "ProductImage_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSpecification"
    ADD CONSTRAINT "ProductSpecification_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Product"
    DROP COLUMN "imageAlt",
    DROP COLUMN "imageUrl";

COMMIT;
