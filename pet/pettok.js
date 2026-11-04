/* 화면 펫 × Claude Code 토큰 사용량 (2026-11-02) — 데스크톱 펫(pet.html)이 쓴다. 숫자는 허브 GET /api/tokens(tokenusage.py view) 그대로.
   PetTok.condition(v) : 컨디션 — 'calm'(여유) · 'busy'(바쁨) · 'tired'(지침) · 'spent'(탈진) · null(기록 없음 → 기능이 조용히 꺼진다)
   PetTok.buddies(v)   : 켜진 세션마다 동료 펫 — {list: [{id, name, state: 'work'|'wait', total, seed}](보이는 것), more, all(전부)}
   PetTok.waited(prev, list) : 「작업 중」 → 「대기」로 바뀐 세션 id(그 순간 한 번만 알리려고)
   그리는 쪽은 pet.html — 새 그림 없이 기존 fx(잠·땀방울·통통)·속도(PetWarp.speed)·말풍선만 쓴다. 판정은 여기 순수 함수로(tests/test_pet_tokens.py 가 node 로 돌린다). */
window.PetTok = {
  BUSY: 20000,           // 바쁨: 최근 10분 평균이 분당 2만 토큰 이상(입력+출력+캐시 쓰기 — 캐시 읽기는 많고 싸서 뺀다)
  TIRED: 80,             // 지침: 오늘 또는 이번 달 한도의 80% 이상
  SPENT: 100,            // 탈진: 오늘 한도의 100% 이상(이번 달 100% 는 지침으로만 — 한 달 내내 자면 펫이 쓸모없다)
  MAX: 3,                // 동료 펫은 최대 3마리, 넘치면 「+N」
  rate(v){               // 최근 10분 분당 토큰(캐시 읽기 뺌)
    const m = v && v.rate && v.rate.m10;
    return m ? (+m.input || 0) + (+m.output || 0) + (+m.cache_write || 0) : 0;
  },
  condition(v){
    if (!v || !v.files) return null;                        // 이 PC 에 Claude Code 기록이 없다
    const L = v.limits || {}, pct = s => (s && +s.pct) || 0;
    const day = pct(L.dayState), month = pct(L.monthState);
    if (day >= this.SPENT) return 'spent';
    if (day >= this.TIRED || month >= this.TIRED) return 'tired';
    return this.rate(v) >= this.BUSY ? 'busy' : 'calm';
  },
  hash(s){ let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; },
  folder(s){                                                // 프로젝트 폴더 이름만(전체 경로는 안 보인다)
    if (s.name) return String(s.name);
    const p = String(s.cwd || '').replace(/[\\/]+$/, '');
    return p ? p.split(/[\\/]/).pop() : String(s.project || '').replace(/^[A-Za-z]--/, '') || '세션';
  },
  buddies(v, max){
    max = max || this.MAX;
    const ss = (v && v.files && v.sessions) || [];
    const all = ss.map(s => ({id: s.id, name: this.folder(s), state: s.busy ? 'work' : 'wait', total: +s.total || 0, last: +s.last || 0}));
    all.sort((a, b) => (a.state === b.state ? b.last - a.last : a.state === 'wait' ? -1 : 1));   // 기다리는 세션이 먼저 보이게
    const list = all.slice(0, max), used = new Set();
    for (const b of list) {                                 // 품종은 프로젝트 이름으로 고정 — 같은 프로젝트 세션이 둘이면 다음 것으로 비켜 준다
      let seed = this.hash(b.name);
      while (used.has(seed % 1000)) seed++;
      used.add(seed % 1000); b.seed = seed;
    }
    return {list, more: Math.max(0, all.length - list.length), all};
  },
  pick(breeds, seed){                                       // seed → [kind, 품종 id] — 본 펫과 같은 스킨의 품종에서
    const kinds = ['dog', 'cat'].filter(k => Object.keys((breeds || {})[k] || {}).length);
    if (!kinds.length) return null;
    const kind = kinds[seed % kinds.length], ids = Object.keys(breeds[kind]);
    return [kind, ids[Math.floor(seed / kinds.length) % ids.length]];
  },
  waited(prev, list){
    return list.filter(b => b.state === 'wait' && prev && prev[b.id] === 'work').map(b => b.id);
  },
  fmt(n){
    n = +n || 0;
    for (const [d, s] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) if (Math.abs(n) >= d) return (n / d).toFixed(1).replace(/\.0$/, '') + s;
    return String(Math.round(n));
  },
  info(b){ return b.name + ' · ' + (b.state === 'work' ? '작업 중' : '기다리는 중') + ' · 이번 세션 ' + this.fmt(b.total) + ' 토큰'; },
};
