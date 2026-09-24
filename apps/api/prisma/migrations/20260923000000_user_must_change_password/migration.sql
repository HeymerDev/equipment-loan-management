-- Accounts created by an administrator start with a temporary password and
-- must set their own before using the system.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
