// 국가대표 Elo를 D1에 갱신하고, 킥오프 전 국가대표 경기에 격차를 고정해 넣는다.
import { NATIONAL_RESULTS_URL, parseNationalResultsCsv, computeNationalElo } from "./nationalElo";
import { nationalTeamEn } from "./nationalNames";
import type { Env } from "../types";

// 원본 CSV(약 3.7MB)는 하루에 몇 번 갱신되는 정도라 3시간 크론마다 받을 이유가 없다.
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
// 레이팅이 자리 잡지 않은 팀(경기 수 적음)은 쓰지 않는다 - 백테스트와 같은 조건.
export const NATIONAL_MIN_MATCHES = 20;
const CHUNK = 100;

export async function refreshNationalElo(env: Env, force = false): Promise<{ refreshed: boolean; teams?: number }> {
  if (!force) {
    const row = await env.DB.prepare("SELECT MAX(updated_at) AS u FROM national_elo").first<{ u: string | null }>();
    if (row?.u && Date.now() - Date.parse(row.u) < REFRESH_INTERVAL_MS) return { refreshed: false };
  }
  const res = await fetch(NATIONAL_RESULTS_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`national results fetch 실패 ${res.status}`);
  const ratings = computeNationalElo(parseNationalResultsCsv(await res.text()));

  const now = new Date().toISOString();
  const entries = [...ratings.entries()];
  // D1 요청 한도(호출당 1,000회) 때문에 반드시 batch로 묶는다(refreshHistory 주석 참고).
  for (let i = 0; i < entries.length; i += CHUNK) {
    await env.DB.batch(
      entries.slice(i, i + CHUNK).map(([team, s]) =>
        env.DB.prepare(
          "INSERT OR REPLACE INTO national_elo (team_en, elo, n_matches, last_match_date, updated_at) VALUES (?, ?, ?, ?, ?)",
        ).bind(team, s.elo, s.n, s.lastDate || null, now),
      ),
    );
  }
  return { refreshed: true, teams: entries.length };
}

/**
 * 진행중 회차의 '킥오프 전' 배당전용 경기에 국가대표 Elo 격차를 넣는다.
 * 킥오프가 지난 경기는 건드리지 않아 마지막 값(경기 전 정보)으로 고정된다.
 */
export async function snapshotNationalEloDiffs(env: Env): Promise<number> {
  const { results: rows } = await env.DB.prepare(
    `SELECT rm.id, rm.home_kr, rm.away_kr, rm.kickoff_at
       FROM round_matches rm
       JOIN rounds r ON r.id = rm.round_id
       JOIN round_predictions rp ON rp.round_match_id = rm.id
      WHERE r.status = 'upcoming' AND rp.market_only = 1`,
  ).all<{ id: number; home_kr: string; away_kr: string; kickoff_at: string | null }>();
  if (!rows || rows.length === 0) return 0;

  const now = Date.now();
  const targets = rows
    .filter((r) => r.kickoff_at == null || Date.parse(r.kickoff_at) > now)
    .map((r) => ({ id: r.id, home: nationalTeamEn(r.home_kr), away: nationalTeamEn(r.away_kr) }))
    .filter((r): r is { id: number; home: string; away: string } => r.home != null && r.away != null);
  if (targets.length === 0) return 0;

  const names = [...new Set(targets.flatMap((t) => [t.home, t.away]))];
  const { results: eloRows } = await env.DB.prepare(
    `SELECT team_en, elo, n_matches FROM national_elo WHERE team_en IN (${names.map(() => "?").join(",")})`,
  )
    .bind(...names)
    .all<{ team_en: string; elo: number; n_matches: number }>();
  const elo = new Map((eloRows ?? []).filter((r) => r.n_matches >= NATIONAL_MIN_MATCHES).map((r) => [r.team_en, r.elo]));

  const stmts = [];
  for (const t of targets) {
    const h = elo.get(t.home);
    const a = elo.get(t.away);
    if (h == null || a == null) continue;
    stmts.push(env.DB.prepare("UPDATE round_predictions SET nat_elo_diff = ? WHERE round_match_id = ?").bind(h - a, t.id));
  }
  for (let i = 0; i < stmts.length; i += CHUNK) await env.DB.batch(stmts.slice(i, i + CHUNK));
  return stmts.length;
}
