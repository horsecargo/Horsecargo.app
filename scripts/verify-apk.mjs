import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const apk = process.argv[2];
const preview = process.argv.includes('--preview');
if (!apk) throw new Error('Provide an APK path.');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('Set ANDROID_HOME to verify the APK.');
const tools = path.join(sdk, 'build-tools', '35.0.0');
const windows = process.platform === 'win32';
const run = (tool, args) => {
  if (tool === 'apksigner' && windows) {
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : 'java';
    return execFileSync(java, ['-jar', path.join(tools, 'lib', 'apksigner.jar'), ...args], { encoding: 'utf8' });
  }
  return execFileSync(path.join(tools, tool + (windows ? '.exe' : '')), args, { encoding: 'utf8' });
};
const badging = run('aapt', ['dump', 'badging', apk]);
const expectedPackage = `com.horsecargoltd.app${preview ? '.preview' : ''}`;
if (!badging.includes(`package: name='${expectedPackage}'`)) throw new Error('Unexpected APK package.');
if (!badging.includes("sdkVersion:'24'")) throw new Error('Unexpected minimum Android SDK.');
if (!preview && badging.includes('application-debuggable')) throw new Error('Release must not be debuggable.');
const manifest = run('aapt', ['dump', 'xmltree', apk, 'AndroidManifest.xml']);
if (!manifest.includes('https://horsecargoapp.netlify.app/index.html')) throw new Error('Unexpected live app URL.');
const certificate = run('apksigner', ['verify', '--verbose', '--print-certs', apk]);
const digest = certificate.match(/Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i)?.[1]?.toUpperCase();
if (!digest) throw new Error('Missing signing certificate.');
if (!preview) {
  const links = JSON.parse(readFileSync(new URL('../www/.well-known/assetlinks.json', import.meta.url), 'utf8'));
  const entry = links.find(x => x.target?.package_name === expectedPackage);
  if (!entry?.target.sha256_cert_fingerprints.some(x => x.replaceAll(':', '').toUpperCase() === digest)) {
    throw new Error('APK signing key does not match the published website fingerprint.');
  }
}
console.log(`Verified ${expectedPackage}: signature, domain, minimum SDK${preview ? '' : ', release mode and website fingerprint'}.`);
