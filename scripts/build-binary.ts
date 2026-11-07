/**
 * Builds a standalone `statuser` executable for the platform it runs on:
 * the CLI bundled into one CommonJS file and injected into a copy of the
 * running Node binary (Node single executable applications). The result
 * runs where no Node is installed. CI builds one per platform on its own
 * runner — a binary cannot be cross-built this way.
 *
 * Output: `build/statuser-<os>-<arch>[.exe]`.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = join(import.meta.dirname, '..');
const out = join(root, 'build');
const { version } = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
) as { version: string };

const platform = process.platform;
const os = { darwin: 'macos', linux: 'linux', win32: 'windows' }[
  platform as string
];
if (!os) throw new Error(`unsupported platform: ${platform}`);
const name = `statuser-${os}-${process.arch}${platform === 'win32' ? '.exe' : ''}`;

mkdirSync(out, { recursive: true });
const bundle = join(out, 'statuser.cjs');
const blob = join(out, 'statuser.blob');
const binary = join(out, name);

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  define: { __STATUSER_VERSION__: JSON.stringify(version) },
  // `import.meta.url` is read only when the version above is missing.
  logOverride: { 'empty-import-meta': 'silent' },
  legalComments: 'none',
});

writeFileSync(
  join(out, 'sea-config.json'),
  JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
    // A code cache ties the blob to this exact Node build; not worth it for
    // a CLI that starts in well under a second anyway.
    useCodeCache: false,
    useSnapshot: false,
  }),
);
run(process.execPath, [
  '--experimental-sea-config',
  join(out, 'sea-config.json'),
]);

copyFileSync(process.execPath, binary);
if (platform === 'darwin') run('codesign', ['--remove-signature', binary]);
run(process.execPath, [
  join(root, 'node_modules/postject/dist/cli.js'),
  binary,
  'NODE_SEA_BLOB',
  blob,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
]);
// Apple Silicon refuses to run an unsigned binary; an ad-hoc signature is
// enough for that. Gatekeeper still asks about a downloaded one.
if (platform === 'darwin') run('codesign', ['--sign', '-', binary]);

console.log(binary);

function run(file: string, args: string[]): void {
  execFileSync(file, args, { stdio: 'inherit' });
}
