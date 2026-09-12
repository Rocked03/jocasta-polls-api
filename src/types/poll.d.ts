export interface Poll {
  id: number;
  question: string;
  published: boolean;
  active: boolean;
  guild_id: bigint;
  choices: string[];
  votes: number[] | null;
  total_votes: number;
  /** Compatibility alias for start_time (website); removable once the website reads start_time. */
  time: Date | null;
  start_time: Date | null;
  end_time: Date | null;
  // duration: string | null;
  num: number | null;
  message_id: bigint | null;
  crosspost_message_ids: bigint[];
  tag: number;
  image: string | null;
  description: string | null;
  thread_question: string | null;
  show_question: boolean;
  show_options: boolean;
  show_voting: boolean;
  fallback: boolean;
}
