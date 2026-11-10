-- CreateEnum
CREATE TYPE "AbsenceEnd" AS ENUM ('RETURNED', 'ACTIVITY_AT_HOME', 'REPLACED');

-- CreateTable
CREATE TABLE "absences" (
    "id" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedReturnAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "AbsenceEnd",

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "absences_seniorId_startedAt_idx" ON "absences"("seniorId", "startedAt");

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_seniorId_fkey" FOREIGN KEY ("seniorId") REFERENCES "seniors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

