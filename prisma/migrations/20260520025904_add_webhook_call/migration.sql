-- CreateTable
CREATE TABLE "WebhookCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "called" BOOLEAN NOT NULL DEFAULT false,
    "calledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookCall_shop_key" ON "WebhookCall"("shop");
