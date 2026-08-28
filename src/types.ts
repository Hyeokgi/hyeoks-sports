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

// 리그 정의는 nameMap.ts 한 곳에만 둔다(예전엔 두 파일에 같은 유니온이 복사돼 있었다).
export type { ModelLeague, League } from "./lib/nameMap";
export { MODEL_LEAGUES, isModelLeague } from "./lib/nameMap";
import type { League } from "./lib/nameMap";

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
  // 등록 시점에 배당만으로 예측했는지(1) 아닌지(0). 매번 다시 판단하지 않는 이유는
  // migrations/0008_market_only.sql 주석 참고. 0008 이전에 등록된 회차는 NULL일 수 있다.
  market_only: number | null;
  computed_at: string;
}
