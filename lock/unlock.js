/* 잠긴 페이지 풀기 — 키는 주소 끝 #k=… 또는 입력 칸으로 받는다(# 뒤는 서버로 안 간다).
   한 번 풀리면 이 기기에 키를 기억해 두어 다음부터(홈 화면 앱·구글 로그인에서 돌아올 때 포함) 바로 열린다.
   payload.json 은 pages-lock.py 가 만든다: PBKDF2-SHA256 → AES-GCM, 안에는 { html, app } (원래 index.html 과 app.js). */
(function () {
  const KEEP = 'lockKey';
  const $ = id => document.getElementById(id);
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const mem = {
    get() { try { return localStorage.getItem(KEEP) || ''; } catch (e) { return ''; } },
    set(v) { try { v ? localStorage.setItem(KEEP, v) : localStorage.removeItem(KEEP); } catch (e) {} },
  };
  let payload = null;

  /* 「직접」 색 → 바탕 한 벌·책등 두 값. 이상한 값이면 null → 책등·먹 */
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
  /* 「책등」 바탕·강조·밝기 — 풀린 화면(app.js look)이 기억한 'dnc.look' 을 그대로 따른다. 옛 값·빈 값은 책등·먹·자동.
     「직접」 고른 바탕(theme 'custom' + bg)·강조(accent 'custom' + custom)도 위 함수(SPEC.md 「바탕 직접 고르기」 절, app.js 와 같은 묶음)로 같게 칠한다 */
  function look() {
    let l = {};
    try { l = JSON.parse(localStorage.getItem('dnc.look') || '{}') || {}; } catch (e) {}
    const ACC = { mono: '#2F3A3A', ink: '#2F5283', pine: '#2F6B4F', plum: '#7B3A6B', ochre: '#7D5A12' };
    const bg = l.theme === 'custom' && typeof l.bg === 'string' ? bgFor(l.bg) : null;
    const base = bg ? 'custom' : l.theme === 'kraft' ? 'kraft' : 'spine';
    const own = l.accent === 'custom' && typeof l.custom === 'string' && spineFor(l.custom) ? l.custom : '';
    const accent = own ? 'custom' : ACC[l.accent] ? l.accent : 'mono';
    const sp = bg || own ? (bg ? spineFor(own || ACC[accent], [bg.light.bg], [bg.dark.bg]) : spineFor(own)) : null;
    const mode = ['light', 'dark'].includes(l.mode) ? l.mode : 'auto';
    const hr = new Date().getHours(), mq = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = mode === 'auto' ? (hr >= 19 || hr < 7 || mq) : mode === 'dark';
    const h = document.documentElement, st = h.style;
    if (!h.querySelector('#f')) return;                  // 이미 풀린 화면이면 그쪽 app.js 가 맡는다
    h.dataset.theme = dark ? 'dark' : 'light'; h.dataset.base = base; h.dataset.accent = accent;
    const LD = (a, b) => 'light-dark(' + a + ',' + b + ')';
    const vars = bg ? { '--bg': LD(bg.light.bg, bg.dark.bg), '--solid': LD(bg.light.face2, bg.dark.face2), '--text': LD(bg.light.ink, bg.dark.ink),
      '--muted': LD(bg.light.sub, bg.dark.sub), '--line': LD(bg.light.line, bg.dark.line),
      '--field': 'color-mix(in srgb,var(--muted) 60%,var(--bg))', '--edge': LD(bg.light.ink, bg.dark.sub) } : {};
    for (const k of ['--bg', '--solid', '--text', '--muted', '--line', '--field', '--edge']) { if (vars[k]) st.setProperty(k, vars[k]); else st.removeProperty(k); }
    if (sp) st.setProperty('--spine', LD(sp.light, sp.dark)); else st.removeProperty('--spine');
    const bar = bg ? (dark ? bg.dark.bg : bg.light.bg) : base === 'kraft' ? (dark ? '#221D16' : '#E9DEC9') : (dark ? '#1B2018' : '#EEF3EA');
    for (const m of document.querySelectorAll('meta[name=theme-color]')) m.content = bar;
  }
  look();
  const lookTimer = setInterval(look, 60000);

  async function load() {
    if (!payload) payload = await (await fetch('payload.json', { cache: 'no-cache' })).json();
    return payload;
  }
  async function open(key) {
    const p = await load();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), 'PBKDF2', false, ['deriveKey']);
    const aes = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(p.salt), iterations: p.it },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(p.iv) }, aes, b64(p.ct));   // 키가 틀리면 여기서 실패
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function show(b) {
    clearInterval(lookTimer);
    const app = URL.createObjectURL(new Blob([b.app], { type: 'text/javascript' }));
    const html = b.html.replace('<script src="app.js"></script>', '<script src="' + app + '"></script>');
    document.open(); document.write(html); document.close();
  }
  async function tryKey(key, fromHash) {
    if (!key) return false;
    try {
      const b = await open(key);
      mem.set(key);
      if (fromHash) history.replaceState(null, '', location.pathname + location.search);   // 주소에서 키를 지운다
      show(b);
      return true;
    } catch (e) { return false; }
  }
  function ask(text) {
    const f = $('f');
    f.classList.add('on'); $('msg').textContent = text || ''; $('k').focus();
    f.onsubmit = async e => {
      e.preventDefault();
      $('msg').textContent = '…';
      if (!(await tryKey($('k').value, false))) { $('msg').textContent = '열리지 않습니다'; $('k').select(); }
    };
  }

  const hashKey = () => { const m = /^#k=(.+)$/.exec(location.hash); try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } };
  window.addEventListener('hashchange', async () => {        // 잠금 화면에서 주소 끝만 #k=… 로 바꾼 경우(새로 안 불러온다)
    const k = hashKey();
    if (k && !(await tryKey(k, true))) ask('열리지 않습니다');
  });

  (async () => {
    const k = hashKey();
    if (k && await tryKey(k, true)) return;
    if (await tryKey(mem.get(), false)) return;
    mem.set('');
    ask(k ? '열리지 않습니다' : '');
  })();
})();
