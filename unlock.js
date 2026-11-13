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
