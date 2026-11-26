#!/usr/bin/env node
'use strict';
/* 위험 작업 승인 요청(2026-11-26, Omnara·Happy 결) — claude -p 의 PreToolUse 훅(matcher Bash|PowerShell).
 * Bash 전체가 열린 수정 허용 작업에만 붙는다(워커 inbox-worker.ps1 · 메신저 chat_runner.py).
 *
 * 왜: 수정 허용 작업은 Bash 가 통째로 열려 있어 파일 지우기·git push·reset --hard 같은 되돌리기 어려운 명령도 그냥 돌았다.
 * 이 훅이 그런 명령을 막으면 결과의 permission_denials 에 남고, 게이트웨이·메신저가 「허락이 필요한 일」로 묻는다
 * ([허용하고 이어서 하기] / [허용하지 않음]). 허락하면 그 명령 하나만 도구 목록에 Bash(<명령>) 으로 더해 같은 세션을 잇고,
 * 실행기는 그 목록을 파일로 넘겨 이 훅이 그 명령만 통과시킨다(인자 1: 허락한 명령 목록 JSON 파일).
 * 오류가 나면 막는다(fail-closed). Node 만 쓴다. */

const fs = require('fs');

// [정규식, 사람이 읽을 이름] — 명령 앞에 붙는 rtk 는 떼고 본다
const DANGER = [
  [/(^|[\s;&|(])(rm|rmdir|unlink|shred)(\s|$)/i, '파일·폴더 지우기'],
  [/(^|[\s;&|(])(del|erase|rd)\s+/i, '파일·폴더 지우기'],
  [/\bremove-item\b|(^|[\s;&|(])ri\s+/i, '파일·폴더 지우기'],
  [/\bgit\s+push\b/i, 'git push(원격에 올리기)'],
  [/\bgit\s+reset\s+[^\n]*--hard\b/i, 'git reset --hard(고친 것 버리기)'],
  [/\bgit\s+clean\b/i, 'git clean(추적 안 하는 파일 지우기)'],
  [/\bgit\s+(checkout|restore)\s+[^\n]*(--\s+\.|\s\.(\s|$)|--worktree|-f\b|--force\b)/i, 'git checkout/restore 로 고친 것 버리기'],
  [/\bgit\s+branch\s+[^\n]*-(D|d)\b|\bgit\s+branch\s+[^\n]*--delete\b/i, 'git 브랜치 지우기'],
  [/\bgit\s+stash\s+(drop|clear)\b/i, 'git stash 버리기'],
  [/\bgit\s+(rebase|filter-branch|filter-repo)\b/i, 'git 이력 고쳐 쓰기'],
  [/\bgit\s+update-ref\s+-d\b|\bgit\s+tag\s+[^\n]*-d\b/i, 'git 참조 지우기'],
  [/\bnpm\s+(publish|unpublish)\b|\bgh\s+release\s+(create|delete)\b|\bgh\s+repo\s+delete\b/i, '배포·공개'],
  [/(^|[\s;&|(])(format|mkfs|diskpart|shutdown|restart-computer|stop-computer)\b|\bdd\s+if=/i, '디스크·전원'],
  [/\b(taskkill|stop-process|kill|pkill|killall)\b/i, '프로세스 끄기'],
  [/\breg\s+(delete|add)\b|\bremove-itemproperty\b|\bset-itemproperty\b/i, '레지스트리 바꾸기'],
];

function norm(cmd) {
  return String(cmd || '').trim().replace(/^rtk\s+/, '').split(/\s+/).join(' ');
}

// 위험한 명령이면 [이름], 아니면 ''
function danger(cmd) {
  const c = norm(cmd);
  if (!c) return '';
  for (const [re, name] of DANGER) if (re.test(c)) return name;
  return '';
}

function allowList(file) {
  if (!file) return [];
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(v) ? v.map(norm).filter(Boolean) : [];
  } catch (e) { return []; }
}

function deny(why) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: '위험 작업 안전장치: ' + why + ' — 사용자 허락이 필요한 명령이라 실행하지 않았습니다. '
      + '다른 방법으로 우회하지 말고, 이 명령이 꼭 필요하면 무엇을 왜 하려는지 답에 적고 멈추세요. 사용자가 허락하면 이어서 합니다.' } };
}

function decide(d, allow) {
  if (!d || typeof d !== 'object') return deny('훅 입력을 읽지 못했습니다');
  if (d.tool_name !== 'Bash' && d.tool_name !== 'PowerShell') return null;
  const cmd = (d.tool_input || {}).command;
  const why = danger(cmd);
  if (!why) return null;
  if ((allow || []).includes(norm(cmd))) return null;          // 사용자가 허락한 바로 그 명령
  return deny(why + ' (' + norm(cmd).slice(0, 120) + ')');
}

if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { buf += c; });
  process.stdin.on('end', () => {
    let out;
    try { out = decide(JSON.parse(buf), allowList(process.argv[2])); } catch (e) { out = deny('훅이 입력을 처리하지 못했습니다(' + e.message + ')'); }
    if (out) process.stdout.write(JSON.stringify(out));
    process.exit(0);
  });
}

module.exports = { danger, norm, decide, allowList };
