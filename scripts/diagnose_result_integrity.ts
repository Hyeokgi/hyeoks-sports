// 읽기 전용 운영 진단. 원본 결과·예측·정산은 쓰거나 지우지 않는다.
import {execFileSync} from "node:child_process";
import {auditResultHistory, type AuditedMatch, type StoredElo, type StoredDrawRate} from "../src/lib/resultIntegrityAudit";
function query<T>(sql:string):T[]{
  if(!/^SELECT\s/i.test(sql)||sql.includes(';'))throw new Error('진단은 단일 SELECT만 허용합니다');
  const text=execFileSync('npx',['--no-install','wrangler','d1','execute','kleague-toto-db','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000,stdio:['ignore','pipe','pipe']});
  const results=JSON.parse(text);
  if(!Array.isArray(results)||results.some(r=>!r.success))throw new Error('운영 읽기 조회 실패');
  return results.flatMap(r=>r.results??[]);
}
try{
  const now=Date.now();
  const rows=query<AuditedMatch>('SELECT id,league,date,home,away,hg,ag FROM matches ORDER BY league ASC,date ASC,id ASC');
  const elo=query<StoredElo>('SELECT league,team_en,elo,last_season,last_match_date FROM team_elo ORDER BY league,team_en');
  const rates=query<StoredDrawRate>('SELECT league,draw_rate,sample_size FROM league_draw_rates ORDER BY league');
  const out=auditResultHistory(rows,elo,rates,now);
  const counts=query('SELECT (SELECT COUNT(*) FROM prediction_snapshots) AS snapshot_rows,(SELECT COUNT(*) FROM prediction_history) AS history_rows,(SELECT COUNT(*) FROM round_predictions) AS prediction_input_rows');
  console.log(JSON.stringify({mode:'READ_ONLY_NO_WRITES',cutoff:out.cutoff,rawRows:out.rawRows,eligibleRows:out.eligibleRows,duplicateRows:out.duplicateRows,excludedCount:out.excluded.length,excluded:out.excluded.slice(0,30),eloChanged:out.eloDiffs.length,eloDiffs:out.eloDiffs.slice(0,30),drawDiffs:out.drawDiffs,preservedCounts:counts},null,2));
}catch{
  // CLI stderr에는 환경 세부가 포함될 수 있으므로 원문 오류를 통째로 공개하지 않는다.
  console.error('읽기 전용 결과 정합성 진단 실패. 원본·파생값을 수정하지 않았습니다.');
  process.exitCode=1;
}
