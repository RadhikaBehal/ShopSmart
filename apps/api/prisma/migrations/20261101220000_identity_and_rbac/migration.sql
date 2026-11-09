BEGIN;

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SELLER_STAFF';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MODERATOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPPORT_AGENT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

CREATE TYPE "AuthTokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "AuthActionToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" "AuthTokenPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthActionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthActionToken_tokenHash_key" ON "AuthActionToken"("tokenHash");
CREATE INDEX "AuthActionToken_userId_purpose_expiresAt_idx"
    ON "AuthActionToken"("userId", "purpose", "expiresAt");
ALTER TABLE "AuthActionToken"
    ADD CONSTRAINT "AuthActionToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
