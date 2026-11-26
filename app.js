const $ = s => document.querySelector(s);
const TAG = { read: '#c', write: '#cw' };          // PC 게이트웨이의 지시 태그(읽기 · 수정 허용)
// 이 기기의 설정·보낸 기록. 저장이 막힌 브라우저에서도 화면은 돈다.
// 키 앞머리 'dnc.' — 같은 github.io 출처의 다른 페이지(공개 키트의 dispatch-page 가 'dispatch.' 를 썼다)와 저장 공간이
// 겹쳐 서로 덮어쓰고 암호 단어·Gmail 토큰을 읽을 수 있었다(2026-10-19 보안 점검). 옛 'dispatch.' 값은 한 번 옮기고 지운다.
const KEYP = 'dnc.', OLDP = 'dispatch.';
try {
  if (localStorage.getItem(KEYP + 'moved') == null) {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(OLDP)) continue;
      const nk = KEYP + k.slice(OLDP.length);
      if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
    localStorage.setItem(KEYP + 'moved', '1');
  }
} catch (e) {}
const store = {
  get(k, d) { try { const v = localStorage.getItem(KEYP + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(KEYP + k, JSON.stringify(v)); } catch (e) {} },
};
/* ---- 공통 디자인 「책등」(2026-11-20, 정본 C:\swbins-pub\design-draft\identity\SPEC.md) — 바탕 · 강조색 · 화면 밝기.
   견본 칸은 [이름, 밝게, 어둡게]. 바탕 견본·상태 막대는 바탕색, 강조 견본은 책등색.
   남의 디자인과 겹친 옛 값(종이 노트·흰 종이·청회색·벽돌·디자인 여덟 벌)은 지웠다 — 저장된 옛 값은 책등·먹으로 읽는다.
   밝기 자동 = 기기 시각 19:00~07:00 어둡게(기기 설정이 어둡게면 어둡게), 1분마다 다시 본다. 잠금 화면(lock/unlock.js)도 같은 'dnc.look' 을 읽는다 ---- */
const LOOK_THEMES = { spine: ['책등', '#EEF3EA', '#1B2018'], kraft: ['크라프트지', '#E9DEC9', '#221D16'] };
const LOOK_ACCENTS = { mono: ['먹', '#2F3A3A', '#5A6D69'], ink: ['남색', '#2F5283', '#4D6C98'], pine: ['초록', '#2F6B4F', '#45745E'],
  plum: ['자주', '#7B3A6B', '#905784'], ochre: ['황토', '#7D5A12', '#83652D'] };
const LOOK_MODES = { auto: ['자동'], light: ['밝게'], dark: ['어둡게'] };
const darkMq = matchMedia('(prefers-color-scheme: dark)');
/* 「직접」 — 색상표(input type=color)에서 고른 #rrggbb. 바탕 = look.theme 'custom' + look.bg, 강조 = look.accent 'custom' + look.custom.
   아래 함수 묶음은 SPEC.md 「바탕 직접 고르기」 절 그대로(잠금 화면 lock/unlock.js 에도 같은 묶음).
   bgFor 는 고른 색조로 밝게·어둡게 바탕 한 벌을, spineFor 는 그 바탕 위에서 읽히는 책등 두 값을 만든다. 이상한 값이면 null → 책등·먹 */
// 바탕 직접 고르기 — 고른 색의 색조로 밝게·어둡게 바탕 한 벌(bg·ink·sub·face·face2·line·b3)을 만든다
function hexHls(hex){var r=parseInt(hex.substr(1,2),16)/255,g=parseInt(hex.substr(3,2),16)/255,b=parseInt(hex.substr(5,2),16)/255;
  var mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,d=mx-mn,h=0,s=0;
  if(d){s=l>.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h/=6}return [h,l,s]}
function hlsHex(h,L,s){var q=L<.5?L*(1+s):L+s-L*s,p=2*L-q,f=function(t){t<0&&(t+=1);t>1&&(t-=1);return t<1/6?p+(q-p)*6*t:t<.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p};
  return '#'+[h+1/3,h,h-1/3].map(function(t){return ('0'+Math.round((s?f(t):L)*255).toString(16)).slice(-2)}).join('').toUpperCase()}
function lum(h){var c=[1,3,5].map(function(i){var x=parseInt(h.substr(i,2),16)/255;return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]}
function cr(a,b){var x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
function bgFor(hex){ // → {light:{bg,ink,sub,face,face2,line,b3}, dark:{…}} 또는 null
  if(!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  var x=hexHls(hex),h=x[0],l=x[1],s=x[2];
  var sl=Math.min(s,.45), sd=Math.min(s,.22), si=Math.min(s,.25);   // 바탕은 채도를 눌러 눈 피로 줄이기
  var Lb=Math.max(Math.min(l,.95),.86);                              // 밝게 바탕: 고른 색이 밝으면 그대로, 진하면 0.86~0.95 로
  var light={bg:hlsHex(h,Lb,sl),face:hlsHex(h,Lb-.05,sl),face2:hlsHex(h,Math.min(Lb+.03,.98),sl),line:hlsHex(h,Lb-.11,sl*.8),b3:hlsHex(h,Lb-.14,sl*.8),ink:hlsHex(h,.17,si),sub:hlsHex(h,.36,si)};
  var dark={bg:hlsHex(h,.10,sd),face:hlsHex(h,.15,sd),face2:hlsHex(h,.075,sd),line:hlsHex(h,.20,sd),b3:hlsHex(h,.24,sd),ink:hlsHex(h,.88,si),sub:hlsHex(h,.66,si)};
  // 글씨 대비 보정 — 본문 7 이상·보조 4.5 이상이 될 때까지 글씨를 밀어낸다
  function fix(o,dirDark){var k,L;for(k of ['ink','sub']){var need=k==='ink'?7:4.5,c=o[k];L=hexHls(c)[1];
    while(cr(c,o.bg)<need&&L>0&&L<1){L+=dirDark?-.01:.01;c=hlsHex(h,L,si)}o[k]=c}return o}
  return {light:fix(light,true),dark:fix(dark,false)};
}
// 강조 spine — 바탕을 받아 그 바탕 위에서 3:1, 책등 글씨 4.5:1
function spineFor(hex,bgL,bgD){
  if(!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  bgL=bgL||['#EEF3EA','#E9DEC9']; bgD=bgD||['#1B2018','#221D16'];
  var x=hexHls(hex),h=x[0],l=x[1],s=x[2],light=null,dark=null,L,c;
  for(L=Math.min(l,.6);L>=0;L-=.005){c=hlsHex(h,L,s);if(cr(c,'#E9EEE2')>=4.5&&bgL.every(function(b){return cr(c,b)>=3})){light=c;break}}
  for(L=.2;L<=.8;L+=.005){c=hlsHex(h,L,s);if(bgD.every(function(b){return cr(c,b)>=3.05})){if(cr(c,'#EEF2E8')>=4.5)dark=c;break}}
  return {light:light||'#2F3A3A',dark:dark||'#5A6D69'};
}
const okHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
function lookGet() {
  const l = store.get('look', {}) || {};
  const bg = okHex(l.bg), custom = okHex(l.custom);
  let theme = LOOK_THEMES[l.theme] ? l.theme : 'spine';
  if (l.theme === 'custom') theme = bg ? 'custom' : 'spine';
  let accent = LOOK_ACCENTS[l.accent] ? l.accent : 'mono';
  if (l.accent === 'custom') accent = custom ? 'custom' : 'mono';
  return { theme, bg, accent, custom, mode: LOOK_MODES[l.mode] ? l.mode : 'auto' };
}
function lookDark(mode) {
  if (mode === 'auto') { const hr = new Date().getHours(); return hr >= 19 || hr < 7 || darkMq.matches; }
  return mode === 'dark';
}
/* 지금 고른 것으로 실제 색 — 바탕 한 벌(직접일 때만)·책등 두 값(직접 바탕이거나 직접 강조일 때만 계산, 아니면 CSS 표 값) */
function lookColors(l) {
  const bg = l.theme === 'custom' ? bgFor(l.bg) : null;
  let sp = null;
  if (bg || l.accent === 'custom') {
    const hex = l.accent === 'custom' ? l.custom : LOOK_ACCENTS[l.accent][1];
    sp = bg ? spineFor(hex, [bg.light.bg], [bg.dark.bg]) : spineFor(hex);
  }
  return { bg, sp };
}
const LD = (a, b) => 'light-dark(' + a + ',' + b + ')';
let lookSig = '';
function lookVars(l) {                                   // 색만 붙인다(칸은 다시 안 그린다 — 색상표를 돌리는 동안)
  const dark = lookDark(l.mode), d = dark ? 2 : 1, h = document.documentElement, st = h.style, { bg, sp } = lookColors(l);
  h.dataset.theme = dark ? 'dark' : 'light'; h.dataset.base = l.theme; h.dataset.accent = l.accent;
  delete h.dataset.design;
  const vars = bg ? { '--bg': LD(bg.light.bg, bg.dark.bg), '--solid': LD(bg.light.face2, bg.dark.face2), '--soft': LD(bg.light.face, bg.dark.face),
    '--face': LD(bg.light.face, bg.dark.face), '--b3': LD(bg.light.b3, bg.dark.b3), '--text': LD(bg.light.ink, bg.dark.ink),
    '--muted': LD(bg.light.sub, bg.dark.sub), '--line': LD(bg.light.line, bg.dark.line),
    '--field': 'color-mix(in srgb,var(--muted) 60%,var(--bg))', '--edge': LD(bg.light.ink, bg.dark.sub) } : {};
  for (const k of ['--bg', '--solid', '--soft', '--face', '--b3', '--text', '--muted', '--line', '--field', '--edge']) {
    if (vars[k]) st.setProperty(k, vars[k]); else st.removeProperty(k);
  }
  if (sp) st.setProperty('--spine', LD(sp.light, sp.dark)); else st.removeProperty('--spine');
  const bar = bg ? (dark ? bg.dark.bg : bg.light.bg) : LOOK_THEMES[l.theme][d];
  for (const m of document.querySelectorAll('meta[name=theme-color]')) m.content = bar;   // 아이폰 상태 막대 = 바탕
  for (const [id, pair] of [['#lookBgPrev', bg && [bg.light.bg, bg.dark.bg]], ['#lookCustomPrev', l.accent === 'custom' && sp && [sp.light, sp.dark]]]) {
    const pv = $(id); if (!pv) continue;
    pv.hidden = !pair;
    if (pair) { const [a, b] = pv.querySelectorAll('i'); a.style.background = pair[0]; b.style.background = pair[1]; }
  }
  return { d, bg, sp };
}
/* 줄 끝 「직접」 칸 — 색상표를 칸 안에 감춰 두고 누르면 열린다. 고르는 동안 바로 칠하고, 다 고르면 칸을 다시 그린다 */
function lookCustomCell(on, saved, show, label, onPick) {
  const lab = el('label', 'custom' + (on ? ' on' : '')), inp = el('input'), i = el('i');
  inp.type = 'color'; inp.value = saved || '#2f3a3a'; inp.setAttribute('aria-label', label);
  i.style.background = show || 'transparent';
  lab.append(i, '직접', inp);
  const pick = done => { if (okHex(inp.value)) onPick(inp.value.toLowerCase(), done); };
  inp.addEventListener('input', () => pick(false));
  inp.addEventListener('change', () => pick(true));
  if (!on && saved) lab.addEventListener('click', () => onPick(saved, true));   // 전에 고른 색이 있으면 누르기만 해도 그 색으로
  return lab;
}
function lookApply() {
  const l = lookGet(), { d, bg, sp } = lookVars(l), sig = JSON.stringify(l) + d;
  if (sig === lookSig) return;                           // 1분마다 다시 볼 때 바뀐 게 없으면 칸을 그대로 둔다
  lookSig = sig;
  for (const [box, list, key] of [['#lookTheme', LOOK_THEMES, 'theme'], ['#lookAccent', LOOK_ACCENTS, 'accent'], ['#lookMode', LOOK_MODES, 'mode']]) {
    const e = $(box); if (!e) continue;
    e.replaceChildren(...Object.entries(list).map(([id, v]) => {
      const b = el('button', id === l[key] ? 'on' : '');
      b.type = 'button'; b.setAttribute('aria-pressed', String(id === l[key]));
      if (v[d]) { const i = el('i'); i.style.background = v[d]; b.append(i); }
      b.append(v[0]);
      b.addEventListener('click', () => { store.set('look', { ...lookGet(), [key]: id }); lookApply(); });
      return b;
    }));
    const set = patch => (hex, done) => { store.set('look', { ...lookGet(), ...patch(hex) }); if (done) lookApply(); else lookVars(lookGet()); };
    if (key === 'theme') {
      const sb = l.bg ? bgFor(l.bg) : null;
      e.append(lookCustomCell(l.theme === 'custom', l.bg, sb && (d === 2 ? sb.dark.bg : sb.light.bg), '바탕색 직접 고르기',
        set(hex => ({ theme: 'custom', bg: hex }))));
    }
    if (key === 'accent') {
      const cs = l.accent === 'custom' ? sp : l.custom ? lookColors({ ...l, accent: 'custom' }).sp : null;
      e.append(lookCustomCell(l.accent === 'custom', l.custom, cs && (d === 2 ? cs.dark : cs.light), '강조색 직접 고르기',
        set(hex => ({ accent: 'custom', custom: hex }))));
    }
  }
}
darkMq.addEventListener('change', lookApply);
setInterval(lookApply, 60000);
lookApply();

let cfg = store.get('cfg', { mail: '', folders: [], prefix: '' });
// 암호 단어는 허브가 정본 — 잠긴 페이지(lock/unlock.js)가 풀면서 허브가 실어 보낸 단어를 넘겨준다(2026-11-20).
// 손으로 넣은 값과 다르면 허브 값으로 바꾸고 한 번만 알린다(단어 원문은 화면에 띄우지 않는다).
(() => {
  let w = '';
  try { w = sessionStorage.getItem('dnc.lockWord') || ''; sessionStorage.removeItem('dnc.lockWord'); } catch (e) {}
  if (!/^[^\s\[\]]{6,40}$/.test(w) || w === cfg.key) return;
  const had = !!cfg.key;
  cfg.key = w; store.set('cfg', cfg);
  setTimeout(() => toast(had ? '암호 단어가 새로 바뀌었어요' : '암호 단어를 PC 에서 받아 넣었어요'), 700);
})();
let sent = store.get('sent', []);
let mode = 'read', folder = '', picks = new Set(), stop = false, pickN = 4;

function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), 2600); }
function el(t, c, x) { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
const pad = n => String(n).padStart(2, '0');

/* 11-26 — PC 메신저와 같은 규칙: T번호 · #태그 · 제목 줄 · [dnc:wt] 표식 · 「먼저 질문」 문구 · 검토/인계문 문구 */
var lastRooms = [];
var TREF_RE = /(?<![A-Za-z0-9])T(\d{1,5})(?![0-9])/g, TAG_RX = /(?<![\w&#/])#([0-9A-Za-z가-힣_][0-9A-Za-z가-힣_\-]{0,19})/g;
var TAG_SKIP = new Set(['c', 'cw', 'hub', 'k']);
var HEAD_RE = /^\s*(#{1,4}\s+\S|\*\*[^*\n]{2,80}\*\*|[①-⑳]\s*\S|[■▶◆]\s*\S)/;
var HASH_RE = /(?<![-\w])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![-\w])/g;
var WT_RE = /^[ \t]*\[dnc:wt\][ \t]*$/m;
function headText(l) { return l.replace(/^\s*#{1,4}\s+/, '').replace(/\*\*/g, '').trim().slice(0, 60); }
function roomTags(r) {
  const out = [];
  for (const m of r.msgs.filter(x => !x.bot).concat(r.out)) for (const t of String(m.text || m.rest || '').matchAll(TAG_RX)) {
    const g = t[1]; if (!TAG_SKIP.has(g.toLowerCase()) && !out.includes(g)) out.push(g);
  }
  return out.slice(0, 6);
}
function roomFolder(r) { const f = r.msgs.find(m => !m.bot) || r.out[0], m = f && /^@([\w.\-]+)/.exec(f.text || ''); return m ? m[1] : ''; }
function roomRefs(r) {                                   // 이 대화 글에 나온 다른 대화 번호
  const s = new Set();
  for (const m of r.msgs.concat(r.out)) for (const x of String(m.text || m.rest || '').matchAll(TREF_RE)) if (+x[1] !== r.no) s.add(+x[1]);
  return [...s];
}
function tagFind(g) { if (room) closeRoom(); $('#q').value = '#' + g; query = ('#' + g).toLowerCase(); $('#searchBar').classList.add('on'); draw(); }
/* O2/O7 찾기 — 글자 · T12 · #태그 · folder:/status:/tag:/mode: (폴더·상태·태그·권한:) */
var ST_ALIAS = { '완료': ['완료'], 'done': ['완료'], '작업중': ['일하는 중'], 'running': ['일하는 중'], '진행중': ['일하는 중', '전송됨', '보내는 중'],
  '대기': ['전송됨', '보내는 중'], '오류': ['오류'], '실패': ['오류'], 'error': ['오류'], '답필요': ['질문', '실행 확인'], '답할것': ['질문', '실행 확인'], '질문': ['질문'], '확인필요': ['실행 확인'] };
var FIND_KEY = { '폴더': 'folder', '상태': 'status', '태그': 'tag', '권한': 'mode' };
function findRoom(r, q) {
  const f = { rest: [] };
  for (const w of q.split(/\s+/).filter(Boolean)) {
    const m = /^(folder|status|tag|mode|폴더|상태|태그|권한):(.+)$/i.exec(w);
    if (m) { const k = FIND_KEY[m[1]] || m[1].toLowerCase(); (f[k] = f[k] || []).push(m[2].replace(/^[@#]/, '')); continue; }
    const tm = /^#(\S+)$/.exec(w); if (tm) { (f.tag = f.tag || []).push(tm[1]); continue; }
    const nm = /^t(\d{1,5})$/i.exec(w); if (nm) { (f.no = f.no || []).push(+nm[1]); continue; }
    f.rest.push(w);
  }
  if (f.no && !f.no.includes(r.no)) return false;
  if (f.folder && !f.folder.some(x => roomFolder(r).toLowerCase() === x || (!roomFolder(r) && ['default', '기본'].includes(x)))) return false;
  if (f.status && !f.status.some(x => (ST_ALIAS[x.replace(/\s+/g, '')] || [x]).includes(r.st))) return false;
  const tags = roomTags(r).map(x => x.toLowerCase());
  if (f.tag && !f.tag.every(x => tags.includes(x))) return false;
  if (f.mode && !f.mode.some(x => (/^(수정|write|w|쓰기)/.test(x) ? 'write' : 'read') === r.mode)) return false;
  const all = [r.title, r.last, r.no ? 'T' + r.no : ''].concat(r.msgs.map(m => (m.text || '') + ' ' + (m.rest || ''))).join('\n').toLowerCase();
  return f.rest.every(w => all.includes(w));
}
/* ⑦ 상태별 묶음 — PC 칸반의 넷(대기 · 작업 중 · 답할 것 · 완료)을 폰에선 접는 묶음으로 */
var GRP = [['ask', '답할 것'], ['busy', '작업 중'], ['wait', '대기'], ['err', '오류'], ['done', '완료']];
var grpShut = store.get('grpShut', {});
function grpOn() { return !!store.get('grpOn', false); }
function grpOf(r) { return isWait(r) ? 'ask' : r.st === '일하는 중' ? 'busy' : ['전송됨', '보내는 중'].includes(r.st) ? 'wait' : r.st === '오류' ? 'err' : 'done'; }
function grpSort(rooms) { const o = Object.fromEntries(GRP.map((g, i) => [g[0], i])); return rooms.slice().sort((a, b) => o[grpOf(a)] - o[grpOf(b)] || b.ts - a.ts); }
function grpHead(g, rooms) {
  const n = rooms.filter(r => grpOf(r) === g).length, b = el('button', 'grp');
  b.append(el('b', '', GRP.find(x => x[0] === g)[1]), el('span', '', String(n)), el('span', 'go', grpShut[g] ? '›' : '▾'));
  b.onclick = () => { grpShut[g] = !grpShut[g]; store.set('grpShut', grpShut); draw(); };
  return b;
}
/* O3·O4·P9 — 말풍선 글의 T번호 → 그 대화, #태그 → 태그 찾기, (답의) 커밋 해시 → 복사. 제목 줄엔 개요가 찾아갈 표시 */
function richPost(b, m, i) {
  b.dataset.mi = i;
  const re = new RegExp(TREF_RE.source + '|' + TAG_RX.source + (m.bot ? '|' + HASH_RE.source : ''), 'g');
  const walk = n => {
    if (n.nodeType === 3) {
      const s = n.nodeValue; let at = 0, x, frag = null;
      re.lastIndex = 0;
      while ((x = re.exec(s))) {
        let node = null;
        if (x[1]) { const t = lastRooms.find(r => r.no === +x[1] && r.key !== room); if (t) { node = el('a', 'tref', x[0]); node.title = 'T' + t.no + ' ' + t.title; node.onclick = e => { e.stopPropagation(); openRoom(t.key); }; } }
        else if (x[2]) { if (!TAG_SKIP.has(x[2].toLowerCase())) { const g = x[2]; node = el('a', 'tagref', x[0]); node.onclick = e => { e.stopPropagation(); tagFind(g); }; } }
        else { const hv = x[0]; node = el('span', 'hash', hv.slice(0, 7)); node.title = hv + ' — 눌러서 복사'; node.onclick = e => { e.stopPropagation(); try { navigator.clipboard.writeText(hv); toast('커밋 ' + hv.slice(0, 7) + ' 복사했습니다'); } catch (err) {} }; }
        if (!node) continue;
        frag = frag || document.createDocumentFragment();
        frag.append(s.slice(at, x.index), node); at = x.index + x[0].length;
      }
      if (frag) { frag.append(s.slice(at)); n.replaceWith(frag); }
      return;
    }
    if (n.nodeType === 1 && (n.matches('button,a,pre,code,.ask') )) return;
    [...n.childNodes].forEach(walk);
  };
  walk(b);
}
function outlineOf(r) {                                  // 제목 줄이 셋 이상인 가장 최근 답
  for (let i = r.msgs.length - 1; i >= 0; i--) {
    const m = r.msgs[i]; if (!m.bot || !m.text) continue;
    const hs = m.text.split('\n').filter(l => HEAD_RE.test(l)).map(headText);
    if (hs.length >= 3) return { i, hs };
  }
  return null;
}
function outlineGo(i, h) {
  $('#infoDlg').close();
  const b = document.querySelector('#log .bubble[data-mi="' + i + '"]'); if (!b) return;
  const fold = b.querySelector('.mdbody.fold'), more = b.querySelector('button.more'); if (fold && more) more.click();
  const key = h.replace(/\s+/g, '').slice(0, 20);
  const t = [...b.querySelectorAll('.mdbody > div, .mdbody .h')].find(x => x.textContent.replace(/\s+/g, '').includes(key)) || b;
  t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.add('hl'); setTimeout(() => t.classList.remove('hl'), 1600);
}
function infoMore(box, r) {
  const tags = roomTags(r);
  if (tags.length) {
    box.append(el('div', 'sec', '태그'));
    const row = el('div', 'tagrow');
    for (const g of tags) { const c = el('button', 'chip', '#' + g); c.onclick = () => { $('#infoDlg').close(); tagFind(g); }; row.append(c); }
    box.append(row);
  }
  const link = x => { const li = el('li'), a = el('a', '', 'T' + x.no + ' ' + x.title); a.onclick = () => { $('#infoDlg').close(); openRoom(x.key); }; li.append(a, el('small', '', x.st || '')); return li; };
  const said = roomRefs(r).map(n => lastRooms.find(x => x.no === n)).filter(Boolean);
  if (said.length) { const ul = el('ul', 'lnk'); said.forEach(x => ul.append(link(x))); box.append(el('div', 'sec', '이 대화가 말한 대화'), ul); }
  const back = r.no ? lastRooms.filter(x => x.key !== r.key && roomRefs(x).includes(r.no)) : [];
  if (back.length) { const ul = el('ul', 'lnk'); back.forEach(x => ul.append(link(x))); box.append(el('div', 'sec', '이 대화를 언급한 대화'), ul); }
  const ol = outlineOf(r);
  if (ol) {
    box.append(el('div', 'sec', '답 개요 · ' + ol.hs.length));
    const o = el('ol', 'ol');
    ol.hs.forEach(hh => { const li = el('li'), a = el('a', '', hh); a.onclick = () => outlineGo(ol.i, hh); li.append(a); o.append(li); });
    box.append(o);
  }
  if (r.no) {
    const acts = el('div', 'acts'), ho = el('button', 'btn', '인계문으로 새 대화');
    ho.onclick = () => handoffSend(r); acts.append(ho);
    if (r.st === '완료') { const rv = el('button', 'btn', '검토 받기'); rv.onclick = () => reviewSend(r); acts.append(rv); }
    box.append(acts);
  }
}
/* P5·P11 — PC 메신저와 같은 문구로 읽기 전용 새 대화(같은 폴더) */
function clipText(s, n) { s = String(s || '').trim(); return s.length > n ? s.slice(0, n) + ' …' : s; }
function roomFiles(r) { const fl = [...r.msgs].reverse().find(m => m.bot && m.files); return fl ? fl.files.list.map(x => '- ' + x.replace(/ (작성|실패|\d+번)$/, '')).join('\n') : ''; }
function sendSide(r, text, what) {
  const f = roomFolder(r), [first, ...rest] = text.split('\n');
  const subject = TAG.read + (f ? ' @' + f : '') + ' ' + first.trim().slice(0, 90);
  if (openMail(subject, rest.join('\n').trim(), { kind: 'say', text, mode: 'read', thread: '', label: '읽기' + (f ? ' @' + f : '') })) { $('#infoDlg').close(); toast(what + ' — 새 대화로 보냈습니다'); }
}
function reviewSend(r) {
  const last = [...r.msgs].reverse().find(m => m.bot && m.text); if (!last || !r.no) return;
  if (!confirm('T' + r.no + ' 의 마지막 답과 바뀐 파일을 다른 세션에게 검토받을까요?\n(읽기 전용 새 대화로 보냅니다 — 파일은 고치지 않습니다)')) return;
  const files = roomFiles(r);
  sendSide(r, 'T' + r.no + ' 검토 — ' + r.title + '\n'
    + 'T' + r.no + ' 대화의 마지막 답과 바뀐 파일을 비판적으로 검토해 주세요. 문제 · 빠진 점 · 위험만 짧게 적고, 고치지는 말고 읽기만 하세요. 바뀐 파일은 직접 열어 확인하세요.\n\n'
    + '[마지막 답]\n' + clipText(last.text, 3000) + (files ? '\n\n[바뀐 파일]\n' + files : ''), '검토 받기');
}
function handoffSend(r) {
  if (!r.no) return;
  if (!confirm('T' + r.no + ' 대화를 인계문(목표·한 일·남은 일)으로 정리하는 새 대화를 시작할까요?\n(읽기 전용 — 파일은 고치지 않습니다)')) return;
  const lines = []; let n = 0;
  for (const m of [...r.msgs].reverse()) {
    const s = (m.bot ? 'Claude: ' : '나: ') + clipText(m.text || m.rest, 800);
    if (n + s.length > 6000) break; lines.unshift(s); n += s.length;
  }
  const files = roomFiles(r);
  sendSide(r, 'T' + r.no + ' 이어서 — ' + r.title + '\n'
    + 'T' + r.no + ' 대화를 다음 세션이 이어받을 인계문으로 정리해 주세요: 목표 · 한 일 · 바뀐 파일 · 남은 일 · 주의점. 고치지는 말고 정리만 하세요. 끝에 다음에 할 일을 고르기로 제안해 주세요.\n\n'
    + '[대화]\n' + lines.join('\n\n') + (files ? '\n\n[바뀐 파일]\n' + files : ''), '인계문');
}
/* P6 · ⑤ · ⑥ — 새 지시 칩 */
function askFirst(text) { return text && $('#askChip').classList.contains('on') ? text + '\n\n바로 고치지 말고 먼저 필요한 확인 질문만 하고 멈춰 주세요.' : text; }
function wtMark(s) { const i = s.indexOf('\n'); return i < 0 ? s + '\n[dnc:wt]' : s.slice(0, i) + '\n[dnc:wt]' + s.slice(i); }   // 완료 기준 줄은 맨 끝에 남게 둘째 줄에
$('#askChip').onclick = () => $('#askChip').classList.toggle('on');
for (const id of ['#wtChip', '#twoChip']) $(id).onclick = () => {
  const on = $(id).classList.toggle('on');
  if (on) { $(id === '#twoChip' ? '#wtChip' : '#twoChip').classList.remove('on'); setMode('write'); }
};
var twoNext = '';                                         // 두 번 해 보기 — 시도 A 를 보낸 뒤 입력칸에 채워 둘 시도 B
function chipPrep(text) {                                 // 보내기 직전: 먼저 질문 → 완료 기준 → (따로/두 번) 표식
  const two = $('#twoChip').classList.contains('on'), wt = two || $('#wtChip').classList.contains('on');
  let base = withCrit(askFirst(text));
  twoNext = '';
  if (two) {
    if (!confirm('같은 지시를 따로 두 번(시도 A · B) 돌려 비교합니다.\n\n· 비용이 두 배로 듭니다.\n· 시도 A 를 보낸 뒤 입력칸에 시도 B 가 채워지면 한 번 더 보내기를 누르세요.\n· 합치기는 PC 메신저 상세 패널에서 하나만 「이걸로 합치기」.')) return null;
    const tag = '#시도' + Math.random().toString(16).slice(2, 6), i = base.indexOf('\n'), title = i < 0 ? base : base.slice(0, i), rest = i < 0 ? '' : base.slice(i);
    twoNext = wtMark(title + ' · 시도 B ' + tag + rest);
    base = title + ' · 시도 A ' + tag + rest;
  }
  for (const c of ['#askChip', '#wtChip', '#twoChip']) $(c).classList.remove('on');
  return wt ? wtMark(base) : base;
}
function chipAfter() { if (!twoNext) return; const t = $('#sayText'); t.value = twoNext; twoNext = ''; setMode('write'); grow(t); refresh(); toast('시도 B 도 보내기를 누르세요'); }
/* O9 지시 템플릿 — 이 기기 저장(PC 메신저 템플릿과 같은 빈칸) */
var tpls = store.get('tpl', []);
function tplFill(body) {
  const d = new Date(), wk = '일월화수목금토'[d.getDay()];
  let s = body.replace(/\{\{날짜\}\}/g, d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()))
    .replace(/\{\{오늘\}\}/g, (d.getMonth() + 1) + '월 ' + d.getDate() + '일(' + wk + ')')
    .replace(/\{\{폴더\}\}/g, folder ? '@' + folder : '기본 폴더');
  const asks = [...new Set([...s.matchAll(/\{\{입력:([^}]{1,40})\}\}/g)].map(m => m[1]))];
  for (const q of asks) { const v = prompt(q); if (v === null) return null; s = s.split('{{입력:' + q + '}}').join(v); }
  return s;
}
function tplDraw() {
  const box = $('#tplList'); box.replaceChildren();
  if (!tpls.length) box.append(el('div', 'hint', '저장한 템플릿이 없습니다 — 지시를 쓰고 아래 단추로 저장하세요'));
  for (const x of tpls) {
    const row = el('div', 'tpl'), use = el('button', 'use'), del = el('button', 'btn', '지우기');
    use.append(el('b', '', x.title), el('small', '', x.body.slice(0, 80)));
    use.onclick = () => { const s = tplFill(x.body); if (s == null) return; const t = $('#sayText'); t.value = t.value.trim() ? t.value.replace(/\s+$/, '') + '\n' + s : s; grow(t); refresh(); $('#tplDlg').close(); t.focus(); };
    del.onclick = () => { if (!confirm('「' + x.title + '」 템플릿을 지울까요?')) return; tpls = tpls.filter(y => y !== x); store.set('tpl', tpls); tplDraw(); };
    row.append(use, del); box.append(row);
  }
}
$('#tplChip').onclick = () => { tplDraw(); $('#tplDlg').showModal(); };
$('#tplX').onclick = () => $('#tplDlg').close();
$('#tplSave').onclick = () => {
  const body = $('#sayText').value.trim(); if (!body) { toast('먼저 지시를 쓰세요'); return; }
  const title = prompt('템플릿 이름', body.split('\n')[0].slice(0, 30)); if (!title || !title.trim()) return;
  tpls = tpls.filter(x => x.title !== title.trim()).concat([{ title: title.trim(), body }]).slice(-40); store.set('tpl', tpls); tplDraw(); toast('템플릿으로 저장했습니다');
};
/* O10 그래프 — 대화(점) · T번호 관계(선) · 태그(◇). 원 둘레에 놓는 간단한 배치 */
function graphOpen() {
  const rooms = lastRooms.filter(r => r.no).slice(0, 40), NS = 'http://www.w3.org/2000/svg', W = 360, Hh = 360, cx = W / 2, cy = Hh / 2;
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
  const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const pos = {}, tags = {};
  rooms.forEach((r, i) => { const a = i / Math.max(1, rooms.length) * Math.PI * 2 - Math.PI / 2; pos[r.no] = [cx + Math.cos(a) * 140, cy + Math.sin(a) * 140]; for (const g of roomTags(r)) (tags[g] = tags[g] || []).push(r.no); });
  const tg = Object.keys(tags).filter(g => tags[g].length > 1).slice(0, 8);
  tg.forEach((g, i) => { const a = i / Math.max(1, tg.length) * Math.PI * 2; pos['#' + g] = [cx + Math.cos(a) * 55, cy + Math.sin(a) * 55]; });
  const line = (a, b, w, dash) => { if (pos[a] && pos[b]) svg.append(mk('line', { x1: pos[a][0], y1: pos[a][1], x2: pos[b][0], y2: pos[b][1], stroke: 'currentColor', 'stroke-width': w, 'stroke-dasharray': dash || '', opacity: dash ? .35 : .7 })); };
  for (const r of rooms) for (const n of roomRefs(r)) line(r.no, n, 1.6);
  for (const g of tg) for (const n of tags[g]) line('#' + g, n, 1, '3 3');
  for (const g of tg) { const [x, y] = pos['#' + g]; svg.append(mk('rect', { x: x - 5, y: y - 5, width: 10, height: 10, transform: 'rotate(45 ' + x + ' ' + y + ')', fill: 'none', stroke: 'currentColor' })); const t = mk('text', { x: x + 8, y: y + 3 }); t.textContent = '#' + g; svg.append(t); }
  for (const r of rooms) {
    const [x, y] = pos[r.no], gr = mk('g', { style: 'cursor:pointer' });
    gr.append(mk('circle', { cx: x, cy: y, r: 6, fill: isWait(r) ? 'var(--bad)' : isBusy(r) ? 'var(--accent)' : 'var(--muted)' }));
    const t = mk('text', { x: x + 8, y: y + 3 }); t.textContent = 'T' + r.no + ' ' + r.title.slice(0, 10); gr.append(t);
    gr.addEventListener('click', () => { $('#graphDlg').close(); openRoom(r.key); }); svg.append(gr);
  }
  $('#graphBox').replaceChildren(rooms.length ? svg : el('div', 'hint', '번호가 붙은 대화가 아직 없습니다'));
  $('#graphDlg').showModal();
}
$('#graphX').onclick = () => $('#graphDlg').close();

/* ---- 보낸 기록 ---- */
function draw() {
  const box = $('#log'); box.replaceChildren();
  if (gOn()) { drawGmail(box); return; }
  plainBar();
  if (!sent.length) {
    const e = el('div', 'empty');
    e.innerHTML = '<b>메일로 일을 맡기는 곳</b><br><br>아래에 할 일을 적고 보내면 메일 앱이 다 채워진 채 열립니다. <b>보내기</b>만 누르세요.<br><br><b>답은 이 화면이 아니라 메일 앱으로 옵니다</b>(이 페이지는 메일함을 읽지 못해요). 메일 안의 단추로 바로 답하거나, 여기 <b>답하기</b> 탭에서 체크박스로 고르세요.';
    box.append(e); return;
  }
  let lastDay = '';
  for (const s of sent) {
    const d = new Date(s.at), day = (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    if (day !== lastDay) { box.append(el('div', 'day', day)); lastDay = day; }
    const m = el('div', 'msg'), b = el('div', 'bubble', s.text), meta = el('div', 'meta');
    meta.append(el('span', 'tagchip' + (s.mode === 'write' ? ' w' : ''), s.label));
    meta.append(el('span', '', pad(d.getHours()) + ':' + pad(d.getMinutes())));
    const del = el('button', 'del', '지우기');                // 이 기기의 보낸 기록에서만 뺀다(PC·메일은 그대로)
    del.onclick = () => { sent = sent.filter(x => x !== s); store.set('sent', sent); draw(); };
    meta.append(del);
    if (s.kind === 'say') {
      const again = el('button', 'again', '다시 쓰기');
      again.onclick = () => { setTab('say'); $('#sayText').value = s.text; $('#sayThread').value = s.thread || ''; setMode(s.mode); grow($('#sayText')); refresh(); $('#sayText').focus(); };
      meta.append(again);
    }
    m.append(b, meta); box.append(m);
  }
  const hint = el('div', 'tail', '답은 메일 앱으로 옵니다');     // 메일 앱 모드는 보내기 전용 — 메일함을 읽지 못한다
  const go = el('a', '', '메일 앱 열기'); go.href = 'message://';  // iOS 메일 앱
  hint.append(go); box.append(hint);
  box.scrollTop = box.scrollHeight;
}

function plainBar() {                                 // 메일 앱 모드: 대화방 없이 처음 화면 그대로
  for (const id of ['#sayRow', '#ansRow', '#modeChips', '#logo']) $(id).style.display = '';
  $('#quick').style.display = 'none';
  $('#clipBtn').style.display = 'none'; attach = []; drawAttach();      // 메일 앱으로는 사진을 못 붙인다
  for (const b of document.querySelectorAll('.tabs button')) b.style.display = '';
  editing = false; $('#editBar').classList.remove('on'); $('.composer').style.display = '';
  $('#pinBtn').style.display = 'none'; $('#searchBar').classList.remove('on');
  $('#backBtn').style.display = $('#delBtn').style.display = 'none'; $('#ttl').textContent = 'D&C 메신저'; $('.tabs').style.display = '';
  document.querySelector('.tabs [data-pane=say]').textContent = '지시';
  $('#sayText').disabled = false; $('#sayText').placeholder = '할 일을 적으세요 (첫 줄이 제목)';
}

/* ---- 메일 앱 열기 ---- */
function openMail(subject, body, rec) {
  if (!cfg.mail) { openSettings(); toast('먼저 메일 주소를 넣어 주세요'); return false; }   // 입력은 지우지 않는다
  const enc = s => encodeURIComponent(s).replace(/%0A/g, '%0D%0A');
  // 새 지시(사진 없음)는 메일 앱(iCloud)으로 — 회사 스팸 장비가 Gmail(API) 새 지시만 붙잡는다(2026-10-08 측정).
  // 이어 말하기·답하기·멈춤(답장)과 사진 메일은 Gmail 로 바로 가도 걸리지 않았다.
  const viaApp = gOn() && !cfg.self && cfg.viaApp !== false && !(rec.thread > 0) && !(rec.files || []).length && rec.kind === 'say';
  if (viaApp) {
    gloc.push({ at: Date.now(), subj: subject, text: rec.text, mode: rec.mode });
    gloc = gloc.filter(x => Date.now() - x.at < 7 * 86400e3).slice(-100); store.set('gloc', gloc);
  }
  if (gOn() && !viaApp) {                                   // Gmail 로 바로 보낸다. 연결이 끊겼으면 다시 연결하고 돌아와서 보낸다
    // 암호 단어는 제목 대신 본문 마지막 줄로 — 제목의 알 수 없는 영숫자 조각이 회사 스팸 장비 의심을 사는 것 같아서(PC 가 떼어 낸다)
    if (cfg.key) body = (body ? body + '\n\n' : '') + '[k:' + cfg.key + ']';
    gout.push({ subject, body, files: rec.files || [], reply: rec.reply || gReplyTo(rec.thread), text: rec.text, mode: rec.mode, thread: rec.thread || null, room: rec.room || null, at: Date.now() });
    store.set('gout', gout); draw(); petCheer();
    if (gLive()) gPoll(); else if (gtok) gAuth(true); else gAuth(false);
    return true;
  }
  if (cfg.key) subject += ' [k:' + cfg.key + ']';          // 메일 앱(iCloud)은 제목 끝에 — 잘 통과하고, 메일 답장 단추도 이 모양이다
  const url ='mailto:' + encodeURIComponent(cfg.mail) + '?subject=' + enc(subject) + '&body=' + enc(body);
  (window.dispatchGo || (u => { location.href = u; }))(url);   // dispatchGo: 시험용 가로채기
  if (viaApp) { draw(); toast('메일 앱에서 보내기를 누르세요'); petCheer(); gPoll(); return true; }
  sent.push(Object.assign({ at: Date.now() }, rec)); sent = sent.slice(-200); store.set('sent', sent); draw();
  toast('메일 앱에서 보내기를 누르세요');
  petCheer();
  return true;
}

/* ---- 지시 ---- */
function setMode(m) { mode = m; for (const b of document.querySelectorAll('#modeChips [data-mode]')) b.classList.toggle('on', b.dataset.mode === m); }
function drawFolders() {
  const box = $('#folderChips'); box.replaceChildren();
  for (const f of [''].concat(cfg.folders || [])) {
    const b = el('button', 'chip' + (f === folder ? ' on' : ''), f ? '@' + f : '기본 폴더');
    b.onclick = () => { folder = f; drawFolders(); }; box.append(b);
  }
}
$('#saySend').onclick = () => {
  let text = $('#sayText').value.trim();
  const t = parseInt($('#sayThread').value, 10), files = attach.slice();
  if (!text && !files.length) return;
  if (!text) text = '사진 봐줘';                          // 사진만 보내면 이 말로
  if (!(t > 0)) { const pre = chipPrep(text); if (pre == null) return; text = pre; } else text = withCrit(text);
  const [first, ...rest] = text.split('\n');
  // '/jira 키' 줄이 든 새 지시는 수정 허용으로 — PC 는 쓰기 지시에서만 Jira 처리로 돌린다(옛 Jira 탭과 같게)
  const m = !(t > 0) && /^[ \t]*\/jira[ \t]+[A-Za-z][A-Za-z0-9]+-\d+/im.test(text) ? 'write' : mode;
  const head = [TAG[m]];
  if (t > 0) head.push('[T' + t + ']');
  else if (folder) head.push('@' + folder);             // 이어 쓰는 대화는 원래 폴더를 그대로 쓴다
  const subject = head.join(' ') + ' ' + first.trim().slice(0, 90);
  const body = (first.trim().length > 90 ? first.trim() + '\n' : '') + rest.join('\n').trim();
  if (!openMail(subject, body, { kind: 'say', text, mode: m, files, thread: t > 0 ? t : '', label: (t > 0 ? 'T' + t + ' · ' : '') + (m === 'write' ? '수정' : '읽기') + (folder && !(t > 0) ? ' @' + folder : '') })) return;
  $('#sayText').value = ''; $('#doneText').value = ''; grow($('#sayText')); attach = []; drawAttach(); refresh();
  chipAfter();
};

/* 오르카 결 3차 — 완료 기준(PC 메신저와 같은 규칙: 지시 끝 「완료 기준:」 + "- " 줄, 답 끝 ✅/❌ 줄) */
const CRIT_RE = /\n*완료 기준:\s*\n((?:[ \t]*[-·*][^\n]*(?:\n|$))+)\s*$/;
function critSplit(text) {
  const m = CRIT_RE.exec(text || ''); if (!m) return [text || '', []];
  return [text.slice(0, m.index), m[1].split('\n').map(x => x.replace(/^[ \t]*[-·*]\s*/, '').trim()).filter(Boolean)];
}
function critMarks(r, crit) {
  const last = [...r.msgs].reverse().find(m => m.bot && m.text), lines = last ? last.text.split('\n') : [];
  const norm = s => s.replace(/\s+/g, '').slice(0, 14);
  return crit.map(c => {
    const l = lines.find(x => /^\s*[✅❌✔✖☑☒]/.test(x) && norm(x.replace(/^\s*[✅❌✔✖☑☒]️?\s*/, '')).startsWith(norm(c)));
    if (!l) return { c, m: '' };
    return { c, m: /^\s*[✅✔☑]/.test(l) ? 'ok' : 'no', why: l.split(/\s+[—-]\s+/).slice(1).join(' — ') };
  });
}
function withCrit(text) {
  const lines = $('#doneBox').classList.contains('on') ? $('#doneText').value.split('\n').map(x => x.replace(/^[ \t]*[-·*]\s*/, '').trim()).filter(Boolean) : [];
  return lines.length ? text + '\n\n완료 기준:\n' + lines.map(x => '- ' + x).join('\n') : text;
}
$('#doneChip').onclick = () => { const on = $('#doneBox').classList.toggle('on'); $('#doneChip').classList.toggle('on', on); if (on) $('#doneText').focus(); };

/* ---- 사진 붙이기(Gmail 모드) — 폰에서 긴 변 1600px JPEG 로 줄여 지시 메일에 붙인다. PC 가 저장해 Claude 가 Read 로 본다 ---- */
let attach = [];                                         // [{ b64, url }]
const MAX_ATTACH = 5;
function shrink(file) {
  return new Promise((res, rej) => {
    const src = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(src);
      res({ b64: url.slice(url.indexOf(',') + 1), url });
    };
    img.onerror = () => { URL.revokeObjectURL(src); rej(new Error('사진을 읽지 못했습니다')); };
    img.src = src;
  });
}
function drawAttach() {
  const box = $('#attPrev');
  box.style.display = attach.length ? '' : 'none';
  box.replaceChildren(...attach.map((a, i) => {
    const t = el('div', 'thumb'), im = document.createElement('img'), x = el('button', '', '✕');
    im.src = a.url; im.alt = '붙인 사진 ' + (i + 1);
    x.onclick = () => { attach.splice(i, 1); drawAttach(); refresh(); };
    t.append(im, x); return t;
  }));
}
$('#clipBtn').onclick = () => {
  if (attach.length >= MAX_ATTACH) { toast('사진은 ' + MAX_ATTACH + '장까지 붙일 수 있어요'); return; }
  $('#clipIn').click();
};
$('#clipIn').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length > MAX_ATTACH - attach.length) toast('사진은 ' + MAX_ATTACH + '장까지 — 앞의 것만 붙였어요');
  for (const f of files.slice(0, MAX_ATTACH - attach.length)) {
    try { attach.push(await shrink(f)); } catch (err) { toast(err.message); }
  }
  drawAttach(); refresh();
};

/* ---- 답하기(체크박스) ---- */
function drawPicks() {
  const box = $('#picks'); box.replaceChildren();
  for (let i = 1; i <= pickN; i++) {
    const b = el('button', 'pick' + (picks.has(i) ? ' on' : ''));
    b.setAttribute('role', 'checkbox'); b.setAttribute('aria-checked', picks.has(i));
    const box2 = el('span', 'box', picks.has(i) ? '✓' : ''); b.append(box2, String(i));
    b.onclick = () => { picks.has(i) ? picks.delete(i) : picks.add(i); stop = false; $('#stopBtn').classList.remove('on'); drawPicks(); refresh(); };
    box.append(b);
  }
}
$('#stopBtn').onclick = () => { stop = !stop; if (stop) picks.clear(); $('#stopBtn').classList.toggle('on', stop); drawPicks(); refresh(); };
$('#ansSend').onclick = () => {
  const t = parseInt($('#ansThread').value, 10), extra = $('#ansText').value.trim();
  if (!(t > 0)) { toast('메일 제목의 [T번호] 를 넣어 주세요'); return; }
  const nums = [...picks].sort((a, b) => a - b).join(',');
  const body = stop ? '멈춤' : (nums + (nums && extra ? ' ' : '') + extra);
  if (!body) return;
  if (!openMail('Re: ' + TAG.read + ' [T' + t + '] 답', body, { kind: 'answer', thread: t, text: stop ? '멈춤' : (nums ? '☑ ' + nums.split(',').join(' ☑ ') : '') + (extra ? (nums ? '\n' : '') + extra : ''), mode: 'read', label: 'T' + t + ' · 답' })) return;
  picks.clear(); stop = false; pickN = 4; $('#stopBtn').classList.remove('on'); $('#ansText').value = ''; drawPicks(); refresh();
  if (gOn()) setTab('say');
};

/* ---- 공통 ---- */
function setTab(name) {
  if (!document.querySelector('.tabs [data-pane="' + name + '"]')) name = 'say';   // 없앤 탭(옛 Jira)이 기억돼 있으면

  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.pane === name);
  for (const p of document.querySelectorAll('.pane')) p.classList.toggle('on', p.id === name);
  store.set('tab', name);
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => setTab(b.dataset.pane);
for (const b of document.querySelectorAll('#modeChips [data-mode]')) b.onclick = () => setMode(b.dataset.mode);
function grow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }
function refresh() {
  $('#saySend').disabled = !$('#sayText').value.trim() && !attach.length;
  $('#ansSend').disabled = !(parseInt($('#ansThread').value, 10) > 0 && (picks.size || stop || $('#ansText').value.trim()));
}
for (const id of ['#sayText', '#ansText']) $(id).addEventListener('input', e => { grow(e.target); refresh(); });
for (const id of ['#ansThread', '#sayThread']) $(id).addEventListener('input', refresh);

function openSettings() {
  $('#setKey').value = cfg.key || ''; $('#setGcid').value = cfg.gcid || ''; $('#setViaApp').checked = cfg.viaApp !== false; $('#setSelf').checked = !!cfg.self;
  $('#gOff').style.display = gtok ? '' : 'none';
  $('#gHint').textContent = gtok && gtok.email ? gtok.email + ' 로 연결돼 있습니다.' : '넣고 저장하면 Google 로그인 화면이 열립니다. 그 Gmail 로 보내고, PC 의 답이 여기 말풍선으로 옵니다.';
  $('#clearSent').textContent = gOn() ? '대화 기록 비우기 (이 기기 화면에서만)' : '보낸 기록 모두 지우기 (이 기기에서만)';
  $('#setMail').value = cfg.mail || ''; $('#setFolders').value = (cfg.folders || []).join(', ');
  $('#dlg').showModal();
}
$('#setBtn').onclick = openSettings;
$('#dlg').addEventListener('close', () => {
  if ($('#dlg').returnValue !== 'ok') return;
  cfg = { mail: $('#setMail').value.trim(), folders: $('#setFolders').value.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean), key: $('#setKey').value.trim().replace(/[\s\[\]]/g, ''), gcid: $('#setGcid').value.trim(), viaApp: $('#setViaApp').checked, self: $('#setSelf').checked };
  store.set('cfg', cfg); applyCfg(); draw(); toast('저장했습니다');
  if (gOn() && cfg.mail) { if (gLive()) gPoll(); else gAuth(false); }   // 처음 넣었으면 바로 Google 로그인
});
const short = a => a.replace(/^(.{2}).*(@.*)$/, '$1…$2');
function applyCfg() {
  if (!(gOn() && room)) $('#who').textContent = !cfg.mail ? '설정에서 메일 주소를 넣어 주세요'
    : gOn() ? (gtok && gtok.email ? short(gtok.email) : 'Gmail') + (cfg.self ? ' · 나에게 보냄' : '') + ' · 실시간'
    : short(cfg.mail) + ' 로 보냅니다';
  if (!(cfg.folders || []).includes(folder)) folder = '';
  drawFolders();
}

/* ---- Gmail 로 주고받기 ----
   서버 없이 Google 로그인 화면을 거쳐 돌아올 때 주소 끝(#access_token=…)으로 1시간짜리 토큰을 받는다(이 기기에만).
   보내기는 Gmail API 로, 받기는 PC 메일 주소와 오간 메일을 몇 초마다 읽어 PC 대화 앱(chat.py)과 같은 규칙으로 말풍선을 만든다. */
const GSCOPE = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const GAPI = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const HOME = location.origin + location.pathname.replace(/index\.html$/, '');   // 구글에 등록한 리디렉션 주소와 같아야 한다
let gtok = store.get('gtok', null);            // { t, exp, email }
let gmsgs = store.get('gm', {});               // Gmail id → 대화 메시지(지시 메일이 아니면 { skip })
let gout = store.get('gout', []);
let gloc = store.get('gloc', []);              // 메일 앱(iCloud)으로 보낸 새 지시 — Gmail 에 없어서 이 기기에 기억해 둔다 { at, subj, text, mode }              // 아직 못 보낸 것 — 연결되면 보낸다
let gstate = '', gBusy = false, gTimer = 0, gHashErr = false;
const gOn = () => !!cfg.gcid;
const gLive = () => !!(gtok && gtok.t && gtok.exp > Date.now() + 30000);

function gAuth(silent) {
  if (!cfg.gcid) return;
  const st = Math.random().toString(36).slice(2);
  store.set('gst', st); store.set('glast', Date.now());
  const p = new URLSearchParams({ client_id: cfg.gcid, redirect_uri: HOME, response_type: 'token', scope: GSCOPE, include_granted_scopes: 'true', state: st });
  if (silent) p.set('prompt', 'none');                    // 이미 허락했으면 화면 없이 바로 돌아온다
  if (gtok && gtok.email) p.set('login_hint', gtok.email);
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}
function gTakeHash() {                                     // 로그인에서 돌아왔으면 토큰을 받아 두고 주소를 깨끗이
  if (!/(^#|&)(access_token|error)=/.test(location.hash)) return;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  if (h.get('state') !== store.get('gst', '')) return;
  store.set('gst', '');
  if (h.get('access_token')) {
    gtok = { t: h.get('access_token'), exp: Date.now() + (parseInt(h.get('expires_in'), 10) || 3600) * 1000, email: (gtok && gtok.email) || '' };
    store.set('gtok', gtok);
  } else { gstate = 'need'; gHashErr = true; }           // 조용한 재연결이 안 됐다 — 단추로 다시 로그인
}
async function gFetch(path, opt) {
  const o = Object.assign({}, opt);
  o.headers = Object.assign({ Authorization: 'Bearer ' + gtok.t }, o.headers);
  const r = await fetch(GAPI + path, o);
  if (r.status === 401) { gtok.exp = 0; store.set('gtok', gtok); throw new Error('auth'); }
  if (!r.ok) throw new Error('Gmail ' + r.status);
  return r.json();
}

/* 메일 해석 — tools/dispatch-chat/chat.py 의 parse_message 와 같은 규칙 */
const KEY_RE = /\s*\[k:[^\]\s]{1,64}\]\s*$/, THREAD_RE = /\[T(\d{1,6})\]/, RE_RE = /^\s*(re|fw|fwd|회신|답장)\s*[:：]\s*/i;
const SIG_RE = /^\s*(--\s*$|보낸 사람:|보낸사람:|From:|-----Original Message-----|(나의 |내 )?iPhone에서 보냄|Sent from my |Get Outlook for |\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\..*작성:\s*$|On .+ wrote:\s*$)/m;
const ASK_SPLIT = '─'.repeat(16);
const bin = s => Uint8Array.from(s, c => c.charCodeAt(0));
const b64u = s => bin(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
function txt(bytes, cs) { try { return new TextDecoder(cs || 'utf-8').decode(bytes); } catch (e) { return new TextDecoder().decode(bytes); } }
function mimeWords(s) {                                    // =?utf-8?b?…?= · =?utf-8?q?…?= 풀기
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (all, cs, enc, x) => {
    try {
      return txt(enc.toUpperCase() === 'B' ? bin(atob(x))
        : bin(x.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))), cs);
    } catch (e) { return all; }
  });
}
function gPlain(payload) {
  const parts = [], walk = p => { parts.push(p); (p.parts || []).forEach(walk); };
  walk(payload);
  const has = t => parts.find(p => p.mimeType === t && p.body && p.body.data && !/attachment/i.test(hval(p, 'content-disposition')));
  const p = has('text/plain') || has('text/html');
  if (!p) return '';
  const cs = (hval(p, 'content-type').match(/charset="?([^";\s]+)/i) || [])[1];
  const t = txt(b64u(p.body.data), cs);
  return p.mimeType === 'text/html' ? t.replace(/<[^>]+>/g, ' ') : t;
}
function hval(p, name) { const h = (p.headers || []).find(x => x.name.toLowerCase() === name); return h ? h.value : ''; }
function gParse(g) {
  const H = {}, AR = [];
  for (const h of g.payload.headers || []) {
    const k = h.name.toLowerCase();
    if (k === 'authentication-results') AR.push(String(h.value || '')); else H[k] = h.value;
  }
  const ts = +g.internalDate || Date.now();
  const subject = mimeWords(H.subject).replace(/\s+/g, ' ').trim();
  let clean = subject;
  for (let i = 0; i < 5; i++) { const n = clean.replace(RE_RE, ''); if (n === clean) break; clean = n; }
  clean = clean.trim().replace(KEY_RE, '');
  const tag = [TAG.write, TAG.read].find(t => clean === t || (clean.startsWith(t) && /\s/.test(clean[t.length])));   // 긴 태그 먼저
  if (!tag) return { skip: 1, ts };
  const body = gPlain(g.payload).replace(/\r/g, '').replace(/^[ \t]*\[k:[^\]\s]{1,64}\][ \t]*$/gm, '');   // 본문 끝 암호 단어 줄은 안 보인다
  let photos = 0;
  (function walk(p) { if (/^image\//.test(p.mimeType || '') && p.filename) photos++; (p.parts || []).forEach(walk); })(g.payload);
  const tm = clean.match(THREAD_RE), th = String(H['x-dispatch-thread'] || '').trim();
  const m = { id: (H['message-id'] || '').trim(), ts, mode: tag === TAG.write ? 'write' : 'read',
    thread: parseInt(/^\d+$/.test(th) ? th : (tm ? tm[1] : '0'), 10) || null,
    rest: clean.slice(tag.length).replace(THREAD_RE, '').trim(), bot: H['x-dispatch'] === 'bot' && gAuthOk(AR, H.from), photos,
    refs: ((H['in-reply-to'] || '') + ' ' + (H.references || '')).match(/<[^<>]+>/g) || [] };
  if (m.bot) {
    m.kind = H['x-dispatch-kind'] || 'reply'; m.status = H['x-dispatch-status'] || '';
    m.ack = m.kind === 'ack';                          // PC 가 받았다는 신호 — 말풍선으로는 안 보이고 내 말의 '1' 을 지운다
    m.prog = m.kind === 'progress';                    // 오래 걸리는 일의 중간 한 줄 — 말풍선·답이 아니라 '일하는 중' 아래 회색 줄
    let b = body.includes(ASK_SPLIT) ? body.slice(body.indexOf(ASK_SPLIT) + ASK_SPLIT.length) : body;   // 맨 위 ☐ 선택지 줄은 따로 받는다
    const i = b.lastIndexOf('\n--\n');
    m.text = (i >= 0 ? b.slice(0, i) : b).trim();
    const fm = i >= 0 ? /^바뀐 파일 (\d+)개: (.+)$/m.exec(b.slice(i + 4)) : null;   // 답장 꼬리의 바뀐 파일 줄
    m.files = fm ? { n: +fm[1], list: fm[2].trim().split(' · ') } : null;
    m.ask = null;
    if (H['x-dispatch-ask']) try { m.ask = JSON.parse(txt(bin(atob(mimeWords(H['x-dispatch-ask']).replace(/\s+/g, ''))))); } catch (e) {}
  } else {
    const cut = body.search(SIG_RE);
    const said = (cut >= 0 ? body.slice(0, cut) : body).split('\n').filter(l => !l.trimStart().startsWith('>')).join('\n').trim();
    // 첫 지시는 제목+본문이 지시문이고, 이어지는 말은 본문이 곧 말이다(비면 제목)
    m.text = (/^re:/i.test(subject) || tm) && said ? said : [m.rest, said].filter(Boolean).join('\n').trim();
  }
  return m;
}
// PC 회신(X-Dispatch: bot)이 진짜인가 — X-Dispatch 머리글은 누구나 달 수 있다(2026-10-19 보안 점검: From 을 회사 주소로 꾸민
// 메일로 가짜 질문을 띄워 진짜 PC 대화에 답을 보내게 할 수 있었다). 밖에서 온 메일엔 Gmail(mx.google.com)이 인증 결과를 꼭 붙이니
// 그것이 있으면 DMARC 통과나 From 도메인과 맞는 DKIM 통과만 믿는다. 인증 결과가 아예 없으면 PC 가 IMAP 으로 내 메일함에 직접
// 넣은 것(메일함 주인만 넣을 수 있다)이라 그대로 둔다.
function gAuthOk(ar, from) {
  const mine = ar.filter(v => /^\s*mx\.google\.com\s*;/i.test(v));
  if (!ar.length) return true;
  if (!mine.length) return false;
  const v = mine[0], dom = (String(from || '').match(/@([^>\s]+)/) || [])[1] || '';
  if (/\bdmarc=pass\b/i.test(v)) return true;
  // DMARC 를 안 갖춘 회사 메일 서버도 있다 — From 도메인과 맞는 DKIM 이나 SPF(smtp.mailfrom) 통과면 믿는다
  const same = d => !!dom && !!d && (d.toLowerCase() === dom.toLowerCase() || dom.toLowerCase().endsWith('.' + d.toLowerCase()));
  const dk = (v.match(/\bdkim=pass\b[^;]*?header\.(?:i|d)=@?([^\s;]+)/i) || [])[1] || '';
  const sp = (v.match(/\bspf=pass\b[^;]*?smtp\.mailfrom=(?:[^@\s;]*@)?([^\s;]+)/i) || [])[1] || '';
  return same(dk) || same(sp);
}
function gList() {                                         // 화면에 보일 메시지(시간순). 번호 없는 첫 지시는 그 지시에 답한 봇 메일로 번호를 찾는다
  const since = store.get('gsince', 0);
  const list = Object.values(gmsgs).filter(m => m && !m.skip && m.ts > since);
  // 메일 앱으로 보낸 지시: 같은 제목으로 온 PC 접수 신호·답(봇 메일)을 이 지시에 대한 것으로 이어 준다
  const norm = t => String(t || '').replace(/\s+/g, ' ').trim();
  for (const x of gloc) {
    if (x.at <= since) continue;
    const tag = x.subj.startsWith(TAG.write + ' ') ? TAG.write : TAG.read, rest = norm(x.subj.slice(tag.length));
    const loc = { id: 'loc:' + x.at, ts: x.at, mode: x.mode, rest, text: x.text, bot: false, local: true, thread: null, refs: [] };
    for (const m of list) if (m.bot && m.ts >= x.at - 60000 && norm(m.rest) === rest) {
      if (!m.refs.includes(loc.id)) m.refs = m.refs.concat(loc.id);
      if ((m.ack || m.prog) && !loc.real) loc.real = m.refs.find(r => !r.startsWith('loc:'));    // PC 가 받은 원래 메일 — 멈춤이 가리킬 곳
    }
    list.push(loc);
  }
  list.sort((a, b) => a.ts - b.ts);
  const byId = {}; for (const m of list) if (m.id) byId[m.id] = m;
  for (const m of list) if (m.thread) for (const r of m.refs) { const o = byId[r]; if (o && !o.thread) o.thread = m.thread; }
  // 번호 없이 답장으로 단 말(첫 답 전에 누른 ■ 멈춤 등)은 가리키는 메일의 방으로 — 안 그러면 새 방이 생긴다(2026-10-23)
  for (const m of list) if (!m.thread) for (const r of m.refs) {
    const o = byId[r]; if (!o || o === m) continue;
    if (o.thread) { m.thread = o.thread; delete m.root; break; }
    m.root = o.root || o.id;
  }
  for (const m of list) m.events = [];                // 메시지 객체는 남아 있으니 그릴 때마다 새로
  for (const m of list) if (m.ack || m.prog) for (const r of m.refs) if (byId[r]) {
    byId[r].got = true;
    byId[r].events.push({ ts: m.ts, k: m.ack ? 'ack' : 'progress', a: m.ack ? 'PC 가 받음' : '진행 중', b: m.prog ? (m.text || '').split('\n')[0] : '' });
    if (m.prog) byId[r].progLine = (m.text || '').split('\n')[0];   // 시간순이라 마지막 진행 줄이 남는다
  }
  return list.filter(m => !(m.bot && (m.ack || m.prog)));   // 진행 메일은 답이 아니다 — 완료·안 읽음·말풍선에 안 셈
}
function gWaiting(list) {                                  // 내가 보내고 아직 답이 없는 대화(30분 안) — 'PC 가 일하는 중'
  const last = {};
  for (const m of list) last[roomKey(m)] = m;
  return Object.values(last).filter(m => !m.bot && Date.now() - m.ts < 30 * 60000);
}
function gReplyTo(t) {                                     // 이어 말할 때 그 대화의 마지막 봇 메일에 답장으로 단다
  if (!(t > 0)) return '';
  const b = gList().filter(m => m.bot && m.thread === t && m.id);
  return b.length ? b[b.length - 1].id : '';
}
async function gGet(id) {
  try { gmsgs[id] = gParse(await gFetch('messages/' + id + '?format=full')); }
  catch (e) { if (e.message === 'auth') throw e; }
}
function gSave() {                                         // 기기 저장소가 넘치지 않게 최근 400통만
  const ids = Object.keys(gmsgs).sort((a, b) => (gmsgs[b] || {}).ts - (gmsgs[a] || {}).ts);
  for (const id of ids.slice(400)) delete gmsgs[id];
  store.set('gm', gmsgs);
}
const enc8 = s => new TextEncoder().encode(s);
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); }
function mimeHead(s) {                                     // 제목 → =?UTF-8?B?…?= 조각들(글자를 가르지 않게 45바이트씩)
  const out = []; let cur = '';
  for (const ch of s) { if (cur && enc8(cur + ch).length > 45) { out.push(cur); cur = ''; } cur += ch; }
  if (cur) out.push(cur);
  return out.map(x => '=?UTF-8?B?' + b64(enc8(x)) + '?=').join('\r\n ') || '""';
}
function rfcDate(d) {                                     // 'Thu, 08 Oct 2026 11:10:00 +0900' (이 기기 시간대)
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ', ' + pad(d.getDate()) + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getFullYear() + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + pad(a % 60);
}
// 'PC 가 내 Gmail 을 직접 읽음'이면 나에게 보낸다 — 회사 메일·스팸 장비를 거치지 않는다(PC mail-gateway.py cfg.gmail, 2026-10-08)
function gTo() { return cfg.self && gtok && gtok.email ? gtok.email : cfg.mail; }
async function gSend(o) {
  // Date 를 빼면 Gmail 서버(대개 미국)가 자기 시간대(-0700 등)로 채운다 — 한국 회사 메일이 스팸으로 의심하기 쉽다. 이 기기 시각으로 넣는다
  const head = ['To: ' + gTo(), 'Date: ' + rfcDate(new Date()), 'Subject: ' + mimeHead(o.subject), 'MIME-Version: 1.0'];
  if (o.reply) head.push('In-Reply-To: ' + o.reply, 'References: ' + o.reply);
  const wrap = x => (x.match(/.{1,76}/g) || []).join('\r\n');
  const text = ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(b64(enc8(o.body || '')))];
  let raw;
  if (!(o.files || []).length) raw = head.concat(text).join('\r\n') + '\r\n';
  else {                                                 // 사진 — PC 게이트웨이가 저장해 Claude 가 Read 로 연다
    const bd = 'dnc-' + Math.random().toString(36).slice(2);
    const parts = ['--' + bd].concat(text);
    o.files.forEach((f, i) => parts.push('--' + bd, 'Content-Type: image/jpeg; name="photo' + (i + 1) + '.jpg"',
      'Content-Disposition: attachment; filename="photo' + (i + 1) + '.jpg"', 'Content-Transfer-Encoding: base64', '', wrap(f.b64)));
    parts.push('--' + bd + '--');
    raw = head.concat('Content-Type: multipart/mixed; boundary="' + bd + '"', '').join('\r\n') + '\r\n' + parts.join('\r\n') + '\r\n';
  }
  const r = await gFetch('messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64(enc8(raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }) });
  if (r.id) await gGet(r.id);                              // 보낸 편지함에서 바로 가져와 말풍선으로
}
async function gPoll() {
  clearTimeout(gTimer);
  if (!gOn() || !cfg.mail || document.hidden) return;
  if (!gLive()) {
    // 토큰이 끊겼으면 조용히 다시 받아 온다(입력 중이면 글이 날아가지 않게 두고 띠만 띄운다)
    if (gtok && !gHashErr && !$('#sayText').value.trim() && !$('#ansText').value.trim() && Date.now() - store.get('glast', 0) > 120000) { gAuth(true); return; }
    gstate = 'need'; drawBanner(); return;
  }
  if (gBusy) return;
  gBusy = true;
  let changed = false;
  try {
    if (!gtok.email) { gtok.email = (await gFetch('profile')).emailAddress || ''; store.set('gtok', gtok); applyCfg(); }
    while (gout.length) {                                  // 못 보낸 것부터
      await gSend(gout[0]); gout.shift(); store.set('gout', gout); changed = true; toast('보냈습니다');
    }
    const q = '{from:' + cfg.mail + ' to:' + cfg.mail + '} newer_than:30d';
    const r = await gFetch('messages?maxResults=80&includeSpamTrash=true&q=' + encodeURIComponent(q));
    const mine = cfg.self ? await gFetch('messages?maxResults=80&q=' + encodeURIComponent('from:me to:me newer_than:30d')) : {};   // 나에게 보낸 지시
    const ids = [...new Set((r.messages || []).concat(mine.messages || []).map(x => x.id))].filter(id => !(id in gmsgs));
    for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(gGet));
    if (ids.length) changed = true;
    gstate = 'ok';
  } catch (e) {
    gstate = e.message === 'auth' ? 'need' : 'err';
  } finally {
    gBusy = false;
    if (changed) { gSave(); draw(); }
    drawBanner();
    if (gstate === 'need') setTimeout(gPoll, 0);         // 토큰이 막 끊겼으면 조용히 다시 받아 오기를 해 본다
    else gTimer = setTimeout(gPoll, gWaiting(gList()).length || gout.length ? 8000 : 30000);
  }
}
function drawBanner() {
  const bar = $('#gbar'), n = gout.length;
  const msg = !gOn() ? '' : gstate === 'need' ? 'Google 연결이 끊겼어요' + (n ? ' · 보낼 것 ' + n + '건 대기' : '')
    : gstate === 'err' ? 'Gmail 을 못 읽었어요 — 잠시 뒤 다시 해 봅니다' : '';
  bar.classList.toggle('on', !!msg); $('#gbarText').textContent = msg;
  $('#gbarBtn').style.display = gstate === 'need' ? '' : 'none';
}
$('#gbarBtn').onclick = () => gAuth(false);
$('#gOff').onclick = () => {
  if (!confirm('이 기기에서 Gmail 연결을 끊을까요? (클라이언트 ID 도 지웁니다)')) return;
  gtok = null; gmsgs = {}; gout = []; cfg.gcid = '';
  for (const k of ['gtok', 'gm', 'gout']) store.set(k, k === 'gtok' ? null : k === 'gm' ? {} : []);
  store.set('cfg', cfg); $('#dlg').close(); applyCfg(); draw(); drawBanner(); toast('끊었습니다');
};
/* PC 답을 보기 좋게 — Claude 답은 마크다운(표·목록·**굵게**·`코드`·```블록```)이다.
   글자는 먼저 전부 이스케이프하고 정해진 태그만 만든다(메일 내용을 HTML 로 그대로 넣지 않는다). */
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inl = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
function md(src) {
  const L = String(src || '').replace(/\r/g, '').split('\n'), out = [];
  const isRow = x => /^\s*\|.*\|\s*$/.test(x);
  for (let i = 0; i < L.length;) {
    const l = L[i];
    if (/^\s*```/.test(l)) {                            // 코드 블록
      const buf = []; i++;
      while (i < L.length && !/^\s*```/.test(L[i])) buf.push(L[i++]);
      i++; out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); continue;
    }
    if (isRow(l) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {   // 표
      const cells = x => x.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => inl(c.trim()));
      const head = cells(l), rows = []; i += 2;
      while (i < L.length && isRow(L[i])) rows.push(cells(L[i++]));
      out.push('<div class="tbl"><table><tr>' + head.map(c => '<th>' + c + '</th>').join('') + '</tr>' +
        rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table></div>');
      continue;
    }
    const h = l.match(/^#{1,4}\s+(.*)$/);
    if (h) { out.push('<div class="h">' + inl(h[1]) + '</div>'); i++; continue; }
    const li = l.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      out.push('<div class="li" style="padding-left:' + Math.min(li[1].length, 8) * 7 + 'px"><span class="bul">' +
        (/\d/.test(li[2]) ? esc(li[2]) : '•') + '</span><span>' + inl(li[3]) + '</span></div>');
      i++; continue;
    }
    out.push(l.trim() ? '<div>' + inl(l) + '</div>' : '<div class="sp"></div>'); i++;
  }
  return out.join('');
}
const opened = new Set();                              // '더 보기' 로 펼친 답(다시 그려도 펼친 채로)
function mdBubble(b, text, id) {                       // 봇 말풍선 — 길면 접고 '더 보기'
  b.classList.add('md');
  const body = el('div', 'mdbody'); body.innerHTML = md(text); b.append(body);
  if (text.length > 700 || text.split('\n').length > 16) {
    const f0 = !opened.has(id);
    body.classList.toggle('fold', f0);
    const more = el('button', 'more', f0 ? '더 보기 ▼' : '접기 ▲');
    more.onclick = () => {
      const f = body.classList.toggle('fold'); more.textContent = f ? '더 보기 ▼' : '접기 ▲';
      if (f) opened.delete(id); else opened.add(id);
    };
    b.append(more);
  }
}

