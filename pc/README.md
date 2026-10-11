# D&C 메신저 — PC 화면 (`pc/`)

메일로 맡긴 일을 **메신저처럼** 보는 PC 앱입니다. 이 폴더와 옆의 `../pet/`(폰 페이지와 같이 쓰는 인형 펫)만 있으면 돕니다 —
게이트웨이 저장소(swbins2)가 없는 PC 에서도, **윈도우·맥** 모두.

```
[윈도우]  python chat.py          또는  build.py 로 만든 DispatchChat.exe 더블클릭
[맥]      DispatchChat.command 더블클릭(처음 한 번은 우클릭 → 열기)  또는  python3 chat.py
[아이폰]  이 저장소 루트의 폰 페이지(GitHub Pages)
```

처음 열면 메일 계정을 묻고, 앱 창(Edge — 맥은 Edge 나 크롬, 없으면 기본 브라우저)으로 열립니다. 화면은 `http://127.0.0.1:8620/`.

## 메일

- **IMAP·SMTP 가 되는 메일이면 어디든** 됩니다. 메일 주소를 넣으면 잘 알려진 곳은 서버가 저절로 채워집니다.

  | 메일 | IMAP | SMTP | 비밀번호 |
  |---|---|---|---|
  | Gmail | imap.gmail.com 993 | smtp.gmail.com 587 | 앱 비밀번호(2단계 인증 필요) |
  | 네이버 | imap.naver.com 993 | smtp.naver.com 587 | 메일 설정에서 IMAP/SMTP 켜기 |
  | 다음·카카오 | imap.daum.net 993 | smtp.daum.net 465 | 메일 설정에서 IMAP 켜기 |
  | iCloud | imap.mail.me.com 993 | smtp.mail.me.com 587 | 앱 암호 |
  | 회사 메일 | 회사 안내대로 | 회사 안내대로 | 평소 비밀번호 |

  Outlook.com(개인)은 마이크로소프트가 비밀번호 로그인(IMAP 기본 인증)을 막아 지금은 안 됩니다.
- 앱은 지시를 **내 주소로 나에게** 보내고 그 메일함을 읽습니다. 실제로 일을 하는 건 게이트웨이 PC 의 메일 게이트웨이라,
  **게이트웨이가 그 메일함을 읽어야** 지시가 실행됩니다(지금: 회사 메일 · 게이트웨이 설정의 Gmail).
  회사 밖 메일은 설정의 **암호 단어**를 게이트웨이 `keyed_senders` 와 같게 넣으면 본문 마지막 줄에 `[k:단어]` 로 붙여 보냅니다(화면에는 안 보임).
- 비밀번호는 윈도우는 DPAPI(그 PC 사용자만 풀 수 있음), 맥은 키체인에 둡니다.
- 설정·로그: 윈도우 `%APPDATA%\DispatchChat\config.json` · `%LOCALAPPDATA%\DispatchChat\chat.log`,
  맥 `~/Library/Application Support/DispatchChat/`.

## 진행 상황(실시간)

게이트웨이 PC 에서 돌리면, **일하는 중인 대화**에 Claude 가 지금 무엇을 하는지(쓰는 도구·중간 말·할 일 목록)가 2초마다 카드로 올라옵니다.
워커가 만든 작업(`inbox/jobs/*.json`)과 Claude Code 가 스스로 남기는 세션 기록(`~/.claude/projects/<작업 폴더>/*.jsonl`)을 읽기만 합니다 —
게이트웨이·워커는 고칠 것이 없습니다.

- 게이트웨이 인박스: `--inbox <폴더>` → `DISPATCH_INBOX` → (윈도우) `C:\swbins2\inbox` 가 있으면 그것. 셋 다 없으면 진행 카드만 빠지고 나머지는 그대로 돕니다.
- 단계를 누르면 **자세히** — 도구에 넘긴 전체 입력(명령 전문, 고친 내용은 -/+ 줄)과 결과 출력(2,000자까지)이 그 자리에 펼쳐집니다. 펼쳐 둔 건 갱신돼도 유지됩니다.
- 다른 PC 에서는 진행 기록이 없으니 '작업 중' 표시만 보입니다.

## 회사마다 세팅

- 설정 화면(⚙)에서 메일 서버·Jira 접두어·암호 단어를 넣으면 됩니다 — 어느 회사든.
- 회사 값을 처음부터 채워 두려면 `company.example.json` 을 `company.json` 으로 복사해 채웁니다(설정 화면 기본값 + 메일 주소 프리셋).
  `build.py` 가 있으면 exe 에 같이 묶습니다. 공개 저장소에는 커밋하지 않습니다(`.gitignore`).
- **같은 코드가 두 곳에 있습니다** — 여기(swbins1/pc, 모든 회사용)와 회사 저장소 swbins2 의 `tools/dispatch-chat`(우리 회사 `company.json` 포함).
  차이는 `company.json` 뿐이어야 합니다. 한쪽을 고치면 다른 쪽에도 복사하고 `diff` 로 확인합니다:
  `diff -rq --exclude=company.json --exclude=dist --exclude=build --exclude=__pycache__ C:/swbins1/pc C:/swbins2/tools/dispatch-chat`

## 그 밖

- 화면은 127.0.0.1 에만 열리고, 보내기 같은 요청은 띄울 때마다 새로 만드는 토큰이 있어야 합니다.
- 포트가 겹치면 `DISPATCH_CHAT_PORT` 환경변수로 바꿉니다(이미 같은 포트에 메신저가 떠 있으면 새로 띄우지 않고 창만 엽니다).
- 대화 규칙(선택지·멈춤)은 게이트웨이 쪽 `chat-protocol.md`.

## 만들기 · 확인

```
python build.py                 → 윈도우 dist\DispatchChat.exe · 맥 dist/DispatchChat.app   (pip install pyinstaller, dist·build 는 git 제외)
python -m unittest test_chat    → 진행 상황 풀기·세션 기록 찾기 (메일 서버 없이)
```
