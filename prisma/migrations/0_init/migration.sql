CREATE TABLE "polls" (
    "id" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "guild_id" BIGINT NOT NULL,
    "choices" TEXT[] NOT NULL,
    "start_time" TIMESTAMPTZ,
    "end_time" TIMESTAMPTZ,
    "num" INTEGER,
    "message_id" BIGINT,
    "crosspost_message_ids" BIGINT[],
    "tag" INTEGER,
    "image" TEXT,
    "description" TEXT,
    "thread_question" TEXT,
    "show_question" BOOLEAN NOT NULL DEFAULT true,
    "show_options" BOOLEAN NOT NULL DEFAULT true,
    "show_voting" BOOLEAN NOT NULL DEFAULT true,
    "fallback" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pollsvotes" (
    "id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "poll_id" INTEGER NOT NULL,
    "choice" INTEGER NOT NULL,

    CONSTRAINT "pollsvotesnew_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pollstags" (
    "tag" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "guild_id" BIGINT NOT NULL,
    "channel_id" BIGINT NOT NULL,
    "crosspost_channels" BIGINT[],
    "crosspost_servers" BIGINT[],
    "current_num" INTEGER,
    "colour" INTEGER,
    "end_message" TEXT,
    "end_message_latest_ids" BIGINT[],
    "end_message_replace" BOOLEAN NOT NULL DEFAULT false,
    "end_message_role_ids" BIGINT[],
    "end_message_ping" BOOLEAN NOT NULL DEFAULT false,
    "end_message_self_assign" BOOLEAN NOT NULL DEFAULT false,
    "persistent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pollstags_pkey" PRIMARY KEY ("tag")
);

CREATE TABLE "pollsinfo" (
    "guild_id" BIGINT NOT NULL,
    "default_channel_id" BIGINT NOT NULL,
    "manage_channel_id" BIGINT[],
    "manager_role_id" BIGINT[] NOT NULL,
    "default_colour" INTEGER,
    "fallback_channel_id" BIGINT,

    CONSTRAINT "pollsinfo_pkey" PRIMARY KEY ("guild_id")
);

ALTER TABLE "polls" ADD CONSTRAINT "polls_start_before_end" CHECK ("start_time" < "end_time");

ALTER TABLE "polls" ADD CONSTRAINT "polls_end_requires_start" CHECK ("end_time" IS NULL OR "start_time" IS NOT NULL);
