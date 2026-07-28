# history_kleague.parquet를 D1 시딩용 SQL(seed.sql)로 변환하는 1회성 스크립트
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC_DATA = Path(r"C:\Users\Hyeok-gi\Documents\스포츠 토토 예측시스템\data")
OUT = ROOT / "seed" / "seed.sql"

K_FACTOR = 32
HOME_ADV = 60.0
SEASON_REGRESSION = 0.25

NAME_MAP = {
    "강원FC": "Gangwon FC", "부천FC": "Bucheon FC 1995",
    "전북현대": "Jeonbuk Hyundai Motors FC", "FC서울": "FC Seoul",
    "포항스틸": "Pohang Steelers", "김천상무": "Gimcheon Sangmu",
    "충남아산": "Chungnam Asan FC", "성남FC": "Seongnam FC",
    "천안시티": "Cheonan City", "용인FC": "Yongin FC",
    "충북청주": "Cheongju FC", "수원삼성": "Suwon Samsung Bluewings",
    "화성FC": "Hwaseong FC", "대구FC": "Daegu FC",
    "울산HDFC": "Ulsan HD FC", "FC안양": "FC Anyang",
    "대전하나": "Daejeon Hana Citizen", "광주FC": "Gwangju FC",
    "제주SKFC": "Jeju SK", "인천유나": "Incheon United",
    "부산아이": "Busan I'Park", "서울이랜": "Seoul E-Land FC",
    "김포FC": "Gimpo FC", "경남FC": "Gyeongnam FC",
    "전남드래": "Jeonnam Dragons", "파주프런": "Paju Frontier",
    "안산그리": "Ansan Greeners", "김해FC": "Gimhae FC 2008",
}


def sql_escape(s: str) -> str:
    return s.replace("'", "''")


def main():
    df = pd.read_parquet(SRC_DATA / "history_kleague.parquet").sort_values(["league", "date"])

    lines = []

    for kr, en in NAME_MAP.items():
        league = "K리그1" if kr in (
            "강원FC", "부천FC", "전북현대", "FC서울", "포항스틸", "김천상무",
            "울산HDFC", "FC안양", "대전하나", "광주FC", "제주SKFC", "인천유나",
        ) else "K리그2"
        lines.append(
            f"INSERT OR REPLACE INTO team_name_map (name_kr, name_en, league) VALUES "
            f"('{sql_escape(kr)}', '{sql_escape(en)}', '{league}');"
        )

    for _, row in df.iterrows():
        lines.append(
            "INSERT OR IGNORE INTO matches (league, date, home, away, hg, ag) VALUES "
            f"('{sql_escape(row['league'])}', '{row['date'].date().isoformat()}', "
            f"'{sql_escape(row['home'])}', '{sql_escape(row['away'])}', {int(row['hg'])}, {int(row['ag'])});"
        )

    # Elo 재계산 (predict_round42_v2.py와 동일 로직) 후 최신 레이팅을 team_elo 시드값으로 저장
    elo, last_season = {}, {}
    for _, row in df.iterrows():
        league, home, away, date = row["league"], row["home"], row["away"], row["date"]
        s = date.year
        for t in (home, away):
            key = (league, t)
            if key not in elo:
                elo[key] = 1500.0
                last_season[key] = s
            elif last_season[key] != s:
                elo[key] = 1500.0 + (elo[key] - 1500.0) * (1 - SEASON_REGRESSION)
                last_season[key] = s
        he, ae = elo[(league, home)], elo[(league, away)]
        hg, ag = row["hg"], row["ag"]
        S_h = 1.0 if hg > ag else (0.5 if hg == ag else 0.0)
        E_h = 1.0 / (1.0 + 10.0 ** ((ae - (he + HOME_ADV)) / 400.0))
        elo[(league, home)] += K_FACTOR * (S_h - E_h)
        elo[(league, away)] += K_FACTOR * ((1.0 - S_h) - (1.0 - E_h))

    last_date = df.groupby(["league", "home"])["date"].max().to_dict()
    for (league, team), rating in elo.items():
        ld = last_date.get((league, team))
        ld_str = ld.date().isoformat() if pd.notna(ld) else None
        ld_sql = f"'{ld_str}'" if ld_str else "NULL"
        lines.append(
            "INSERT OR REPLACE INTO team_elo (league, team_en, elo, last_season, last_match_date) VALUES "
            f"('{sql_escape(league)}', '{sql_escape(team)}', {rating:.4f}, {last_season[(league, team)]}, {ld_sql});"
        )

    for league in ["K리그1", "K리그2"]:
        d = df[df["league"] == league]
        rate = float((d["hg"] == d["ag"]).mean())
        lines.append(
            "INSERT OR REPLACE INTO league_draw_rates (league, draw_rate, sample_size, updated_at) VALUES "
            f"('{league}', {rate:.6f}, {len(d)}, '{pd.Timestamp.now().isoformat()}');"
        )

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"{len(lines)}개 SQL 문 -> {OUT}")


if __name__ == "__main__":
    main()
