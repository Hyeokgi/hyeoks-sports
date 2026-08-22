// GitHub Actions 러너에서 Worker의 관리자 회차 감지 API를 수동 트리거한다.
// (Worker 자체 크론이 6시간마다 돌지만, 발매 직후 바로 회차를 올리고 싶을 때 workflow_dispatch로 사용.)
// detectNewRound는 "DB의 최대 회차번호+1"을 wisetoto에서 찾는 방식이라 이미 등록된 회차는 중복 생성되지 않는다.
const WORKER_BASE_URL = process.env.WORKER_BASE_URL ?? "https://kleague-toto-predictor.hyeoks.workers.dev";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

async function main() {
  if (!ADMIN_TOKEN) throw new Error("ADMIN_TOKEN 환경변수가 필요합니다");

  const res = await fetch(`${WORKER_BASE_URL}/api/admin/detect-round`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (!res.ok) throw new Error(`detect-round 실패: ${res.status} ${await res.text()}`);
  const result = await res.json();
  console.log(`detect-round 결과: ${JSON.stringify(result)}`);

  const roundsRes = await fetch(`${WORKER_BASE_URL}/api/rounds`);
  if (!roundsRes.ok) throw new Error(`/api/rounds 조회 실패: ${roundsRes.status}`);
  const { rounds } = await roundsRes.json();
  const latest = rounds?.[0];
  if (latest) {
    console.log(
      `현재 최신 회차: round_no=${latest.round_no}${latest.round_no_confirmed ? "(확정)" : "(미확정)"} id=${latest.id} status=${latest.status}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
