ALTER TABLE "pollsvotes" RENAME TO "votes";

ALTER TABLE "pollstags" RENAME TO "tags";

ALTER TABLE "pollsinfo" RENAME TO "guild_settings";

ALTER TABLE "votes" RENAME CONSTRAINT "pollsvotesnew_pkey" TO "votes_pkey";

ALTER TABLE "tags" RENAME CONSTRAINT "pollstags_pkey" TO "tags_pkey";

ALTER TABLE "guild_settings" RENAME CONSTRAINT "pollsinfo_pkey" TO "guild_settings_pkey";
