'use strict';

/**
 * Tool + permission policy.
 *
 * Scope note: a git worktree is NOT a security sandbox and these rules are NOT a
 * complete shell sandbox. They only block the explicitly destructive commands the
 * orchestrator is responsible for, and refuse to auto-approve anything ambiguous.
 * Anything undecidable is escalated to the main controller instead of guessed.
 */

const PERMISSION_MODE = 'acceptEdits';

const ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'PowerShell', 'TodoWrite'];
const DISALLOWED_TOOLS = ['Task', 'Agent', 'TeamCreate', 'TeamDelete', 'EnterPlanMode', 'ExitPlanMode', 'Workflow'];

const FORBIDDEN = [
  [/git\s+reset\s+--hard/i, 'destructive git reset --hard'],
  [/git\s+clean\s+-[a-z]*f/i, 'destructive git clean force'],
  [/git\s+push\b[^\n]*(\s--force\b|\s-f\b)/i, 'force push'],
  [/git\s+branch\s+-D\b/i, 'forced branch delete'],
  [/git\s+worktree\s+remove\b[^\n]*--force/i, 'forced worktree remove'],
  [/docker\s+volume\s+rm/i, 'delete existing volume'],
  [/docker\s+system\s+prune/i, 'docker system prune'],
  [/docker\s+compose\b[^\n]*\bdown\b[^\n]*(-v|--volumes)/i, 'compose down removing volumes'],
  [/docker\s+rm\b[^\n]*-f/i, 'forced container delete'],
  [/Remove-Item\b[^\n]*(-Recurse)[^\n]*(-Force)/i, 'recursive force delete'],
  [/\brm\s+-rf?\s+(\/|~|\.\.)/i, 'rm -rf on root/home/parent'],
  [/Format-Volume|Clear-Disk|Remove-Partition/i, 'disk/volume destruction'],
  [/netsh\s+(int|advfirewall|winsock)/i, 'network stack modification'],
  [/Set-Net|New-NetFirewallRule|Set-NetFirewallProfile|Disable-NetAdapter/i, 'network configuration change'],
  [/reg\s+(add|delete)\b/i, 'registry modification'],
  [/shutdown\b|Stop-Computer|Restart-Computer/i, 'machine power state change'],
  [/Set-ExecutionPolicy/i, 'execution policy change'],
  [/\b(iwr|Invoke-WebRequest|curl|wget)\b[^\n]*\|\s*(iex|Invoke-Expression)/i, 'remote script pipe-to-shell'],
];

const ESCALATE = [
  [/git\s+reset\b/i, 'git reset (ambiguous reset target)'],
  [/git\s+clean\b/i, 'git clean (ambiguous clean target)'],
  [/git\s+checkout\s+--\s/i, 'discarding worktree changes'],
  [/git\s+restore\b/i, 'git restore (may discard changes)'],
  [/\brm\b/i, 'rm usage requires main-controller review'],
  [/Remove-Item\b/i, 'Remove-Item usage requires main-controller review'],
  [/docker\s+(rm|rmi|down|prune)\b/i, 'docker teardown requires main-controller review'],
  [/Stop-Process|taskkill\b/i, 'process termination requires main-controller review'],
];

function commandText(toolCall) {
  if (!toolCall) return '';
  const raw = toolCall.rawInput || toolCall.input || {};
  const parts = [];
  if (typeof raw.command === 'string') parts.push(raw.command);
  if (typeof raw.script === 'string') parts.push(raw.script);
  if (typeof toolCall.title === 'string') parts.push(toolCall.title);
  if (typeof toolCall.kind === 'string') parts.push(toolCall.kind);
  if (parts.length === 0) parts.push(JSON.stringify(toolCall));
  return parts.join('\n');
}

function toolName(toolCall) {
  if (!toolCall) return '';
  return toolCall.name || toolCall.toolName || toolCall.kind || '';
}

/**
 * @returns {{decision:'allow'|'deny'|'escalate', reason:string, needsMainControl:boolean}}
 */
function classifyPermission(toolCall) {
  const name = toolName(toolCall);
  if (DISALLOWED_TOOLS.some((t) => t.toLowerCase() === String(name).toLowerCase())) {
    return { decision: 'deny', reason: `agent delegation tool "${name}" is disabled`, needsMainControl: false };
  }
  const text = commandText(toolCall);
  for (const [re, reason] of FORBIDDEN) {
    if (re.test(text)) return { decision: 'deny', reason, needsMainControl: false };
  }
  for (const [re, reason] of ESCALATE) {
    if (re.test(text)) return { decision: 'escalate', reason, needsMainControl: true };
  }
  return { decision: 'allow', reason: 'project development command', needsMainControl: false };
}

function buildToolManifest() {
  return {
    permissionMode: PERMISSION_MODE,
    allowedTools: [...ALLOWED_TOOLS],
    disallowedTools: [...DISALLOWED_TOOLS],
    note: 'worktree is not a security sandbox; rules are not a complete shell sandbox',
  };
}

module.exports = {
  PERMISSION_MODE,
  ALLOWED_TOOLS,
  DISALLOWED_TOOLS,
  classifyPermission,
  buildToolManifest,
  commandText,
};
