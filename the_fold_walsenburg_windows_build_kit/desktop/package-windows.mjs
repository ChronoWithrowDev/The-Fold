import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staging = path.join(root, 'desktop', '.staging');
const dist = path.join(root, 'dist');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error('Run this packager on 64-bit Windows. Cross-compilation and signing are not configured.');
  process.exit(1);
}
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('The production web build is missing. Run npm run build first.');
  process.exit(1);
}

fs.mkdirSync(staging, { recursive: true });
fs.rmSync(path.join(staging, 'game'), { recursive: true, force: true });
fs.cpSync(dist, path.join(staging, 'game'), { recursive: true });
fs.copyFileSync(path.join(root, 'desktop', 'main.cjs'), path.join(staging, 'main.cjs'));

// Desktop metadata is generated in an isolated workspace, leaving the web manifest untouched.
const manifest = {
  name: 'the-fold-walsenburg', version: '0.1.0', private: true,
  description: 'A compact first-person spatial puzzle adventure in Walsenburg, Colorado.',
  author: 'The Fold Project', main: 'main.cjs',
  devDependencies: { electron: '^40.0.0', 'electron-builder': '^26.0.12', sharp: '^0.34.3' },
  build: {
    appId: 'org.huerfano.thefold', productName: 'The Fold - Walsenburg', asar: true,
    directories: { output: '../../release' },
    files: ['main.cjs', 'game/**/*', 'build/icon.png', 'package.json'],
    win: { target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }], icon: 'build/icon.ico' },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, artifactName: 'The-Fold-Setup-${version}.${ext}' },
    portable: { artifactName: 'The-Fold-Portable-${version}.${ext}' },
  },
};
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: staging, stdio: 'inherit', shell: true, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run('npm', ['install']);
const require = createRequire(path.join(staging, 'package.json'));
const sharp = require('sharp');
const png = await sharp(path.join(root, 'public', 'fold-icon.svg')).resize(256, 256).png().toBuffer();
fs.mkdirSync(path.join(staging, 'build'), { recursive: true });
fs.writeFileSync(path.join(staging, 'build', 'icon.png'), png);
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(staging, 'build', 'icon.ico'), Buffer.concat([icoHeader, png]));

run('npx', ['electron-builder', '--win', '--x64']);
console.log('Artifacts are in release/. Test both the portable executable and the installed application before distributing.');