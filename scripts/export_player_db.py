"""팀 DB / 선수 DB 구글시트 동기화 (hyeoks-sports-engine crawl_and_update.py에서 이관).

FotMob에서 리그별 "지난 시즌 최종 성적"을 스크래핑해 두 시트를 채운다.
- 팀 DB   : 팀별 시즌 성적 + 시트 수식(Elo/공격/수비/방어 지수)
- 선수 DB : 지난 시즌 선수 리더보드(득점/도움/xG/xA/평점 등)를 카테고리별로 병합

2026-08-22 이관 메모
- 엔진 레포의 crawl_and_update.py는 이 두 시트 외에 경기 단위 크롤링("전체"/리그별/팀통계/선수통계)도
  했는데, 그 부분은 이 앱의 refreshHistory 크론(src/cron/refreshHistory.ts)과 중복이라 옮기지 않았다.
  팀/선수 DB만 이 앱에 없는 고유 기능이라 그대로 가져온다.
- 대상 리그에 MLS(리그ID 130)를 추가했다. 엔진 시절엔 없었으나 45회차가 MLS 회차였고 앱에도
  편입돼 있어, 선수 데이터가 없으면 오히려 비대칭이 된다. 나머지 리그 목록은 엔진과 동일.
- 선수 통계는 D1이 아니라 구글시트에만 적재한다(앱에 선수 스키마가 없고, 이 데이터의 용도가
  스카우팅/열람이라 시트가 적합). 앱 예측 모델은 이 데이터를 쓰지 않는다.
"""
import time

import requests

from sheets_common import FOTMOB_HEADERS, init_google_sheet, write_sheet

# 리그ID는 FotMob 표준. 앱이 쓰는 목록은 src/lib/fotmob.ts LEAGUE_IDS가 기준이며, 여기는
# 스카우팅 목적이라 앱이 다루지 않는 라리가/분데스리가까지 포함한 상위집합이다.
TARGET_LEAGUES = {
    "9080": "K리그1",
    "9116": "K리그2",
    "47": "EPL",
    "87": "라리가",
    "54": "분데스리가",
    "55": "세리에A",
    "223": "J1리그",
    "130": "MLS",
}

PLAYER_STAT_CATEGORIES = [
    "goals", "goal_assist", "expected_goals", "expected_assists", "rating",
    "mins_played", "total_scoring_att", "ontarget_scoring_att", "accurate_pass",
    "total_att_assist", "total_tackle", "interception", "clean_sheet", "saves",
]

TEAM_DB_HEADERS = [
    "키", "리그", "팀", "국가", "기준 시즌", "경기수", "승", "무", "패", "득점", "실점", "클린시트",
    "득점/경기", "실점/경기", "CS율", "수동 Elo", "전술", "최근 5경기 승점", "주전 가용률",
    "FotMob 출처 URL", "사용 Elo", "공격 지수", "수비 지수", "방어 안정성",
]
PLAYER_DB_HEADERS = [
    "선수 ID", "리그", "팀", "선수명", "포지션", "시즌", "출전", "선발", "출전시간", "득점", "도움",
    "xG", "xA", "슈팅", "유효슈팅", "패스 성공률", "키패스", "수비 행동", "평점", "현재 상태", "FotMob URL",
]


def _fetch_next_data(url):
    r = requests.get(url, headers=FOTMOB_HEADERS, timeout=15)
    if r.status_code != 200:
        return None
    start = '<script id="__NEXT_DATA__" type="application/json">'
    i = r.text.find(start)
    if i == -1:
        return None
    j = r.text.find("</script>", i)
    import json as _json
    return _json.loads(r.text[i + len(start):j])


