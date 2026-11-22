import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { renderDataHome } from "../src/lib/dataHome";
import { recentFootballStories, hasRecentFootballStories, publishedStoryPaths, storyIsPublished, renderStoriesIndex, readingStories, renderStory, storyCards } from "../src/lib/stories";
import { FOOTBALL_NEWS } from "../src/lib/footballNews";
import { handleStoriesPage } from "../src/routes/storiesPage";
import { renderSitePage } from "../src/lib/publicSite";
import { renderLeaguePage } from "../src/lib/matchPage";
import { leagueInfo } from "../src/lib/teamNames";
const now = Date.parse("2026-11-20T14:00:00Z");
const home = (generatedAt = new Date(now).toISOString()) => renderDataHome({generatedAt,matches:[],performance:null,performanceUnavailable:false,rounds:[]});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-20T14:00:00Z")); });
afterEach(() => vi.useRealTimers());
describe("경기 재미를 먼저 읽는 매거진",()=>{
  it("한국전이 대표 기사이며 설명·확률·도구는 뒤에 둔다",()=>{
    const html=home();
    const lead=html.indexOf('class="news-lead"');
    const reading=html.indexOf('id="h-reading"');
    const data=html.indexOf('id="h-data"');
    const tools=html.indexOf("더 살펴보기: 승무패");
    expect(lead).toBeGreaterThan(0);
    expect(lead).toBeLessThan(reading);expect(reading).toBeLessThan(data);expect(data).toBeLessThan(tools);
    const feature=html.slice(lead,reading);
    expect(feature).toContain("슈팅 20대2");
    expect(feature).not.toContain("구매");
    expect(feature).not.toContain("토토");
    for(const story of FOOTBALL_NEWS) expect(html).toContain('href="/stories/'+story.slug+'"');
    expect(html).toContain('href="/app"');
  });
  it("미발행 글은 노출하지 않고 지난 기록을 영원히 최근으로 부르지 않는다",()=>{
    expect(recentFootballStories(Date.parse("2026-11-19T12:00:00Z"))).toEqual([]);
    expect(recentFootballStories(now)).toHaveLength(3);
    expect(readingStories()).toHaveLength(3);
    expect(home()).toContain("최근 경기에서 찾은 이야기");
    const archive=home("2026-12-01T12:00:00Z");
    expect(archive).toContain("경기 이야기 다시 읽기");
    expect(archive).not.toContain("요즘 경기엔 어떤 반전이 있었을까요?");
  });
  it("자료 확인 전에는 홈·목록·직접 기사·JSON·사이트맵 경로가 함께 비공개다",()=>{
    const before=Date.parse(FOOTBALL_NEWS[0].dataAsOf!)-1;
    vi.setSystemTime(new Date(before));
    const paths=publishedStoryPaths(before);
    for(const s of FOOTBALL_NEWS){
      expect(storyIsPublished(s,before)).toBe(false);
      expect(paths).not.toContain('/stories/'+s.slug);
      expect(renderStory(s.slug,before)).toBeNull();
      expect(renderStoriesIndex(before)).not.toContain('href="/stories/'+s.slug+'"');
      expect(home(new Date(before).toISOString())).not.toContain('href="/stories/'+s.slug+'"');
      expect(handleStoriesPage('/stories/'+s.slug)!.status).toBe(404);
      expect(handleStoriesPage('/stories/'+s.slug+'/snapshot.json')!.status).toBe(404);
      expect(storyIsPublished(s,before+1)).toBe(true);
    }
  });
  it("날짜만 쓴 발행일은 한국시간이며 목록의 최근 문구도 만료된다",()=>{
    const s={...FOOTBALL_NEWS[0],publishedAt:'2026-12-01',dataAsOf:null};
    expect(storyIsPublished(s,Date.parse('2026-11-30T14:59:59Z'))).toBe(false);
    expect(storyIsPublished(s,Date.parse('2026-11-30T15:00:00Z'))).toBe(true);
    const later=Date.parse('2026-12-01T12:00:00Z');
    expect(hasRecentFootballStories(later)).toBe(false);
    expect(renderStoriesIndex(later)).toContain('경기 이야기 아카이브');
    expect(renderStoriesIndex(later)).not.toContain('최근 경기에서 찾은 이야기');
  });
  it("날짜뿐인 경기일에 허구의 오전 9시를 붙이지 않는다",()=>{
    const cards=storyCards(FOOTBALL_NEWS);
    expect(cards).toContain("2026-11-18 (한국시간)");
    expect(cards).not.toContain("09:00");
  });
  it.each(FOOTBALL_NEWS)("$slug 출처와 본문 뒤에서 확률·도구로 이어진다",(s)=>{
    const html=renderStory(s.slug)!;
    const article=html.split('<article class="site-prose story-article">')[1];
    expect(article.indexOf('id="story-sources"')).toBeLessThan(article.indexOf("이제 확률도 궁금하다면"));
    expect(article.indexOf("이제 확률도 궁금하다면")).toBeLessThan(article.indexOf('href="/app"'));
    expect(article).toMatch(/<details class="story-reading-notes"><summary>(?:점수판 열기|추가시간에 무슨 일이 있었을까\?|두 경기 점수 공개)<\/summary><p><strong>/);
    expect(html).toContain('data-reading-theme="light"');
    for(const source of s.sources)expect(html).toContain(source.replaceAll('&','&amp;'));
  });
  it.each(FOOTBALL_NEWS)("$slug 데이터 스냅샷은 HTML 색인과 구분한다",async(s)=>{
    const r=handleStoriesPage('/stories/'+s.slug+'/snapshot.json')!;
    expect(r.status).toBe(200);expect(r.headers.get('x-robots-tag')).toBe('noindex');
    expect(await r.json()).toMatchObject({asOf:s.dataAsOf,scope:s.scope});
  });
  it("상속 프로퍼티를 스냅샷으로 공개하지 않는다",()=>{
    for(const key of ['constructor','__proto__','toString'])expect(handleStoriesPage('/stories/'+key+'/snapshot.json')!.status).toBe(404);
  });
});
describe("밝은 읽기 테마",()=>{
  it("공개 페이지와 리그 화면은 공유한 테마 자산을 쓴다",()=>{
    for(const html of [home(),renderSitePage({title:'t',description:'d',path:'/about',body:'<h1>t</h1>'}),renderLeaguePage({league:'EPL',info:leagueInfo('EPL'),upcoming:[],recent:[]})]){
      expect(html).toContain('data-reading-theme="light"');
      expect(html).toContain('/reader.css?v=football-20261120');
      expect(html).not.toMatch(/<script[^>]+src=["'][^"']*googlesyndication/);
    }
  });
  it("정적 페이지도 밝게 하되 앱에는 밝은 테마를 강제하지 않는다",()=>{
    const source=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8');
    expect(source).toContain('if (path !== "/app") el.setAttribute("data-reading-theme", "light")');
    expect(source).toContain('path === "/app" ? ""');
    const css=readFileSync(new URL('../public/reader.css',import.meta.url),'utf8');
    expect(css).toContain('body[data-reading-theme="light"]');
    expect(css).not.toContain('url(https:');
  });
  it("기본 텍스트·녹색·코랄은 밝은 배경에서 AA 대비를 유지한다",()=>{
    const luminance=(hex:string)=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
    for(const bg of ['#fbf9f3','#ffffff'])for(const fg of ['#20332b','#5d6c62','#176b4c','#b84d3b']){
      const a=luminance(bg),b=luminance(fg);
      expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
