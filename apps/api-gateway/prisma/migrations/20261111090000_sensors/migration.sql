-- CreateEnum
CREATE TYPE "SensorKind" AS ENUM ('PIR', 'PRESSURE_PLATE', 'WATCH');

-- CreateEnum
CREATE TYPE "SensorStatus" AS ENUM ('ONLINE', 'OFFLINE', 'LOW_BATTERY');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "sensorId" TEXT,
ALTER COLUMN "alertId" DROP NOT NULL,
ALTER COLUMN "reason" DROP NOT NULL,
ALTER COLUMN "escalationCause" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sensors" (
    "id" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "kind" "SensorKind" NOT NULL,
    "model" TEXT,
    "room" TEXT,
    "location" TEXT,
    "expectedIntervalMinutes" INTEGER NOT NULL,
    "status" "SensorStatus" NOT NULL DEFAULT 'ONLINE',
    "statusChangedAt" TIMESTAMP(3),

    CONSTRAINT "sensors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sensors_seniorId_idx" ON "sensors"("seniorId");

-- AddForeignKey
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "seniors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

