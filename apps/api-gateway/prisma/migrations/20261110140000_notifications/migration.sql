-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('INFO', 'NORMAL', 'URGENT');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "seniorId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "priority" "NotificationPriority" NOT NULL,
    "severity" "Severity" NOT NULL,
    "reason" "AlertReason" NOT NULL,
    "escalationCause" "EscalationCause" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipientId_createdAt_idx" ON "notifications"("recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_eventId_recipientId_key" ON "notifications"("eventId", "recipientId");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

