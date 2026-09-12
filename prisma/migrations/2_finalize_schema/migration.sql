ALTER TABLE "polls" DROP COLUMN "active";

ALTER TABLE "polls" ALTER COLUMN "tag" SET NOT NULL;

ALTER TABLE "polls" ADD CONSTRAINT "polls_published_requires_start"
    CHECK ("published" = false OR "start_time" IS NOT NULL);

ALTER TABLE "votes" ADD CONSTRAINT "votes_poll_id_fkey"
    FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE;

ALTER TABLE "polls" ADD CONSTRAINT "polls_tag_fkey"
    FOREIGN KEY ("tag") REFERENCES "tags"("tag") ON DELETE RESTRICT;
