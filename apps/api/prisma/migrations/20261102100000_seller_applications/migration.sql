CREATE TYPE "SellerApplicationStatus" AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'NEEDS_INFORMATION',
    'APPROVED',
    'REJECTED'
);

CREATE TYPE "BusinessType" AS ENUM (
    'INDIVIDUAL',
    'PARTNERSHIP',
    'PRIVATE_LIMITED',
    'OTHER'
);

ALTER TABLE "Seller"
    ADD COLUMN "businessName" TEXT,
    ADD COLUMN "businessType" "BusinessType" NOT NULL DEFAULT 'INDIVIDUAL',
    ADD COLUMN "description" VARCHAR(2000) NOT NULL DEFAULT '',
    ADD COLUMN "contactEmail" VARCHAR(254),
    ADD COLUMN "contactPhone" VARCHAR(30),
    ADD COLUMN "logoUrl" VARCHAR(2048),
    ADD COLUMN "bannerUrl" VARCHAR(2048),
    ADD COLUMN "shippingPolicy" VARCHAR(2000),
    ADD COLUMN "returnPolicy" VARCHAR(2000);

CREATE TABLE "SellerApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" VARCHAR(120) NOT NULL,
    "storeName" VARCHAR(100) NOT NULL,
    "storeNameNormalized" VARCHAR(100) NOT NULL,
    "businessType" "BusinessType" NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "contactEmail" VARCHAR(254) NOT NULL,
    "contactPhone" VARCHAR(30) NOT NULL,
    "addressLine1" VARCHAR(160) NOT NULL,
    "addressLine2" VARCHAR(160),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "postalCode" VARCHAR(24) NOT NULL,
    "country" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "status" "SellerApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewMessage" VARCHAR(2000),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellerApplication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SellerHistory" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "sellerId" TEXT,
    "actorId" TEXT,
    "action" VARCHAR(50) NOT NULL,
    "fromStatus" "SellerApplicationStatus",
    "toStatus" "SellerApplicationStatus",
    "note" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SellerHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SellerApplication_userId_key" ON "SellerApplication"("userId");
CREATE UNIQUE INDEX "SellerApplication_storeNameNormalized_key" ON "SellerApplication"("storeNameNormalized");
CREATE UNIQUE INDEX "SellerApplication_slug_key" ON "SellerApplication"("slug");
CREATE INDEX "SellerApplication_status_submittedAt_idx" ON "SellerApplication"("status", "submittedAt");
CREATE INDEX "SellerApplication_createdAt_idx" ON "SellerApplication"("createdAt");
CREATE INDEX "SellerHistory_applicationId_createdAt_idx" ON "SellerHistory"("applicationId", "createdAt");
CREATE INDEX "SellerHistory_sellerId_createdAt_idx" ON "SellerHistory"("sellerId", "createdAt");
CREATE INDEX "SellerHistory_actorId_createdAt_idx" ON "SellerHistory"("actorId", "createdAt");

ALTER TABLE "SellerApplication"
    ADD CONSTRAINT "SellerApplication_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SellerHistory"
    ADD CONSTRAINT "SellerHistory_applicationId_fkey"
    FOREIGN KEY ("applicationId") REFERENCES "SellerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "SellerHistory_sellerId_fkey"
    FOREIGN KEY ("sellerId") REFERENCES "Seller"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "SellerHistory_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
