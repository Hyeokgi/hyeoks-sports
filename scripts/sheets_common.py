"""구글시트 인증 공용 모듈 (scripts/export_*.py 공유).

hyeoks-sports-engine에서 이관하면서 각 스크립트에 중복돼 있던 init_google_sheet()를 한 곳으로 모았다.
"""
import json
import os

import gspread
from oauth2client.service_account import ServiceAccountCredentials

SPREADSHEET_NAME = "HYEOKS_Sports_Toto_Data"
SCOPES = ["https://spreadsheets.google.com/feeds", "https://www.googleapis.com/auth/drive"]

# FotMob 스크래핑 공용 헤더
FOTMOB_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Referer": "https://www.fotmob.com/",
}


def init_google_sheet():
    secret_key = os.environ.get("GOOGLE_SERVICE_ACCOUNT_KEY")
    if not secret_key:
        raise SystemExit("GOOGLE_SERVICE_ACCOUNT_KEY 환경변수가 필요합니다")
    creds = ServiceAccountCredentials.from_json_keyfile_dict(json.loads(secret_key), SCOPES)
    return gspread.authorize(creds).open(SPREADSHEET_NAME)


def write_sheet(spreadsheet, title, headers, rows, cols, value_input_option=None):
    """시트를 매번 clear 후 재기록한다(append-only가 아니라 전체 갱신)."""
    try:
        ws = spreadsheet.worksheet(title)
    except gspread.WorksheetNotFound:
        ws = spreadsheet.add_worksheet(title=title, rows=str(len(rows) + 10), cols=str(cols))
    ws.clear()
    ws.append_row(headers)
    if rows:
        if value_input_option:
            ws.append_rows(rows, value_input_option=value_input_option)
        else:
            ws.append_rows(rows)
    return ws