def _extract_table_rows(page_props):
    """단일 순위표(dict)와 K리그식 스플릿(composite) 순위표를 모두 처리한다."""
    table_root = page_props.get("table")
    if not isinstance(table_root, list) or not table_root:
        return []
    d0 = table_root[0].get("data", {})
    inner = d0.get("table")
    if isinstance(inner, dict) and inner.get("all"):
        return inner["all"]
    best = None
    for c in d0.get("tables") or []:
        rows = (c.get("table") or {}).get("all") or []
        if best is None or len(rows) > len(best):
            best = rows
    return best or []


def build_player_rows(stats, league_name, season, id_to_name):
    """지난 시즌 선수 리더보드(득점/도움/xG/평점 등)를 병합해 선수 DB 행을 만든다."""
    urls = {}
    for p in stats.get("players", []):
        name = p.get("participant", {}).get("stat", {}).get("name")
        if name in PLAYER_STAT_CATEGORIES and p.get("fetchAllUrl"):
            urls[name] = p["fetchAllUrl"]

    by_player = {}
    for cat, url in urls.items():
        try:
            r = requests.get(url, headers=FOTMOB_HEADERS, timeout=15)
            entries = r.json().get("TopLists", [{}])[0].get("StatList", [])
        except Exception:
            continue
        for e in entries:
            # FotMob 응답의 오타 키("ParticiantId") - 원본 그대로 유지해야 파싱된다
            pid = e.get("ParticiantId")
            if not pid:
                continue
            p = by_player.setdefault(pid, {
                "id": pid, "name": e.get("ParticipantName"), "teamId": e.get("TeamId"),
                "team": e.get("TeamName"), "matches": e.get("MatchesPlayed"),
                "minutes": e.get("MinutesPlayed"),
            })
            p[cat] = e.get("StatValue")
        time.sleep(0.15)

    rows = []
    for pid, p in by_player.items():
        team_name = id_to_name.get(p.get("teamId")) or p.get("team") or ""
        tackles = p.get("total_tackle") or 0
        interceptions = p.get("interception") or 0
        rows.append([
            pid, league_name, team_name, p.get("name"), "", season,
            p.get("matches") or "", "", p.get("minutes") or "",
            p.get("goals") or "", p.get("goal_assist") or "",
            p.get("expected_goals") or "", p.get("expected_assists") or "",
            p.get("total_scoring_att") or "", p.get("ontarget_scoring_att") or "",
            p.get("accurate_pass") or "", p.get("total_att_assist") or "",
            tackles + interceptions if (tackles or interceptions) else "",
            p.get("rating") or "", "정상", f"https://www.fotmob.com/players/{pid}",
        ])
    return rows


def fetch_last_season_baseline(league_id, league_name):
    """지난 시즌 최종 순위표를 스크래핑해 팀별 성적과 선수 리더보드를 만든다."""
    base_url = f"https://www.fotmob.com/ko/leagues/{league_id}/overview/"
    try:
        data0 = _fetch_next_data(base_url)
        if not data0:
            return {}, []
        seasons = data0["props"]["pageProps"].get("allAvailableSeasons") or []
        if len(seasons) < 2:
            return {}, []
        last_season = seasons[1]

        data1 = _fetch_next_data(f"{base_url}?season={last_season}")
        if not data1:
            return {}, []
        pp1 = data1["props"]["pageProps"]
        rows = _extract_table_rows(pp1)

        stats = pp1.get("stats", {})
        cs_by_id = {}
        for t in stats.get("teams", []):
            if t.get("participant", {}).get("stat", {}).get("name") == "clean_sheet_team":
                try:
                    rcs = requests.get(t["fetchAllUrl"], headers=FOTMOB_HEADERS, timeout=15)
                    for e in rcs.json().get("TopLists", [{}])[0].get("StatList", []):
                        cs_by_id[e["TeamId"]] = e.get("StatValue") or 0
                except Exception:
                    pass
                break

        baseline = {}
        for row in rows:
            if not isinstance(row, dict) or not row.get("name"):
                continue
            played = row.get("played") or 0
            wins = row.get("wins", row.get("won", 0)) or 0
            draws = row.get("draws", row.get("draw", 0)) or 0
            losses = row.get("losses", row.get("lost", 0)) or 0
            scores = str(row.get("scoresStr") or "0-0").split("-")
            gf = int(scores[0]) if len(scores) == 2 and scores[0].strip().lstrip("-").isdigit() else 0
            ga = int(scores[1]) if len(scores) == 2 and scores[1].strip().lstrip("-").isdigit() else 0
            cs_raw = cs_by_id.get(row.get("id"), 0) or 0
            cs = min(cs_raw, played) if played else cs_raw
            page_url = row.get("pageUrl") or ""
            baseline[row["name"]] = {
                "id": row.get("id"), "played": played, "wins": wins, "draws": draws,
                "losses": losses, "gf": gf, "ga": ga, "cs": cs, "season": last_season,
                "url": f"https://www.fotmob.com{page_url}" if page_url else base_url,
            }

        id_to_name = {b["id"]: name for name, b in baseline.items() if b.get("id")}
        return baseline, build_player_rows(stats, league_name, last_season, id_to_name)
    except Exception as e:
        print(f"  ⚠️ [{league_name}] 지난 시즌 베이스라인 수집 실패: {e}")
        return {}, []


