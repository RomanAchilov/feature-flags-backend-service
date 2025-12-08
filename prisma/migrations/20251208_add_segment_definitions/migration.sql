-- CreateTable
CREATE TABLE "FeatureSegmentDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeatureSegmentDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureSegmentDefinition_name_key" ON "FeatureSegmentDefinition"("name");
