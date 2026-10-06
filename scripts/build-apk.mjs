import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const variant = process.argv[2];
if (!['debug', 'release'].includes(variant)) throw new Error('Choose debug or release.');
const tasks = variant === 'debug' ? [':live:assembleDebug', ':live:lintDebug'] : [':live:assembleRelease'];
const windows = process.platform === 'win32';
const result = spawnSync(windows ? 'gradlew.bat' : 'sh',
  [...(windows ? [] : ['./gradlew']), ...tasks, '--no-daemon', '--console=plain'],
  { cwd: fileURLToPath(new URL('../android/', import.meta.url)), stdio: 'inherit', shell: windows });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
