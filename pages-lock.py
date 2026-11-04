"""잠긴 페이지 만들기 — GitHub Pages(gh-pages 브랜치)에 키로 암호화한 화면만 올린다.

    python pages-lock.py            키 입력 창 → 암호화 → gh-pages 강제 push
    python pages-lock.py --no-push  만들기만(결과 폴더를 알려 준다)
    D&C 허브 /ops 🔑 로그인·키 「폰 페이지 키」가 키를 기억해 두고 이 스크립트를 돌린다(환경변수 PAGES_LOCK_KEY).

- 키는 입력 창으로만 받고 어디에도 저장하지 않는다(화면의 「암호 단어」와 같게 써도 된다).
- 원래 index.html 과 app.js 를 한 덩어리로 묶어 PBKDF2-SHA256(60만 번) → AES-256-GCM 으로 감싸 payload.json 에 쓴다.
  열 때는 lock/unlock.js 가 브라우저에서 푼다(주소 끝 #k=키 또는 입력 칸).
- 펫(pet/)·아이콘·manifest 는 그대로 올린다(비밀 없음).
- gh-pages 는 매번 커밋 하나로 새로 만들어 강제 push 한다 — 예전 키로 감싼 payload 가 이력에 남지 않게.
- GitHub 저장소 Settings → Pages → Branch 를 gh-pages / (root) 로 한 번 바꿔 두어야 이 브랜치가 보인다.
"""
import base64, json, os, re, shutil, subprocess, sys, tempfile
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = os.path.dirname(os.path.abspath(__file__))
ITER = 600_000
APP_TAG = '<script src="app.js"></script>'


def ask_key():
    import tkinter as tk
    from tkinter import simpledialog, messagebox
    tk_root = tk.Tk(); tk_root.withdraw(); tk_root.attributes('-topmost', True)
    try:
        while True:
            a = simpledialog.askstring('잠긴 페이지', '페이지 키', show='*', parent=tk_root)
            if not a:
                return ''
            b = simpledialog.askstring('잠긴 페이지', '한 번 더', show='*', parent=tk_root)
            if a == b:
                return a
            messagebox.showwarning('잠긴 페이지', '두 번 쓴 키가 다릅니다', parent=tk_root)
    finally:
        tk_root.destroy()


def bundle():
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    app = open(os.path.join(ROOT, 'app.js'), encoding='utf-8').read()
    if html.count(APP_TAG) != 1:
        sys.exit('index.html 에 ' + APP_TAG + ' 가 정확히 한 번 있어야 합니다')
    # 원래 CSP(script-src 'self')는 blob: 으로 붙는 app.js 를 막는다 — 잠금 페이지 쪽 CSP 가 대신한다
    html, n = re.subn(r'<meta http-equiv="Content-Security-Policy"[^>]*>\n?', '', html)
    if n != 1:
        sys.exit('index.html 의 CSP meta 를 찾지 못했습니다')
    return json.dumps({'html': html, 'app': app}, ensure_ascii=False).encode('utf-8')


def seal(data, key):
    salt, iv = os.urandom(16), os.urandom(12)
    k = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(key.encode('utf-8'))
    ct = AESGCM(k).encrypt(iv, data, None)
    e = lambda b: base64.b64encode(b).decode('ascii')
    return {'v': 1, 'it': ITER, 'salt': e(salt), 'iv': e(iv), 'ct': e(ct)}


def git(*args, cwd):
    subprocess.run(['git', *args], cwd=cwd, check=True)


def main():
    push = '--no-push' not in sys.argv
    key = os.environ.pop('PAGES_LOCK_KEY', '') or ask_key()   # D&C 허브가 환경변수로 넘긴다(명령줄엔 안 싣는다 — 프로세스 목록에 보임)
    if not key:
        sys.exit('키를 넣지 않아 그만뒀습니다')
    payload = seal(bundle(), key)

    out = tempfile.mkdtemp(prefix='swbins1-pages-')
    shutil.copy(os.path.join(ROOT, 'lock', 'index.html'), out)
    shutil.copy(os.path.join(ROOT, 'lock', 'unlock.js'), out)
    for f in ('manifest.webmanifest', 'icon-180.png', 'icon-512.png'):
        shutil.copy(os.path.join(ROOT, f), out)
    shutil.copytree(os.path.join(ROOT, 'pet'), os.path.join(out, 'pet'),
                    ignore=shutil.ignore_patterns('README.md', '__pycache__'))
    with open(os.path.join(out, 'payload.json'), 'w', encoding='ascii') as fp:
        json.dump(payload, fp)
    open(os.path.join(out, '.nojekyll'), 'w').close()
    open(os.path.join(out, 'robots.txt'), 'w').write('User-agent: *\nDisallow: /\n')

    if not push:
        print('만듦:', out)
        return
    remote = subprocess.run(['git', 'remote', 'get-url', 'origin'], cwd=ROOT, check=True,
                            capture_output=True, text=True).stdout.strip()
    git('init', '-q', '-b', 'gh-pages', cwd=out)
    git('add', '-A', cwd=out)
    git('commit', '-q', '-m', '잠긴 페이지', cwd=out)
    git('push', '-q', '-f', remote, 'gh-pages', cwd=out)
    try:
        shutil.rmtree(out, onerror=lambda fn, p, e: (os.chmod(p, 0o666), fn(p)))   # .git 안 읽기 전용 파일도 지운다
    except OSError:
        pass
    print('gh-pages 에 올렸습니다')


if __name__ == '__main__':
    main()