/* 대화방 — 카톡처럼 대화 번호([T12])별 방 목록과 방 안 화면. 번호가 아직 없는 첫 지시는 'm:<Message-ID>' 방이고
   첫 답이 오면 번호 방으로 옮겨 간다. 보내는 중인 새 지시는 'o:<시각>' 방. */
let room = null;
let gseen = store.get('gseen', {});                    // 방마다 마지막으로 본 시각 — 안 읽은 답 표시
let gpin = store.get('gpin', {});                      // 고정한 방 → 고정한 시각(먼저 고정한 것이 위)
let query = '';                                        // 목록 검색어
let ghide = store.get('ghide', {});                    // 지운 방 → 지운 시각. 그 뒤에 온 말만 다시 보인다(Gmail·PC 는 그대로)
const roomKey = m => m.thread ? 'T' + m.thread : 'm:' + (m.root || m.id || m.ts);
function gRooms(list) {
  const rooms = {}, get = (k, no) => rooms[k] || (rooms[k] = { key: k, no: no || null, msgs: [], out: [] });
  for (const m of list) { const k = roomKey(m); if (m.ts > (ghide[k] || 0)) get(k, m.thread).msgs.push(m); }
  for (const o of gout) get(o.thread ? 'T' + o.thread : o.room || 'o:' + o.at, o.thread).out.push(o);   // room: 번호 전 방에서 보낸 멈춤
  const waiting = new Set(gWaiting(list).map(roomKey));
  const got = new Set(gWaiting(list).filter(m => m.got).map(roomKey));
  for (const r of Object.values(rooms)) {
    const first = r.msgs.find(m => !m.bot) || r.out[0], last = r.msgs[r.msgs.length - 1];
    r.title = (((first && (first.text || first.rest)) || '').split('\n')[0].replace(/^@\S+\s+/, '')
      .replace(/^\[Jira 자동화\]\s*/, 'Jira · ').slice(0, 60)) || (r.no ? '대화 T' + r.no : '(제목 없음)');
    r.mode = r.msgs.some(m => m.mode === 'write') || r.out.some(o => o.mode === 'write') ? 'write' : 'read';
    r.ts = Math.max(last ? last.ts : 0, ...r.out.map(o => o.at));
    r.last = r.out.length ? r.out[r.out.length - 1].text : last ? (last.text || last.rest || '') : '';
    r.st = r.out.length ? '보내는 중' : got.has(r.key) ? '일하는 중' : waiting.has(r.key) ? '전송됨' : !last || !last.bot ? ''
      : last.kind === 'confirm' ? '실행 확인' : last.status === 'error' ? '오류' : last.ask ? '질문' : '완료';
    r.ask = last && last.bot && last.ask ? last : null;
    r.prog = r.st === '일하는 중' && last && !last.bot ? last.progLine || '' : '';   // 최종 답이 오면(마지막 말이 봇) 사라진다
    r.unread = !!(last && last.bot && last.ts > (gseen[r.key] || 0));
  }
  return Object.values(rooms).sort((a, b) => {
    const pa = gpin[a.key], pb = gpin[b.key];
    if (pa || pb) return !pa ? 1 : !pb ? -1 : pa - pb;
    return b.ts - a.ts;
  });
}
function gFollow(key, list) {                          // 방 번호가 바뀌었으면(첫 답이 와서 번호가 붙음 · 보내는 중이던 것이 실제 메일로) 따라간다
  if (key.startsWith('m:')) { const m = list.find(x => x.id === key.slice(2)); if (m && m.thread) return 'T' + m.thread; }
  if (key.startsWith('o:')) { const at = +key.slice(2), m = list.find(x => !x.bot && x.ts >= at - 120000); if (m) return roomKey(m); }
  return null;
}
function openRoom(key) {
  room = key; picks.clear(); stop = false; pickN = 4;
  try { history.pushState({ room: key }, ''); } catch (e) {}
  setTab('say'); $('#sayText').value = ''; draw();
  const lg = $('#log'); lg.classList.remove('slide'); void lg.offsetWidth; lg.classList.add('slide');   // 책등 쪽에서 밀려 들어온다
}
function closeRoom() {
  if (history.state && history.state.room) history.back();       // 아이폰 쓸어 넘기기와 같은 길로
  else { room = null; draw(); }
}
addEventListener('popstate', e => { room = (e.state && e.state.room) || null; draw(); });
$('#backBtn').onclick = closeRoom;
let editing = false;
const picked = new Set();                              // 편집 중 고른 방 키
$('#delBtn').onclick = () => {
  if (!room) { editing = !editing; picked.clear(); draw(); return; }
  if (!confirm('이 대화를 이 기기 화면에서 지울까요?\n(Gmail·PC 의 메일은 그대로이고, 새 답이 오면 그 뒤부터 다시 보입니다)')) return;
  ghide[room] = Date.now(); store.set('ghide', ghide);
  closeRoom(); toast('지웠습니다');
};
$('#pinBtn').onclick = () => {
  if (!room) return;
  if (gpin[room]) delete gpin[room]; else gpin[room] = Date.now();
  store.set('gpin', gpin); toast(gpin[room] ? '목록 맨 위에 고정했습니다' : '고정을 풀었습니다'); draw();
};
$('#q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); draw(); });
$('#selAll').onclick = () => {
  const keys = [...document.querySelectorAll('#log .room')].map(n => n.dataset.key);
  if (keys.every(k => picked.has(k))) picked.clear(); else keys.forEach(k => picked.add(k));
  draw();
};
$('#selDel').onclick = () => {
  if (!picked.size || !confirm('고른 대화 ' + picked.size + '개를 이 기기 화면에서 지울까요?\n(Gmail·PC 의 메일은 그대로이고, 새 답이 오면 그 뒤부터 다시 보입니다)')) return;
  const now = Date.now();
  for (const k of picked) ghide[k] = now;
  store.set('ghide', ghide);
  toast(picked.size + '개 지웠습니다');
  editing = false; picked.clear(); draw();
};
const when = ts => {
  const d = new Date(ts), n = new Date();
  return d.toDateString() === n.toDateString() ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : (d.getMonth() + 1) + '/' + d.getDate();
};
function roomBar(r) {                                  // 머리줄 · 입력부를 지금 화면(목록/방)에 맞춘다
  const inRoom = !!r, tab = name => document.querySelector('.tabs [data-pane=' + name + ']');
  if (inRoom) editing = false;
  $('#backBtn').style.display = inRoom ? '' : 'none';
  $('#delBtn').textContent = inRoom ? '지우기' : editing ? '완료' : '편집';
  $('#pinBtn').style.display = inRoom ? '' : 'none';
  curRoom = r || null; document.querySelector('header .ttl').classList.toggle('tap', inRoom);
  if (inRoom && $('#infoDlg').open && infoRoom && infoRoom.key === r.key) openInfo(r);
  if (inRoom) $('#pinBtn').textContent = gpin[r.key] ? '고정 해제' : '고정';
  $('#delBtn').style.display = inRoom ? '' : 'none';             // 목록에선 방이 있을 때 drawRooms 가 켠다
  $('.composer').style.display = editing ? 'none' : '';
  $('#editBar').classList.toggle('on', editing);
  $('#logo').style.display = inRoom ? 'none' : '';
  $('#ttl').textContent = inRoom ? r.title : 'D&C 메신저';
  if (inRoom) $('#who').textContent = (r.no ? 'T' + r.no + ' · ' : '') + (r.mode === 'write' ? '수정 허용' : '읽기') + (r.st ? ' · ' + r.st : '');
  else applyCfg();
  $('#sayRow').style.display = $('#ansRow').style.display = 'none';     // 대화 번호는 방이 정한다
  $('#modeChips').style.display = inRoom ? 'none' : '';              // 이어 말하면 권한·폴더는 처음 그대로
  tab('answer').style.display = inRoom && r.ask ? '' : 'none';
  tab('say').textContent = inRoom ? '말하기' : '새 지시';
  $('.tabs').style.display = inRoom && !r.ask ? 'none' : '';      // 방 안에 질문이 없으면 탭이 하나뿐 — 줄을 숨긴다
  $('#sayThread').value = inRoom && r.no ? r.no : '';
  if (inRoom && r.no) $('#ansThread').value = r.no;
  const wait = inRoom && !r.no;                        // 번호가 붙기 전엔 이어 말할 수 없다
  $('#clipBtn').style.display = wait ? 'none' : '';
  $('#sayText').disabled = wait;
  $('#sayText').placeholder = wait ? '첫 답이 오면 이어서 말할 수 있어요' : inRoom ? '이어서 말하기' : '새로 맡길 일 (첫 줄이 제목 · Jira 는 /jira 키)';
  const on = document.querySelector('.tabs button.on');
  if (!on || on.style.display === 'none') setTab('say');
  refresh();
}
function roomStop(r) {                                 // PC 가 하던 일을 끊는다(워커가 2초 안에 멈추고 '멈췄습니다' 회신)
  const mine = r.msgs.filter(m => !m.bot && m.id && (!m.local || m.real)).map(m => m.local ? Object.assign({}, m, { id: m.real }) : m);
  if (!mine.length) { toast('PC 가 받은 뒤에 멈출 수 있어요'); return; }
  if (!mine.length || !confirm('PC 가 하던 일을 지금 멈출까요?')) return;
  openMail('Re: ' + TAG.read + (r.no ? ' [T' + r.no + ']' : '') + ' 멈춤', '멈춤',
    { kind: 'stop', text: '멈춤', mode: r.mode, thread: r.no || '', room: r.key, reply: mine[mine.length - 1].id });
}
const QUICK = ['계속해', '요약만 해줘', '자세히 설명해줘', '고마워'];   // 방 안 빠른 답 — 누르면 입력칸에 채운다(보내기는 직접)
function drawQuick(r) {
  const box = $('#quick'), on = !!(r && r.no && !r.out.length && r.st !== '일하는 중' && r.st !== '전송됨');
  box.style.display = on ? '' : 'none';
  if (!on) return;
  box.replaceChildren(...QUICK.map(q => {
    const b = el('button', 'chip', q);
    b.onclick = () => { const t = $('#sayText'); t.value = q; grow(t); refresh(); t.focus(); };
    return b;
  }));
}
function drawGmail(box) {
  const list = gList(), rooms = gRooms(list); lastRooms = rooms;
  if (room && !rooms.some(r => r.key === room)) {
    room = gFollow(room, list);
    try { history.replaceState(room ? { room } : null, ''); } catch (e) {}
  }
  const r = room && rooms.find(x => x.key === room);
  roomBar(r); drawQuick(r);
  if (r) { $('#searchBar').classList.remove('on'); $('#sumBar').classList.remove('on'); drawRoom(box, r); } else drawRooms(box, rooms);
  try { petDraw(); } catch (e) {}                         // 처음 그릴 땐 펫 코드가 아직 준비 전이다
}
function drawRooms(box, rooms) {
  drawSum(rooms);
  if (sumF) rooms = rooms.filter(sumF === 'wait' ? isWait : isBusy);
  $('#searchBar').classList.toggle('on', rooms.length > 4 || !!query);   // 방이 몇 개 넘으면 검색칸
  if (query) {
    rooms = rooms.filter(r => findRoom(r, query));
    if (!rooms.length) { box.append(el('div', 'empty', '「' + $('#q').value.trim() + '」 이(가) 들어간 대화가 없습니다')); return; }
  }
  if (!rooms.length) {
    const e = el('div', 'empty');
    e.innerHTML = '<b>Gmail 로 주고받습니다</b><br><br>아래에 할 일을 적고 보내면 PC 가 받아 일하고, 대화마다 <b>방</b>이 생겨 답이 말풍선으로 옵니다.<br><br>선택지가 오면 방 안 말풍선의 단추를 누르고 보내기만 누르세요.';
    box.append(e); return;
  }
  if (grpOn()) rooms = grpSort(rooms);
  let gPrev = null;
  for (const r of rooms) {
    if (grpOn()) { const g = grpOf(r); if (g !== gPrev) { box.append(grpHead(g, rooms)); gPrev = g; } if (grpShut[g]) continue; }
    const row = el('button', 'room'), body = el('div', 'rbody'), top = el('div', 'rtop'), bot = el('div', 'rbot');
    top.append(el('span', 'rtitle', r.title));
    if (gpin[r.key]) top.append(el('span', 'pin', '📌'));
    top.append(el('span', 'rtime', when(r.ts)));
    const firstLine = r.prog || (r.last || '').split('\n').map(x => x.replace(/^\s*(#+|[-*•]|\|)\s*/, '').replace(/\*\*|`/g, '').trim()).find(Boolean) || '';
    bot.append(el('span', 'rlast', firstLine));          // 미리보기는 마크다운 기호를 뗀 첫 줄
    if (r.st) bot.append(el('span', 'rst' + ({ '질문': ' ask', '실행 확인': ' ask', '오류': ' err', '일하는 중': ' busy', '보내는 중': ' busy', '전송됨': '' }[r.st] || ''), r.st));
    if (r.unread) bot.append(el('span', 'dot'));
    body.append(top, bot);
    const tgs = roomTags(r);
    if (tgs.length) { const tr = el('div', 'rtags'); for (const g of tgs) { const c = el('span', 'tg', '#' + g); c.onclick = e => { if (editing) return; e.stopPropagation(); tagFind(g); }; tr.append(c); } body.append(tr); }
    row.dataset.key = r.key;
    if (editing) {
      row.classList.toggle('sel', picked.has(r.key));
      row.append(el('span', 'chk', picked.has(r.key) ? '✓' : ''));
    }
    row.append(el('span', 'tagchip' + (r.mode === 'write' ? ' w' : ''), r.no ? 'T' + r.no : '새'), body);
    row.onclick = () => {
      if (!editing) return openRoom(r.key);
      picked.has(r.key) ? picked.delete(r.key) : picked.add(r.key); draw();
    };
    box.append(row);
  }
  $('#delBtn').style.display = '';
  if (editing) {
    $('#selDel').disabled = !picked.size;
    $('#selDel').textContent = picked.size ? picked.size + '개 지우기' : '지우기';
    $('#selAll').textContent = rooms.every(r => picked.has(r.key)) ? '모두 해제' : '모두 선택';
  }
  box.scrollTop = 0;
}
function drawRoom(box, r) {
  const ansT = parseInt($('#ansThread').value, 10);
  let lastDay = '';
  const add = (ts, node) => {
    const d = new Date(ts), day = (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    if (day !== lastDay) { box.append(el('div', 'day', day)); lastDay = day; }
    box.append(node);
  };
  const hm = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  r.msgs.forEach((m, i) => {
    const pv = r.msgs[i - 1];
    if (m.bot && pv && !pv.bot && m.ts - pv.ts >= 5000) add(m.ts, el('div', 'worked', '↳ ' + dur(m.ts - pv.ts) + ' 만에 답'));
    const w = el('div', 'msg' + (m.bot ? ' bot' : '')), b = el('div', 'bubble' + (m.bot ? ' bot' : ''));
    if (m.bot) mdBubble(b, m.text || '(빈 회신)', m.id || m.ts);
    else b.textContent = (m.text || m.rest || '(빈 메일)') + (m.photos ? '\n📷 사진 ' + m.photos + '장' : '');
    const meta = el('div', 'meta');
    const st = !m.bot ? '' : m.kind === 'confirm' ? '실행 확인' : m.status === 'error' ? '오류' : m.ask ? '질문' : '';
    if (st) meta.append(el('span', 'tagchip' + (m.mode === 'write' ? ' w' : ''), st));
    if (r.st === '전송됨' && m === r.msgs[r.msgs.length - 1]) meta.append(el('span', 'unread', '1'));   // 카톡 읽음 표시 — PC 가 받으면 사라진다
    meta.append(el('span', '', hm(m.ts)));
    if (r.ask === m && Array.isArray(m.ask.options)) {   // 아직 답하지 않은 질문 — 단추로 고른다(모양이 틀린 질문은 안 그린다)
      const a = { question: String(m.ask.question || ''), multi: !!m.ask.multi, options: m.ask.options.slice(0, 9).map(String) }, ask = el('div', 'ask');
      ask.append(el('div', 'q', '❓ ' + a.question + (a.multi ? ' (여러 개)' : '')));
      a.options.forEach((o, i) => {
        const n = i + 1, rm = /\s*[(（]추천[)）]\s*$/.exec(o), c = el('button', 'opt' + (rm ? ' recd' : '') + (ansT === m.thread && picks.has(n) ? ' on' : ''), n + '. ' + (rm ? o.slice(0, rm.index) : o));
        if (rm) c.append(el('span', 'rec', '추천'));
        c.onclick = () => {
          if (parseInt($('#ansThread').value, 10) !== m.thread) { picks.clear(); $('#ansThread').value = m.thread; }
          if (a.multi && picks.has(n)) picks.delete(n); else { if (!a.multi) picks.clear(); picks.add(n); }
          stop = false; $('#stopBtn').classList.remove('on'); pickN = Math.min(9, Math.max(a.options.length, 1));
          setTab('answer'); drawPicks(); refresh(); draw();
        };
        ask.append(c);
      });
      b.append(ask);
    }
    richPost(b, m, i);
    w.append(b, meta); add(m.ts, w);
  });
  for (const o of r.out) {                             // 아직 못 보낸 것
    const w = el('div', 'msg');
    w.append(el('div', 'bubble wait', o.text + ((o.files || []).length ? '\n📷 사진 ' + o.files.length + '장' : '')), el('div', 'meta', '보내는 중…'));
    add(o.at, w);
  }
  if (r.st === '일하는 중' || r.st === '전송됨') {
    const w = el('div', 'msg bot'), row = el('div', 'typingrow');
    const lm = r.msgs[r.msgs.length - 1], since = lm && !lm.bot ? ' · ' + dur(Date.now() - lm.ts) + '째' : '';
    if (r.st === '일하는 중') row.append(el('div', 'bubble bot typing', '🐱 PC 가 일하는 중…' + since));
    const stopB = el('button', 'stopbtn', '■ 멈춤');
    stopB.onclick = () => roomStop(r);
    row.append(stopB); w.append(row); box.append(w);
    if (r.prog) box.append(el('div', 'tail', r.prog));   // 진행 메일 — 말풍선이 아닌 작은 회색 상태 줄
  }
  if (r.st === '전송됨' && Date.now() - r.ts > 3 * 60000)   // 보통 1분 안에 받는다 — 오래 못 받으면 회사 메일 스팸 격리가 흔한 원인
    box.append(el('div', 'tail warn', r.msgs.length && r.msgs[r.msgs.length - 1].local
      ? 'PC 가 아직 못 받았어요 — 메일 앱에서 「보내기」를 눌렀는지 확인해 보세요'
      : 'PC 가 아직 못 받았어요 — 회사 메일 스팸함에 걸렸는지 확인해 보세요'));
  gseen[r.key] = r.ts; store.set('gseen', gseen);
  box.scrollTop = box.scrollHeight;
}

/* ---- 오르카 결(11-25) — 요약줄 · 걸린 시간 · 상세 시트 ---- */
var sumF = '';                                          // '' | 'wait' | 'busy' — 목록 요약줄로 고른 것
function dur(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return sec + '초';
  const m = Math.floor(sec / 60); if (m < 60) return m + '분';
  const hh = Math.floor(m / 60); return hh + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
}
function isWait(r) { return r.st === '질문' || r.st === '실행 확인'; }
function isBusy(r) { return ['일하는 중', '전송됨', '보내는 중'].includes(r.st); }
function drawSum(rooms) {
  const bar = $('#sumBar'), w = rooms.filter(isWait).length, b = rooms.filter(isBusy).length;
  bar.classList.toggle('on', !room && !editing && (w + b > 0 || !!sumF || rooms.length > 1));
  bar.replaceChildren();
  const mk = (f, label, n, cls) => { const x = el('button', cls + (sumF === f ? ' on' : '')); x.append(document.createTextNode(label + ' '), el('b', '', String(n))); x.onclick = () => { sumF = sumF === f ? '' : f; draw(); }; return x; };
  bar.append(mk('wait', '답할 것', w, 'wait'), mk('busy', '진행 중', b, 'busy'));
  const gb = el('button', grpOn() ? 'on' : '', '묶음'); gb.title = '상태별로 묶어 보기(답할 것 · 작업 중 · 대기 · 오류 · 완료)'; gb.onclick = () => { store.set('grpOn', !grpOn()); draw(); };
  const gr = el('button', '', '그래프'); gr.title = '대화끼리 이어진 모양'; gr.onclick = graphOpen;
  bar.append(gb, gr);
}
function roomEvents(r) {
  const ev = []; let prevAsk = false;
  r.msgs.forEach((m, i) => {
    if (!m.bot) {
      const first = !r.msgs.slice(0, i).some(x => !x.bot);
      ev.push({ ts: m.ts, k: 'me', a: first ? '지시 보냄' : prevAsk ? '내가 답함' : '이어서 말함', b: (m.text || m.rest || '').split('\n')[0] });
      for (const e of m.events || []) ev.push(e);
      prevAsk = false;
    } else {
      const k = m.kind === 'confirm' ? 'confirm' : m.status === 'error' ? 'error' : m.ask ? 'ask' : 'done';
      ev.push({ ts: m.ts, k, a: { confirm: '실행 확인을 물음', error: '오류로 끝남', ask: '질문함', done: '답이 옴' }[k], b: k === 'ask' ? String((m.ask && m.ask.question) || '') : (m.text || '').split('\n')[0] });
      prevAsk = k === 'ask' || k === 'confirm';
    }
  });
  return ev.sort((a, b) => a.ts - b.ts);
}
var infoRoom = null;
function openInfo(r) {
  infoRoom = r; const box = $('#infoBody'); box.replaceChildren();
  const hmd = ts => { const d = new Date(ts), n = new Date(); return (d.toDateString() === n.toDateString() ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  box.append(el('h3', '', (r.no ? 'T' + r.no + ' ' : '') + r.title));
  if (r.st) box.append(el('span', 'rst' + (isWait(r) ? ' ask' : r.st === '오류' ? ' err' : isBusy(r) ? ' busy' : ''), r.st));
  if (isWait(r)) box.append(el('div', 'needs', r.st === '실행 확인' ? '● 실행 확인을 기다려요' : '● 내 답을 기다려요'));
  const first = r.msgs.find(m => !m.bot);
  if (first && (first.text || first.rest)) {
    const [body, crit] = critSplit(first.text || first.rest);
    box.append(el('div', 'sec', '맡긴 일')); box.append(el('p', 'task', body));
    if (crit.length) {
      const ms = critMarks(r, crit), ul = el('ul', 'crit');
      box.append(el('div', 'sec', '완료 기준 · ' + (ms.some(x => x.m) ? ms.filter(x => x.m === 'ok').length + '/' + crit.length : '점검 전')));
      for (const x of ms) { const li = el('li'), tx = el('div', '', x.c); if (x.why) tx.append(el('small', '', x.why)); li.append(el('span', 'm ' + x.m, x.m === 'ok' ? '✓' : x.m === 'no' ? '✕' : '☐'), tx); ul.append(li); }
      box.append(ul);
    }
  }
  infoMore(box, r);
  box.append(el('div', 'sec', '정보'));
  const dl = el('dl'), add = (k, v) => { if (v) dl.append(el('dt', '', k), el('dd', '', v)); };
  add('번호', r.no ? 'T' + r.no : '대기'); add('권한', r.mode === 'write' ? '수정 허용' : '읽기');
  const fm = first && /^@(\S+)/.exec(first.text || ''); add('폴더', fm ? '@' + fm[1] : '');
  if (r.msgs.length) {
    const t0 = r.msgs[0].ts, t1 = r.msgs[r.msgs.length - 1].ts;
    add('시작', hmd(t0)); add(isBusy(r) ? '지난 시간' : '걸린 시간', dur((isBusy(r) ? Date.now() : t1) - t0));
  }
  const fl = [...r.msgs].reverse().find(m => m.bot && m.files);
  if (fl) {
    box.append(dl, el('div', 'sec', '바뀐 파일 · ' + fl.files.n + '개'));
    const ul = el('ul', 'files');
    for (const x of fl.files.list) { const k = / (작성|실패|\d+번)$/.exec(x), li = el('li'); li.append(el('span', 'fn', k ? x.slice(0, k.index) : x)); if (k) li.append(el('span', 'fx' + (k[1] === '실패' ? ' bad' : ''), k[1])); ul.append(li); }
    box.append(ul, el('div', 'sec', '활동'));
  } else box.append(dl, el('div', 'sec', '활동'));
  const ol = el('ol');
  for (const e of roomEvents(r)) { const li = el('li', 'k-' + e.k), tx = el('div'); tx.append(document.createTextNode(e.a)); if (e.b) tx.append(el('small', '', e.b)); li.append(el('i'), tx, el('time', '', hmd(e.ts))); ol.append(li); }
  box.append(ol);
  if (!$('#infoDlg').open) $('#infoDlg').showModal();
}
document.querySelector('header .ttl').addEventListener('click', () => { if (curRoom) openInfo(curRoom); });   // 방 제목을 누르면 상세(메신저 앱처럼)
$('#infoX').onclick = () => $('#infoDlg').close();
$('#infoDlg').addEventListener('click', e => { if (e.target === $('#infoDlg')) $('#infoDlg').close(); });
var curRoom = null;

gTakeHash();
document.addEventListener('visibilitychange', () => { if (!document.hidden) gPoll(); });

applyCfg(); drawPicks(); draw(); refresh(); setTab(store.get('tab', 'say'));
if (gOn()) gPoll();
if (!cfg.mail) setTimeout(openSettings, 300);

/* ---- 인형 강아지·고양이 ---- */
const PET_PICK = 'dnc-pet-breed', PET_OFF = 'dnc-pet-off', PET_SKIN_PICK = 'dnc-pet-skin';
const PET_SKIN_NAMES = { plush: '인형', toon: '만화' };          // 모습 — pet/skin/<id> (만화는 직접 만든 그림만 골라 넣었다)
function petSkinPick() { try { const s = localStorage.getItem(PET_SKIN_PICK); return PET_SKIN_NAMES[s] ? s : 'plush'; } catch (e) { return 'plush'; } }
function petHidden() { try { return localStorage.getItem(PET_OFF) === '1'; } catch (e) { return false; } }
$('#petShow').checked = !petHidden();
$('#petShow').addEventListener('change', e => {
  try { localStorage.setItem(PET_OFF, e.target.checked ? '0' : '1'); } catch (err) {}
  $('#petStage').classList.toggle('off', !e.target.checked || !petSkin);
});
let petSkin = null, petting = null, petTimer = 0;
const petFlash = { bark: 0, happy: 0 };
function petPick() { try { return JSON.parse(localStorage.getItem(PET_PICK) || '{}'); } catch (e) { return {}; } }
async function petLoad() {
  if (!window.PetSkin || !window.fetch) return;
  PetSkin.BASE = 'pet/';
  const skin = petSkinPick();
  const m = await PetSkin.load(skin, petPick()) || (skin !== 'plush' ? await PetSkin.load('plush', petPick()) : null);   // 만화를 못 읽으면 인형으로
  if (!m) return;
  const ss = $('#petSkinSel');
  if (ss) { ss.replaceChildren(...Object.entries(PET_SKIN_NAMES).map(([id, n]) => new Option(n, id))); ss.value = m._id; }
  petSkin = m;
  PetSkin.reset($('#pDogArt')); PetSkin.reset($('#pCatArt'));
  $('#petStage').classList.toggle('off', petHidden());
  for (const kind of ['dog', 'cat']) {
    const sel = $('#' + kind + 'Breed'), ids = PetSkin.breedIds(m, kind), em = kind === 'dog' ? '🐶 ' : '🐱 ';
    sel.replaceChildren(...(PetSkin.breedOptions ? PetSkin.breedOptions(m, kind, (b, n) => em + n)   // 맹수·공룡·드래곤 묶음은 <optgroup>
      : ids.map(b => new Option(em + (m.breeds[kind][b].name || b), b))));
    sel.value = m._breed[kind];
  }
  petDraw();
}
function petDraw() {
  if (!petSkin) return;
  const now = Date.now(), bark = petFlash.bark > now;
  const work = gOn() && gWaiting(gList()).some(m => m.got);   // PC 가 받아서 일하는 동안 고양이가 일한다
  const cat = work ? 'work' : petFlash.happy > now ? 'happy' : 'idle';
  const pd = petting === 'dog' ? PetSkin.petted('dog', 'alert', bark) : { mood: 'alert', bark };
  const pc = petting === 'cat' ? PetSkin.petted('cat', cat, false) : { mood: cat };
  $('#pDog').classList.toggle('petting', petting === 'dog'); $('#pCat').classList.toggle('petting', petting === 'cat');
  PetSkin.render(petSkin, $('#pDog'), $('#pDogArt'), 'dog', pd.mood, pd.bark);
  PetSkin.render(petSkin, $('#pCat'), $('#pCatArt'), 'cat', pc.mood, false);
}
function petCheer() {                                     // 보내면 강아지가 짖고 고양이가 기뻐한다
  const now = Date.now(); petFlash.bark = now + 3000; petFlash.happy = now + 4000;
  petDraw(); setTimeout(petDraw, 3100); setTimeout(petDraw, 4100);
}
/* 펫 옮기기 — 손가락으로 끌면 그 자리에 두고(이 기기에 기억), 살짝 누르면 쓰다듬기 */
const PET_POS = 'dnc-pet-pos';
function petPos() { try { return JSON.parse(localStorage.getItem(PET_POS) || '{}'); } catch (e) { return {}; } }
function petPlace() {
  const pos = petPos(), w = innerWidth, h = innerHeight;
  const bottom = ($('.composer') ? $('.composer').getBoundingClientRect().top : h) - 100;
  const def = { dog: [w - 186, bottom], cat: [w - 100, bottom] };      // 처음엔 입력칸 바로 위 오른쪽(대화를 덜 가린다)
  for (const kind of ['dog', 'cat']) {
    const el = $('#p' + kind[0].toUpperCase() + kind.slice(1)), p = pos[kind] || def[kind];
    const x = Math.min(Math.max(0, p[0]), w - 84), y = Math.min(Math.max(0, p[1]), h - 100);   // 화면 밖으로 안 나가게
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
}
for (const k of ['Dog', 'Cat']) {
  const pet = $('#p' + k), kind = k.toLowerCase();
  let start = null;
  pet.addEventListener('pointerdown', e => {
    start = { x: e.clientX, y: e.clientY, l: pet.offsetLeft, t: pet.offsetTop, moved: false };
    try { pet.setPointerCapture(e.pointerId); } catch (err) {}         // 손가락이 펫 밖으로 나가도 계속 따라오게
  });
  pet.addEventListener('pointermove', e => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 8) return;               // 8px 안쪽은 누르기로 본다
    start.moved = true; pet.classList.add('dragging');
    pet.style.left = Math.min(Math.max(0, start.l + dx), innerWidth - 84) + 'px';
    pet.style.top = Math.min(Math.max(0, start.t + dy), innerHeight - 100) + 'px';
  });
  const end = () => {
    if (!start) return;
    const moved = start.moved; start = null; pet.classList.remove('dragging');
    if (moved) {
      const pos = petPos(); pos[kind] = [pet.offsetLeft, pet.offsetTop];
      try { localStorage.setItem(PET_POS, JSON.stringify(pos)); } catch (err) {}
      return;
    }
    petting = kind; petDraw();                                        // 누르기 = 쓰다듬기
    clearTimeout(petTimer); petTimer = setTimeout(() => { petting = null; petDraw(); }, 2500);
  };
  pet.addEventListener('pointerup', end);
  pet.addEventListener('pointercancel', () => { if (start) { start.moved = true; } end(); });
}
addEventListener('resize', petPlace);
petPlace();
$('#clearSent').addEventListener('click', () => {
  if (gOn()) {                                           // Gmail 은 그대로 — 이 기기 화면에서 지금까지의 대화만 안 보이게
    if (!confirm('지금까지의 대화를 이 기기 화면에서 비울까요? (Gmail·PC 는 그대로)')) return;
    store.set('gsince', Date.now()); draw(); toast('비웠습니다'); return;
  }
  if (!sent.length) { toast('지울 기록이 없습니다'); return; }
  if (!confirm('이 기기의 보낸 기록 ' + sent.length + '건을 모두 지울까요? (PC·메일은 그대로)')) return;
  sent = []; store.set('sent', sent); draw(); toast('지웠습니다');
});
for (const kind of ['dog', 'cat']) $('#' + kind + 'Breed').addEventListener('change', e => {
  const p = petPick(); p[kind] = e.target.value;
  try { localStorage.setItem(PET_PICK, JSON.stringify(p)); } catch (err) {}
  petLoad();
});
$('#petSkinSel').addEventListener('change', e => {
  try { localStorage.setItem(PET_SKIN_PICK, e.target.value); } catch (err) {}
  petLoad();
});
petLoad();

// 암호 단어 보기·가리기(설정 화면)
$('#setKeyShow').onclick = e => { const k = $('#setKey'); k.type = k.type === 'password' ? 'text' : 'password'; e.target.textContent = k.type === 'password' ? '보기' : '가리기'; };
