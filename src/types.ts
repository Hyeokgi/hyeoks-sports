// Cloudflare Worker 바인딩 및 공용 타입
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ASSETS: Fetcher;
  ENVIRONMENT: string;
  GEMINI_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ADMIN_TOKEN?: string;
}

export type League = "K리그1" | "K리그2" | "J1리그" | "MLS" | "EPL" | "세리에A" | "라리가" | "분데스리가";

export interface RoundRow {
  id: number;
  round_no: number | null;
  round_no_confirmed: number;
  status: "upcoming" | "closed" | "settled";
  created_at: string;
  notified_at: string | null;
}

export interface RoundMatchRow {
  id: number;
  round_id: number;
  seq: number;
  league: League;
  home_kr: string;
  away_kr: string;
  kickoff_at: string | null;
}

export interface RoundPredictionRow {
  round_match_id: number;
  elo_diff: number;
  form_diff: number;
  h2h_diff: number;
  n_h2h: number;
  league_draw_rate: number;
  xg_diff: number | null;
  corners_diff: number | null;
  computed_at: string;
}
