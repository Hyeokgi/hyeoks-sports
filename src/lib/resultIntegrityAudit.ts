// 운영 DB는 읽기만 하고, 안전한 결과로 다시 계산했을 때 파생값이 얼마나 달라지는지 비교한다.
import { computeEloAndHistory, type MatchRow } from "./elo";
import { dedupeResults } from "./teamAlias";
import { isEligibleResult, parseResultDate, resultUtcCutoff } from "./resultEligibility";
export interface AuditedMatch extends MatchRow { id?: number }
export interface StoredElo { league:string; team_en:string; elo:number; last_season:number; last_match_date:string|null }
export interface StoredDrawRate { league:string; draw_rate:number; sample_size:number }
export function auditResultHistory(rows: readonly AuditedMatch[], previousElo: readonly StoredElo[], previousRates: readonly StoredDrawRate[], now = Date.now()) {
  const cutoff=resultUtcCutoff(now);
  const excluded=rows.filter(r=>!isEligibleResult(r,now));
  const valid=dedupeResults(rows.filter(r=>isEligibleResult(r,now)));
  const ordered=[...valid].sort((a,b)=>a.league < b.league ? -1 : a.league > b.league ? 1 : Date.parse(a.date)-Date.parse(b.date)||(a.id??0)-(b.id??0));
  const {elo}=computeEloAndHistory(ordered);
  const last=new Map<string,string>();
  const byLeague=new Map<string,MatchRow[]>();
  for(const r of ordered){last.set(r.league+"|"+r.home,r.date);last.set(r.league+"|"+r.away,r.date);const a=byLeague.get(r.league)??[];a.push(r);byLeague.set(r.league,a);}
  const old=new Map(previousElo.map(r=>[r.league+"|"+r.team_en,r]));
  const eloDiffs=[...elo].flatMap(([key,value])=>{
    const p=old.get(key), date=last.get(key)!;
    if(p&&Math.abs(p.elo-value.elo)<1e-8&&p.last_season===value.lastSeason&&p.last_match_date===date)return [];
    const sep=key.indexOf("|");
    return [{league:key.slice(0,sep),team:key.slice(sep+1),oldElo:p?.elo??null,newElo:value.elo,delta:p?value.elo-p.elo:null,oldDate:p?.last_match_date??null,newDate:date,lastSeason:value.lastSeason}];
  }).sort((a,b)=>Math.abs(b.delta??Infinity)-Math.abs(a.delta??Infinity));
  const drawDiffs=[...byLeague].flatMap(([league,rs])=>{
    const rate=rs.filter(r=>r.hg===r.ag).length/rs.length,p=previousRates.find(r=>r.league===league);
    return p&&Math.abs(p.draw_rate-rate)<1e-12&&p.sample_size===rs.length?[]:[{league,oldRate:p?.draw_rate??null,newRate:rate,oldSample:p?.sample_size??null,newSample:rs.length}];
  });
  return {cutoff:cutoff.iso,rawRows:rows.length,eligibleRows:ordered.length,duplicateRows:rows.length-excluded.length-ordered.length,excluded:excluded.map(r=>({...r,reason:parseResultDate(r.date)==null?"invalid_date":parseResultDate(r.date)!.ms>now?"future_date":"invalid_score"})),eloDiffs,drawDiffs};
}