def build_team_rows(all_baselines):
    rows = []
    for league, baseline in all_baselines.items():
        for team, b in sorted(baseline.items()):
            rows.append([
                f"{league}|{team}", league, team, "", b["season"],
                b["played"], b["wins"], b["draws"], b["losses"], b["gf"], b["ga"], b["cs"],
                "", "", "", "", "", "", "", b["url"], "", "", "", "",
            ])
    return rows


def write_team_db(sh, rows):
    """팀 DB - 파생 지표는 값이 아니라 시트 수식으로 남긴다(시트에서 수동 보정이 가능하도록)."""
    ws = write_sheet(sh, "팀 DB", TEAM_DB_HEADERS, rows, cols=24, value_input_option="USER_ENTERED")
    if not rows:
        return
    n = len(rows) + 1  # 데이터는 2행부터 n행까지
    mno_rows, uvwx_rows = [], []
    for i in range(2, n + 1):
        mno_rows.append([f'=IF(F{i}=0,"",J{i}/F{i})', f'=IF(F{i}=0,"",K{i}/F{i})', f'=IF(F{i}=0,"",L{i}/F{i})'])
        uvwx_rows.append([
            f'=IF(P{i}<>"",P{i},IF(F{i}=0,"",1500+(G{i}-I{i})*16+(J{i}-K{i})*4))',
            f'=IF(M{i}="","",M{i}*100)', f'=IF(N{i}="","",N{i}*100)', f'=O{i}',
        ])
    ws.update(f"M2:O{n}", mno_rows, value_input_option="USER_ENTERED")
    ws.update(f"U2:X{n}", uvwx_rows, value_input_option="USER_ENTERED")


def main():
    all_baselines, all_player_rows = {}, []
    for league_id, league_name in TARGET_LEAGUES.items():
        baseline, player_rows = fetch_last_season_baseline(league_id, league_name)
        if baseline:
            all_baselines[league_name] = baseline
            all_player_rows.extend(player_rows)
            print(f"  -> {league_name}: 팀 {len(baseline)}개 / 선수 {len(player_rows)}명")
        time.sleep(0.5)

    if not all_baselines:
        print("❌ 수집된 데이터가 없어 시트를 건드리지 않습니다(기존 내용 보존).")
        raise SystemExit(1)

    sh = init_google_sheet()
    team_rows = build_team_rows(all_baselines)
    write_team_db(sh, team_rows)
    print(f"팀 DB: {len(team_rows)}행 기록 완료")
    write_sheet(sh, "선수 DB", PLAYER_DB_HEADERS, all_player_rows, cols=21, value_input_option="USER_ENTERED")
    print(f"선수 DB: {len(all_player_rows)}행 기록 완료")


if __name__ == "__main__":
    main()
