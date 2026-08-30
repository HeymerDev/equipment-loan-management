-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMINISTRADOR', 'DOCENTE');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('DISPONIBLE', 'PRESTADO');

-- CreateEnum
CREATE TYPE "LoanRequestStatus" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('EQUIPMENT_CREATED', 'EQUIPMENT_UPDATED', 'EQUIPMENT_DELETED', 'REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'REQUEST_CANCELLED', 'LOAN_STARTED', 'LOAN_RETURNED');

-- CreateTable
CREATE TABLE "User" (
    "id"           TEXT NOT NULL,
    "email"        TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName"     TEXT NOT NULL,
    "role"         "Role" NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id"        TEXT NOT NULL,
    "token"     TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id"   TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id"           TEXT NOT NULL,
    "name"         VARCHAR(100) NOT NULL,
    "serialNumber" VARCHAR(50) NOT NULL,
    "description"  VARCHAR(500) NOT NULL,
    "status"       "EquipmentStatus" NOT NULL DEFAULT 'DISPONIBLE',
    "categoryId"   TEXT NOT NULL,
    "deletedAt"    TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRequest" (
    "id"              TEXT NOT NULL,
    "status"          "LoanRequestStatus" NOT NULL DEFAULT 'PENDIENTE',
    "purpose"         VARCHAR(500) NOT NULL,
    "startDate"       TIMESTAMP(3) NOT NULL,
    "returnDate"      TIMESTAMP(3) NOT NULL,
    "rejectionReason" VARCHAR(500),
    "cancelledAt"     TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    "teacherId"       TEXT NOT NULL,
    "equipmentId"     TEXT NOT NULL,

    CONSTRAINT "LoanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id"               TEXT NOT NULL,
    "status"           "LoanStatus" NOT NULL DEFAULT 'ACTIVO',
    "startDate"        TIMESTAMP(3) NOT NULL,
    "agreedReturnDate" TIMESTAMP(3) NOT NULL,
    "actualReturnDate" TIMESTAMP(3),
    "returnedLate"     BOOLEAN,
    "daysLate"         INTEGER,
    "returnNotes"      VARCHAR(500),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    "requestId"        TEXT NOT NULL,
    "equipmentId"      TEXT NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryEvent" (
    "id"            TEXT NOT NULL,
    "eventType"     "EventType" NOT NULL,
    "entityId"      TEXT NOT NULL,
    "entityTable"   TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "occurredAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedFields" JSONB,
    "equipmentId"   TEXT,
    "requestId"     TEXT,
    "loanId"        TEXT,

    CONSTRAINT "HistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_serialNumber_key" ON "Equipment"("serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_requestId_key" ON "Loan"("requestId");

-- CreateIndex
CREATE INDEX "HistoryEvent_eventType_idx" ON "HistoryEvent"("eventType");

-- CreateIndex
CREATE INDEX "HistoryEvent_occurredAt_idx" ON "HistoryEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "HistoryEvent_equipmentId_idx" ON "HistoryEvent"("equipmentId");

-- CreateIndex
CREATE INDEX "HistoryEvent_userId_idx" ON "HistoryEvent"("userId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_teacherId_fkey"
    FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "LoanRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryEvent" ADD CONSTRAINT "HistoryEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryEvent" ADD CONSTRAINT "HistoryEvent_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryEvent" ADD CONSTRAINT "HistoryEvent_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "LoanRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryEvent" ADD CONSTRAINT "HistoryEvent_loanId_fkey"
    FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
