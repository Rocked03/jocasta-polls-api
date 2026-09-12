DO $$
DECLARE
  problems text[] := '{}';
  expected text;
  actual text;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations') <> 4 THEN
    problems := array_append(problems, 'expected exactly 4 base tables in public (excluding _prisma_migrations)');
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_views WHERE schemaname = 'public') <> 0 THEN
    problems := array_append(problems, 'unexpected views in public schema');
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public') <> 0 THEN
    problems := array_append(problems, 'unexpected functions in public schema');
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON t.tgrelid = c.oid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) <> 0 THEN
    problems := array_append(problems, 'unexpected triggers in public schema');
  END IF;

  expected := 'id|integer|t|;question|text|t|;published|boolean|t|false;guild_id|bigint|t|;choices|text[]|t|;start_time|timestamp with time zone|f|;end_time|timestamp with time zone|f|;num|integer|f|;message_id|bigint|f|;crosspost_message_ids|bigint[]|f|;tag|integer|t|;image|text|f|;description|text|f|;thread_question|text|f|;show_question|boolean|t|true;show_options|boolean|t|true;show_voting|boolean|t|true;fallback|boolean|t|false';
  SELECT string_agg(a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END || '|' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''), ';' ORDER BY a.attnum)
  INTO actual
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.polls'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM expected THEN
    problems := array_append(problems, 'polls column signature mismatch: ' || coalesce(actual, '<table missing>'));
  END IF;

  expected := 'id|bigint|t|;user_id|bigint|t|;poll_id|integer|t|;choice|integer|t|';
  SELECT string_agg(a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END || '|' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''), ';' ORDER BY a.attnum)
  INTO actual
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.votes'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM expected THEN
    problems := array_append(problems, 'votes column signature mismatch: ' || coalesce(actual, '<table missing>'));
  END IF;

  expected := 'tag|integer|t|;name|text|t|;guild_id|bigint|t|;channel_id|bigint|t|;crosspost_channels|bigint[]|f|;crosspost_servers|bigint[]|f|;current_num|integer|f|;colour|integer|f|;end_message|text|f|;end_message_latest_ids|bigint[]|f|;end_message_replace|boolean|t|false;end_message_role_ids|bigint[]|f|;end_message_ping|boolean|t|false;end_message_self_assign|boolean|t|false;persistent|boolean|t|true';
  SELECT string_agg(a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END || '|' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''), ';' ORDER BY a.attnum)
  INTO actual
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.tags'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM expected THEN
    problems := array_append(problems, 'tags column signature mismatch: ' || coalesce(actual, '<table missing>'));
  END IF;

  expected := 'guild_id|bigint|t|;default_channel_id|bigint|t|;manage_channel_id|bigint[]|f|;manager_role_id|bigint[]|t|;default_colour|integer|f|;fallback_channel_id|bigint|f|';
  SELECT string_agg(a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END || '|' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''), ';' ORDER BY a.attnum)
  INTO actual
  FROM pg_catalog.pg_attribute a
  LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE a.attrelid = 'public.guild_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF actual IS DISTINCT FROM expected THEN
    problems := array_append(problems, 'guild_settings column signature mismatch: ' || coalesce(actual, '<table missing>'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.polls'::regclass AND contype = 'p' AND conname = 'polls_pkey') THEN
    problems := array_append(problems, 'polls_pkey missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.votes'::regclass AND contype = 'p' AND conname = 'votes_pkey') THEN
    problems := array_append(problems, 'votes_pkey missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.tags'::regclass AND contype = 'p' AND conname = 'tags_pkey') THEN
    problems := array_append(problems, 'tags_pkey missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.guild_settings'::regclass AND contype = 'p' AND conname = 'guild_settings_pkey') THEN
    problems := array_append(problems, 'guild_settings_pkey missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.polls'::regclass AND contype = 'c' AND conname = 'polls_start_before_end') THEN
    problems := array_append(problems, 'polls_start_before_end CHECK missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.polls'::regclass AND contype = 'c' AND conname = 'polls_end_requires_start') THEN
    problems := array_append(problems, 'polls_end_requires_start CHECK missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.polls'::regclass AND contype = 'c' AND conname = 'polls_published_requires_start') THEN
    problems := array_append(problems, 'polls_published_requires_start CHECK missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.votes'::regclass AND contype = 'f' AND conname = 'votes_poll_id_fkey' AND confdeltype = 'c') THEN
    problems := array_append(problems, 'votes_poll_id_fkey FK missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.polls'::regclass AND contype = 'f' AND conname = 'polls_tag_fkey' AND confdeltype = 'r') THEN
    problems := array_append(problems, 'polls_tag_fkey FK missing');
  END IF;

  IF cardinality(problems) > 0 THEN
    RAISE EXCEPTION 'baseline verification failed: %', array_to_string(problems, '; ');
  END IF;
END $$;

SELECT 'baseline verification passed';
