# -*- coding: utf-8 -*-
"""11-26 셋째 묶음 뒷부분 — ③ 위험 작업 안전장치 · ④ diff · ⑤ 따로 해 보기(worktree 합치기/버리기) · P7 한도 시각 · P10 남은 프로세스 거르기.
python -m unittest test_patch9   (이 폴더에서)"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import chat_runner as runner  # noqa: E402
import checkpoint  # noqa: E402
import dnc_extra as dx  # noqa: E402

GIT, NODE = shutil.which("git"), shutil.which("node")
GUARD = os.path.join(HERE, "danger-guard.js")


def g(cwd, *a):
    return subprocess.run(["git", "-C", cwd] + list(a), capture_output=True, text=True, encoding="utf-8")


def repo():
    d = tempfile.mkdtemp(prefix="dnc9-")
    root = os.path.join(d, "proj")
    os.makedirs(root)
    g(root, "init", "-q", "-b", "main")
    g(root, "config", "user.email", "t@example.com")
    g(root, "config", "user.name", "t")
    with open(os.path.join(root, "a.txt"), "w", encoding="utf-8") as f:
        f.write("one\ntwo\nthree\n")
    g(root, "add", "-A")
    g(root, "commit", "-q", "-m", "init")
    return d, root


@unittest.skipUnless(NODE, "node 없음")
class DangerGuardTest(unittest.TestCase):
    def run_hook(self, cmd, allow=None, tool="Bash"):
        args = ["node", GUARD]
        if allow is not None:
            fd, path = tempfile.mkstemp(suffix=".json")
            os.write(fd, json.dumps(allow).encode("utf-8"))
            os.close(fd)
            args.append(path)
        r = subprocess.run(args, input=json.dumps({"tool_name": tool, "tool_input": {"command": cmd}}), capture_output=True,
                           text=True, encoding="utf-8")
        return json.loads(r.stdout) if r.stdout.strip() else None

    def test_blocks_and_allows(self):
        for cmd in ("rm -rf build", "git push origin main", "git reset --hard HEAD~1", "git clean -fd", "rtk git push",
                    "Remove-Item x -Recurse", "git branch -D old", "taskkill /PID 5 /F"):
            out = self.run_hook(cmd)
            self.assertIsNotNone(out, cmd)
            self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny", cmd)
        for cmd in ("git status", "npm test", "python -m unittest", "git log --format=%h", "git commit -m 'x'", "ls -la"):
            self.assertIsNone(self.run_hook(cmd), cmd)
        self.assertIsNone(self.run_hook("rm -rf build", ["rm -rf build"]))           # 허락한 바로 그 명령
        self.assertIsNone(self.run_hook("rtk  rm   -rf build", ["rm -rf build"]))     # rtk·빈칸 차이는 같은 명령
        self.assertIsNotNone(self.run_hook("rm -rf src", ["rm -rf build"]))           # 다른 명령은 그대로 막는다
        self.assertIsNotNone(self.run_hook("Remove-Item x", None, "PowerShell"))
        self.assertIsNone(self.run_hook("anything", None, "Read"))

    def test_py_same_names(self):
        self.assertTrue(dx.danger_name("git push origin main"))
        self.assertTrue(dx.danger_name("rtk rm -rf x"))
        self.assertEqual(dx.danger_name("git status"), "")


class GuardSettingsTest(unittest.TestCase):
    def test_danger_hook_only_for_full_bash(self):
        d = tempfile.mkdtemp()
        def wj(p, o):
            with open(p, "w", encoding="utf-8") as f:
                json.dump(o, f)

        def rj(p):
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        C = type("C", (), {"RES": HERE, "write_json": staticmethod(wj)})
        base = os.path.join(d, "job")
        path = runner.guard_settings(["Read", "Edit", "Bash", "Bash(rm -rf build)"], base, C)
        hooks = rj(path)["hooks"]["PreToolUse"]
        dg = [h for h in hooks if "danger-guard.js" in h["hooks"][0]["command"]]
        self.assertEqual(len(dg), 1)
        self.assertEqual(rj(base + ".danger.json"), ["rm -rf build"])
        path2 = runner.guard_settings(["Read", "Bash(git log:*)"], os.path.join(d, "job2"), C)
        hooks2 = rj(path2)["hooks"]["PreToolUse"]
        self.assertFalse(any("danger-guard.js" in h["hooks"][0]["command"] for h in hooks2))
        shutil.rmtree(d, ignore_errors=True)


class LimitTest(unittest.TestCase):
    def test_reset_times(self):
        now = datetime(2026, 11, 26, 13, 0).timestamp()
        self.assertIsNone(dx.limit_reset("다 끝났습니다", now))
        self.assertEqual(dx.limit_reset("Claude AI usage limit reached|%d" % (now + 7200), now), now + 7200)
        t = dx.limit_reset("You've hit your limit · resets 3pm (Asia/Seoul)", now)
        self.assertEqual(datetime.fromtimestamp(t).strftime("%H:%M"), "15:01")
        t = dx.limit_reset("5-hour limit reached ∙ resets 1am", now)                # 지난 시각이면 다음 날
        self.assertEqual(datetime.fromtimestamp(t).strftime("%d %H:%M"), "27 01:01")
        t = dx.limit_reset("사용 한도에 도달했습니다. 오후 4시에 풀립니다", now)
        self.assertEqual(datetime.fromtimestamp(t).strftime("%H:%M"), "16:01")
        self.assertAlmostEqual(dx.limit_reset("rate limit", now, default_min=30), now + 1800)


@unittest.skipUnless(GIT, "git 없음")
class DiffWorktreeTest(unittest.TestCase):
    def setUp(self):
        self.d, self.root = repo()

    def tearDown(self):
        subprocess.run(["git", "-C", self.root, "worktree", "prune"], capture_output=True)
        shutil.rmtree(self.d, ignore_errors=True)

    def test_diff(self):
        checkpoint.snap(self.root, "j1", "before")
        with open(os.path.join(self.root, "a.txt"), "w", encoding="utf-8") as f:
            f.write("one\nTWO\nthree\n")
        checkpoint.snap(self.root, "j1", "after")
        r = dx.diff_file(self.root, "j1", os.path.join(self.root, "a.txt"))
        self.assertEqual(r["path"], "a.txt")
        self.assertIn("-two", r["diff"])
        self.assertIn("+TWO", r["diff"])
        with self.assertRaises(ValueError):
            dx.diff_file(self.root, "j1", "nope.txt")
        with self.assertRaises(ValueError):
            dx.diff_file(self.root, "nojob", "a.txt")

    def test_strip(self):
        self.assertEqual(dx.wt_strip("고쳐 줘\n[dnc:wt]\n본문"), ("고쳐 줘\n본문", True))
        self.assertEqual(dx.wt_strip("그냥"), ("그냥", False))

    def test_merge(self):
        w = dx.wt_add(self.root, "j2")
        self.assertTrue(w and os.path.isdir(w["path"]))
        self.assertEqual(w["branch"], "dnc/j2")
        self.assertTrue(os.path.normcase(w["path"]).endswith(os.path.normcase(os.path.join(".dnc-wt", "j2"))))
        with open(os.path.join(w["workdir"], "b.txt"), "w", encoding="utf-8") as f:
            f.write("new\n")
        self.assertEqual(dx.wt_state(w)["dirty"], 1)
        r = dx.wt_merge(w, "D&C: T9 합치기")
        self.assertTrue(r["merged"])
        self.assertTrue(os.path.isfile(os.path.join(self.root, "b.txt")))
        self.assertFalse(os.path.isdir(w["path"]))
        self.assertEqual(g(self.root, "branch", "--list", "dnc/j2").stdout.strip(), "")

    def test_conflict_aborts(self):
        w = dx.wt_add(self.root, "j3")
        with open(os.path.join(w["workdir"], "a.txt"), "w", encoding="utf-8") as f:
            f.write("wt\n")
        with open(os.path.join(self.root, "a.txt"), "w", encoding="utf-8") as f:
            f.write("main\n")
        g(self.root, "commit", "-qam", "main side")
        with self.assertRaises(ValueError):
            dx.wt_merge(w, "D&C: T9")
        self.assertEqual(open(os.path.join(self.root, "a.txt"), encoding="utf-8").read(), "main\n")
        self.assertFalse(os.path.exists(os.path.join(self.root, ".git", "MERGE_HEAD")))
        self.assertTrue(os.path.isdir(w["path"]))                               # 실패하면 작업 공간은 남긴다
        dx.wt_drop(w)

    def test_drop_and_guard(self):
        w = dx.wt_add(self.root, "j4")
        self.assertTrue(dx.wt_drop(w)["gone"])
        with self.assertRaises(ValueError):
            dx.wt_drop({"repo": self.root, "path": self.root, "branch": "main"})   # 아무 폴더·브랜치나 지우지 않는다
        self.assertIsNone(dx.wt_add(tempfile.gettempdir(), "j5") if not checkpoint.top(tempfile.gettempdir()) else None)

    def test_no_change_merge(self):
        w = dx.wt_add(self.root, "j6")
        r = dx.wt_merge(w, "D&C: T9")
        self.assertFalse(r["merged"])
        self.assertFalse(os.path.isdir(w["path"]))


class LeftoverTest(unittest.TestCase):
    def test_filter(self):
        t0 = datetime(2026, 11, 26, 10, 0).timestamp()
        job = {"status": "done", "started_at": "2026-11-26 10:00:00", "finished_at": "2026-11-26 10:10:00", "claude_pid": 500}
        procs = [
            {"pid": 1, "ppid": 0, "name": "System", "cmd": "", "start": 0},
            {"pid": 600, "ppid": 500, "name": "node.exe", "cmd": "node server.js", "start": t0 + 60},          # claude 의 자식
            {"pid": 601, "ppid": 999, "name": "python.exe", "cmd": "python -m http.server 8000", "start": t0 + 70},  # 부모가 사라짐
            {"pid": 602, "ppid": 601, "name": "node.exe", "cmd": "node vite", "start": t0 + 80},                   # 남은 것의 자식
            {"pid": 603, "ppid": 999, "name": "python.exe", "cmd": r"C:\x\tools\macro-hub\app.py --child", "start": t0 + 90},  # 허브 — 늘 뺀다
            {"pid": 604, "ppid": 999, "name": "node.exe", "cmd": "node mcp-server", "start": t0 + 90},             # MCP — 뺀다
            {"pid": 605, "ppid": 999, "name": "node.exe", "cmd": "node old.js", "start": t0 - 600},               # 작업 전에 생김
            {"pid": 606, "ppid": 1, "name": "node.exe", "cmd": "node other.js", "start": t0 + 100},              # 부모가 살아 있음
            {"pid": 607, "ppid": 999, "name": "chrome.exe", "cmd": "chrome", "start": t0 + 100},                 # 개발 도구 아님
            {"pid": 608, "ppid": 999, "name": "python.exe", "cmd": "python chat.py", "start": t0 + 100},          # 메신저 — 뺀다
        ]
        got = sorted(x["pid"] for x in dx.leftovers(job, procs))
        self.assertEqual(got, [600, 601, 602])
        self.assertEqual(dx.leftovers(dict(job, status="running"), procs), [])


if __name__ == "__main__":
    unittest.main()
