-- AlterEnum
ALTER TYPE "EscalationCause" ADD VALUE 'NO_HEART_SIGNAL';


-- AlterTable
ALTER TABLE "seniors" ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'Europe/Paris';

-- AlterTable
ALTER TABLE "tolerance_thresholds" DROP COLUMN "severity",
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "startTime" TEXT;

