-- AlterTable
ALTER TABLE "document_versions" ADD COLUMN     "up_to_seq" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "document_version_contributors" (
    "version_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "document_version_contributors_pkey" PRIMARY KEY ("version_id","user_id")
);

-- AddForeignKey
ALTER TABLE "document_version_contributors" ADD CONSTRAINT "document_version_contributors_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_version_contributors" ADD CONSTRAINT "document_version_contributors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
