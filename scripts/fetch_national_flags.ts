// 국가대표 경기 엠블럼용 국기를 public/flags/에 받아 둔다(한 번 돌리고 커밋).
// 출처: lipis/flag-icons(MIT). 원형 엠블럼 자리에 꽉 차게 넣으려고 정사각(1x1) 판을 쓴다.
// 실행: npx tsx scripts/fetch_national_flags.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { NATIONAL_FLAG_CODE, NATIONAL_EN_NAMES } from "../src/lib/nationalNames";

const SRC = "https://raw.githubusercontent.com/lipis/flag-icons/main/flags/1x1";

async function main() {
  const missing = NATIONAL_EN_NAMES.filter((n) => !NATIONAL_FLAG_CODE[n]);
  if (missing.length) throw new Error(`국기 코드가 없는 국가: ${missing.join(", ")}`);
  mkdirSync("public/flags", { recursive: true });
  const codes = [...new Set(Object.values(NATIONAL_FLAG_CODE))].sort();
  for (const code of codes) {
    const res = await fetch(`${SRC}/${code}.svg`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${code}: ${res.status}`);
    const svg = await res.text();
    if (!svg.includes("<svg")) throw new Error(`${code}: SVG가 아님`);
    writeFileSync(`public/flags/${code}.svg`, svg);
  }
  writeFileSync(
    "public/flags/LICENSE",
    "Flags from lipis/flag-icons (https://github.com/lipis/flag-icons), MIT License, Copyright (c) 2013 Panayiotis Lipiridis\n",
  );
  console.log(`국기 ${codes.length}개 저장`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
