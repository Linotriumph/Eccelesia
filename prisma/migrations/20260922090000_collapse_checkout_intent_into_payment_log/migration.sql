-- Copy any CheckoutIntent rows that don't already have a PaymentLog (pending
-- checkouts, and intents marked failed/completed without a matching log) so no
-- in-flight payment state is lost when the table is dropped.
INSERT INTO "PaymentLog" ("id", "userId", "subscriptionId", "txRef", "flwTxId", "amount", "currency", "planSlug", "status", "source", "createdAt")
SELECT
  ci."id",
  ci."userId",
  NULL,
  ci."txRef",
  ci."flwTxId",
  ci."amount",
  ci."currency",
  ci."planSlug",
  CASE WHEN ci."status" = 'completed' THEN 'successful' ELSE ci."status" END,
  'checkout',
  ci."createdAt"
FROM "CheckoutIntent" ci
WHERE NOT EXISTS (
  SELECT 1 FROM "PaymentLog" pl
  WHERE pl."txRef" = ci."txRef"
);

-- DropTable
DROP TABLE "CheckoutIntent";