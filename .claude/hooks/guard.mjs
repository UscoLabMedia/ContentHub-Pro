// PreToolUse guard: blocks token-wasting or sensitive reads. Exit 2 = block, message goes to Claude.
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0);
}
const t = input.tool_input ?? {};
const target = [t.file_path, t.path, t.pattern, t.command].filter(Boolean).join(' ');

const BLOCKED = [
  [/(^|[\\/\s])node_modules([\\/\s]|$)/, 'node_modules (huge, useless to read)'],
  [/(^|[\\/\s])(dist|out|coverage)[\\/]/, 'build output'],
  [/package-lock\.json/, 'package-lock.json (huge)'],
  [/\.enc(\s|$)/, 'encrypted vault files'],
  [/\.env(\.|\s|$)/, 'environment/secret files'],
];

// Only block read-like Bash (not installs/builds that merely touch these dirs).
const isBash = input.tool_name === 'Bash';
const readLike = /(^|\s)(cat|head|tail|less|more|grep|rg|ls\s+-R|find|tree)\s/.test(t.command ?? '');
if (!isBash || readLike) {
  for (const [re, why] of BLOCKED) {
    if (re.test(target)) {
      console.error(`Blocked by project rules: ${why}. Read only what you need (Grep/Glob with a narrow path).`);
      process.exit(2);
    }
  }
}
process.exit(0);
