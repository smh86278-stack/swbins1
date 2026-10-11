# -*- coding: utf-8 -*-
"""DispatchChat.exe 만들기 — 다른 PC 에 복사해 쓰는 디스패치 대화 앱(허브 없이 혼자 돈다).

    python build.py      (PyInstaller 가 깔린 파이썬이면 된다 — pip install pyinstaller)

결과: 윈도우 dist\\DispatchChat.exe 한 파일 · 맥 dist/DispatchChat.app. 더블클릭 → 처음엔 메일 계정을 묻고 → 앱 창으로 열린다.
설정은 윈도우 %APPDATA%\\DispatchChat\\config.json(비밀번호 DPAPI), 맥 ~/Library/Application Support/DispatchChat(비밀번호 키체인).
맥에서 서명 안 된 앱이라 처음 한 번은 Finder 에서 우클릭 → 열기.
빌드 결과(dist·build)는 git 에 넣지 않는다.
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "build")
# 펫 코드·그림 — 저장소 구조를 알아서 찾는다(swbins1: ..\pet, 그림 skin\plush · swbins2: ..\macro-hub\web, 그림 skins\plush). exe 안에선 pet\skin\plush
PET, PET_SKIN = next(((os.path.normpath(os.path.join(HERE, r)), sk) for r, sk in (("../pet", "skin"), ("../macro-hub/web", "skins"))
                      if os.path.isfile(os.path.join(HERE, r, "pets.js"))), (os.path.join(HERE, "..", "pet"), "skin"))
COMPANY = os.path.join(HERE, "company.json")              # 회사 값(회사 저장소에만 있다) — 있으면 exe 에 같이 묶는다
ICO = os.path.join(HERE, "app.ico")                       # D&C 메신저 — 인형 크림 고양이 얼굴(D&C 허브 skinicon.py 의 app_icon 으로 만듦)


def main():
    if sys.platform == "darwin":
        # 맥은 DispatchChat.app 폴더(앱 묶음)로 만든다. 아이콘 .ico 는 Pillow 가 있어야 바꿔 넣을 수 있다
        try:
            import PIL  # noqa: F401
            look = ["--windowed", "--icon", ICO]
        except ImportError:
            look = ["--windowed"]
    else:
        look = ["--onefile", "--noconsole", "--icon", ICO]
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", *look,
           "--name", "DispatchChat",
           "--add-data", os.path.join(HERE, "ui.html") + os.pathsep + ".",
           *[x for f in ("pets.js", "petwarp.js", "pets.css") for x in ("--add-data", os.path.join(PET, f) + os.pathsep + "pet")],
           "--add-data", os.path.join(PET, PET_SKIN, "plush") + os.pathsep + os.path.join("pet", "skin", "plush"),   # 인형 강아지·고양이
           *(["--add-data", COMPANY + os.pathsep + "."] if os.path.isfile(COMPANY) else []),
           "--distpath", os.path.join(HERE, "dist"), "--workpath", WORK, "--specpath", WORK,
           os.path.join(HERE, "chat.py")]
    print(" ".join(cmd))
    subprocess.check_call(cmd, cwd=HERE)
    shutil.rmtree(WORK, ignore_errors=True)
    print("만들었습니다:", os.path.join(HERE, "dist", "DispatchChat.app" if sys.platform == "darwin" else "DispatchChat.exe"))


if __name__ == "__main__":
    main()
