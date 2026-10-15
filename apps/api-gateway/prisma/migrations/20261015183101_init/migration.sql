-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SENIOR', 'FAMILY', 'MEDICAL');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AlertReason" AS ENUM ('FALL_DETECTED', 'PROLONGED_INACTIVITY', 'HELP_REQUESTED');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('PRE_CONFIRMING', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seniors" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seniors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_relationships" (
    "id" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "caregiverId" TEXT NOT NULL,
    "relationType" "Role" NOT NULL,
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "consentedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tolerance_thresholds" (
    "id" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "durationInMinutes" INTEGER NOT NULL,
    "severity" "Severity" NOT NULL,

    CONSTRAINT "tolerance_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "reason" "AlertReason" NOT NULL,
    "status" "AlertStatus" NOT NULL,
    "severity" "Severity",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "persons_email_key" ON "persons"("email");

-- CreateIndex
CREATE UNIQUE INDEX "seniors_personId_key" ON "seniors"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "care_relationships_seniorId_caregiverId_key" ON "care_relationships"("seniorId", "caregiverId");

-- AddForeignKey
ALTER TABLE "seniors" ADD CONSTRAINT "seniors_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "seniors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_relationships" ADD CONSTRAINT "care_relationships_caregiverId_fkey" FOREIGN KEY ("caregiverId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tolerance_thresholds" ADD CONSTRAINT "tolerance_thresholds_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "seniors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "seniors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "seniors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
