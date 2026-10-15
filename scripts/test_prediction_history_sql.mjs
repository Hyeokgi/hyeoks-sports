// 문자열 검사만으로 잡기 어려운 SQLite 구문·원자적 가드·추가 전용 제약을 실제 실행한다.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'hyeoks-history-'));
const db = join(dir, 'smoke.sqlite');
// SQL을 표준입력으로 넘겨 --로 시작하는 주석이 CLI 옵션으로 해석되지 않게 한다.
const sql = (query) => execFileSync('sqlite3', ['-batch', db], {input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const literal = (v) => typeof v === 'number' ? String(v) : "'" + String(v).replaceAll("'", "''") + "'";
const source = readFileSync('src/lib/predictionHistory.ts','utf8');
const template = source.match(/export const PREDICTION_HISTORY_INSERT_SQL = `([\s\S]*?)`;/)?.[1];
assert.ok(template, '실제 배포 INSERT SQL을 읽어야 합니다');
assert.equal((template.match(/\?/g)||[]).length, 10);
const base = Date.now() - 3600000;
const iso = (ms) => new Date(ms).toISOString();
const kickoff = iso(Date.now() + 86400000);
const insert = (probs, at, basis='model', predictedKickoff=kickoff) => {
  const values = [1,...probs,'홈승',basis,iso(at),predictedKickoff,'history-instrumentation-v1','{"schema":1}'];
  let i=0;
  return sql(template.replace(/\?/g,()=>literal(values[i++])));
};
const count = () => Number(sql('SELECT count(*) FROM prediction_history'));
try {
  sql('PRAGMA foreign_keys=ON; CREATE TABLE rounds(id INTEGER PRIMARY KEY); CREATE TABLE round_matches(id INTEGER PRIMARY KEY,round_id INTEGER,kickoff_at TEXT); INSERT INTO rounds VALUES(1); INSERT INTO round_matches VALUES(1,1,'+literal(kickoff)+');');
  sql(readFileSync('migrations/0014_prediction_history.sql','utf8'));
  const A=[0.6,0.25,0.15], B=[0.55,0.3,0.15];
  insert(A,base); assert.equal(count(),1);
  insert(A,base+1000); assert.equal(count(),1,'연속된 같은 확률은 늘리지 않는다');
  insert(B,base+2000); insert(A,base+3000); assert.equal(count(),3,'A→B→A 변화는 보존한다');
  insert(B,base+1500); insert(B,base+3000); assert.equal(count(),3,'과거·같은 시각의 값으로 이력을 바꾸지 않는다');
  insert(B,Date.parse(kickoff)); assert.equal(count(),3,'킥오프와 같은 시각은 저장하지 않는다');
  insert(B,base+4000,'model',iso(base)); assert.equal(count(),3,'계산 당시 킥오프도 확인한다');
  assert.throws(()=>insert([0.6,0.3,0.3],base+5000),/CHECK constraint failed/);
  insert(A,base+6000,'market'); assert.equal(count(),4,'근거가 바뀌면 같은 확률도 남긴다');
  sql('UPDATE round_matches SET kickoff_at='+literal(iso(base-1))+' WHERE id=1');
  insert(B,base+7000); assert.equal(count(),4,'DB의 킥오프 변경을 확인한다');
  // 캡처 시각이 과거여도 DB 현재 시각에 이미 시작했다면 거부한다.
  sql('UPDATE round_matches SET kickoff_at='+literal(iso(Date.now()-1000))+' WHERE id=1');
  insert(B,base+8000); assert.equal(count(),4);
  assert.throws(()=>sql('UPDATE prediction_history SET p_home=0.5 WHERE id=1'),/append-only/);
  assert.throws(()=>sql('DELETE FROM prediction_history WHERE id=1'),/append-only/);
  assert.equal(count(),4);
  console.log('prediction_history SQL smoke passed: migration, A→A→B→A, basis change, clock/kickoff guards, invalid probability, immutable rows');
} finally {
  rmSync(dir,{recursive:true,force:true});
}
