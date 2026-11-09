-- CreateEnum
CREATE TYPE "EscalationCause" AS ENUM ('NO_RESPONSE', 'SENIOR_CONFIRMED', 'IMMEDIATE', 'NO_RECOVERY');

-- CreateEnum
CREATE TYPE "CancellationCause" AS ENUM ('SENIOR_CANCELED', 'ACTIVITY_RESUMED');

-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('PIR_MOTION', 'PRESSURE_PLATE', 'HEART_RATE', 'FALL_IMPACT', 'HELP_BUTTON', 'CANCEL_ALERT', 'SENSOR_HEARTBEAT');

-- AlterEnum
ALTER TYPE "AlertStatus" ADD VALUE 'PENDING';

-- AlterEnum
BEGIN;
CREATE TYPE "Severity_new" AS ENUM ('SYSTEM', 'PRE_ALERT', 'WARNING', 'CRITICAL');
ALTER TABLE "tolerance_thresholds" ALTER COLUMN "severity" TYPE "Severity_new" USING ("severity"::text::"Severity_new");
ALTER TABLE "alerts" ALTER COLUMN "severity" TYPE "Severity_new" USING ("severity"::text::"Severity_new");
ALTER TYPE "Severity" RENAME TO "Severity_old";
ALTER TYPE "Severity_new" RENAME TO "Severity";
DROP TYPE "Severity_old";
COMMIT;

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "acknowledgedById" TEXT,
ADD COLUMN     "cancellationCause" "CancellationCause",
ADD COLUMN     "escalationCause" "EscalationCause",
ADD COLUMN     "triggeringEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "createdAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "persons" DROP COLUMN "passwordHash";

-- CreateTable
CREATE TABLE "signals" (
    "eventId" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "type" "SignalType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "signals_seniorId_type_timestamp_idx" ON "signals"("seniorId", "type", "timestamp");

-- CreateIndex
CREATE INDEX "alerts_seniorId_createdAt_idx" ON "alerts"("seniorId", "createdAt");

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "seniors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

