#!/usr/bin/env node
/**
 * Build AutoShorts for every platform the current host is able to target.
 *
 *   npm run build:all                  # tenta todas as plataformas disponíveis
 *   npm run build:all -- --only=linux,macos
 *   npm run build:all -- --skip=windows
 *   npm run build:all -- --dry-run     # mostra os comandos sem executar
 *
 * Regras reais de plataforma:
 *   - Linux   : nativo (deb/rpm/AppImage)
 *   - Windows : nativo no Windows; a partir do WSL usa o toolchain do Windows
 *               (cargo.exe + node.exe + MSVC Build Tools) num diretório de staging
 *   - macOS   : SOMENTE macOS + Xcode (impossível a partir de Linux/WSL)
 *
 * Artefatos finais são copiados para `artifacts/<plataforma>/`.
 * O script continua nas demais plataformas quando uma falha ou é pulada.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';
const IS_WSL =
  IS_LINUX &&
  (Boolean(process.env.WSL_DISTRO_NAME) ||
    fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop') ||
    /microsoft/i.test(fs.existsSync('/proc/version') ? fs.readFileSync('/proc/version', 'utf8') : ''));

const argv = process.argv.slice(2);
const listArg = (flag) => {
  const hit = argv.find((a) => a === flag || a.startsWith(`${flag}=`));
  if (!hit) return null;
  const value = hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
};
const ONLY = listArg('--only');
const SKIP = listArg('--skip') ?? [];
const DRY_RUN = argv.includes('--dry-run');

/* ------------------------------------------------------------------ helpers */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

function log(msg = '') {
  console.log(msg);
}

function step(msg) {
  log(`\n${c.cyan('▶')} ${c.bold(msg)}`);
}

function ok(msg) {
  log(`  ${c.green('✔')} ${msg}`);
}

function warn(msg) {
  log(`  ${c.yellow('!')} ${msg}`);
}

function fail(msg) {
  log(`  ${c.red('✖')} ${msg}`);
}

function info(msg) {
  log(`  ${c.dim(msg)}`);
}

/** Roda um comando herdando stdout/stderr. */
function run(cmd, args, opts = {}) {
  const pretty = [cmd, ...args].join(' ');
  if (DRY_RUN) {
    info(`[dry-run] ${pretty}`);
    return { status: 0 };
  }
  info(`$ ${pretty}`);
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    shell: false,
  });
  return { status: res.status ?? 1 };
}

/** Roda um comando capturando stdout (retorna null em falha). */
function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
  });
  if (res.status !== 0) return null;
  return (res.stdout ?? '').trim();
}

function which(cmd) {
  return IS_WIN ? capture('where', [cmd]) : capture('which', [cmd]);
}

function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) ?? null;
}

function unixPath(winPath) {
  if (!winPath) return null;
  const converted = capture('wslpath', ['-u', winPath]);
  return converted || null;
}

/** Copia apenas os instaláveis relevantes para artifacts/<id>. */
function collect(id, sources, extensions) {
  if (DRY_RUN) {
    info(`[dry-run] copiaria bundles para artifacts/${id}/`);
    return;
  }
  const exts = extensions.map((e) => e.toLowerCase());
  const dest = path.join(ARTIFACTS, id);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  let copied = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!exts.some((e) => entry.name.toLowerCase().endsWith(e))) continue;
      fs.cpSync(full, path.join(dest, entry.name));
      copied += 1;
    }
  };

  for (const src of sources.filter((s) => s && fs.existsSync(s))) walk(src);
  if (copied === 0) {
    warn(`nenhum bundle (${exts.join(', ')}) encontrado para ${id}`);
    return;
  }
  ok(`${copied} artefato(s) copiado(s) para ${path.relative(ROOT, dest)}/`);
}

/* --------------------------------------------------------- environment data */

const linuxDeps = () => {
  if (!which('pkg-config')) return ['pkg-config'];
  const probe = (lib) => spawnSync('pkg-config', ['--exists', lib]).status === 0;
  return ['webkit2gtk-4.1', 'gtk+-3.0', 'libsoup-3.0'].filter((lib) => !probe(lib));
};

const winToolchain = (() => {
  if (!IS_WSL) return null;
  const profile = unixPath(capture('cmd.exe', ['/c', 'echo %USERPROFILE%']));
  if (!profile) return null;
  const cargoExe = firstExisting([path.join(profile, '.cargo/bin/cargo.exe')]);
  const nodeDir = firstExisting([
    '/mnt/c/Program Files/nodejs',
    path.join(profile, 'AppData/Roaming/npm'),
  ]);
  const msBuildTools = firstExisting([
    '/mnt/c/Program Files/Microsoft Visual Studio/2022/BuildTools',
    '/mnt/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools',
    '/mnt/c/Program Files/Microsoft Visual Studio/2022/Community',
    '/mnt/c/Program Files (x86)/Microsoft Visual Studio/2022/Community',
  ]);
  return {
    profile,
    cargoExe,
    nodeDir: nodeDir && fs.existsSync(path.join(nodeDir, 'npm.cmd')) ? nodeDir : null,
    msBuildTools,
    staging: path.join(profile, 'autoshorts-build'),
  };
})();

/* ------------------------------------------------------------ build targets */

const targets = [
  {
    id: 'linux',
    label: 'Linux (.deb / .rpm / .AppImage)',
    reason() {
      if (!IS_LINUX) return 'host não é Linux — rode em uma máquina Linux ou via CI';
      const missing = linuxDeps();
      if (missing.length) return `dependências ausentes: ${missing.join(', ')}`;
      return null;
    },
    build() {
      const bundles = process.env.LINUX_BUNDLES ?? 'deb,rpm,appimage';
      const res = run('npx', ['tauri', 'build', '--bundles', bundles]);
      if (res.status !== 0) throw new Error('`tauri build` falhou');
      collect('linux', [path.join(ROOT, 'src-tauri/target/release/bundle')], [
        '.deb',
        '.rpm',
        '.AppImage',
      ]);
    },
  },
  {
    id: 'windows',
    label: 'Windows (.msi / .exe NSIS)',
    reason() {
      if (IS_WIN) return null;
      if (!IS_WSL) return 'host não é Windows/WSL — rode no Windows ou via CI';
      if (!winToolchain?.cargoExe) return 'cargo.exe do Windows não encontrado (rustup no Windows)';
      if (!winToolchain?.nodeDir) return 'Node.js do Windows não encontrado (node.exe/npm.cmd)';
      if (!winToolchain?.msBuildTools) return 'Visual Studio Build Tools (MSVC) não encontrado';
      return null;
    },
    build() {
      const bundles = process.env.WINDOWS_BUNDLES ?? '';
      const bundleArgs = bundles ? ['--bundles', bundles] : [];
      if (IS_WIN) {
        const res = run('npx', ['tauri', 'build', ...bundleArgs]);
        if (res.status !== 0) throw new Error('`tauri build` falhou');
        collect('windows', [path.join(ROOT, 'src-tauri/target/release/bundle')], [
          '.msi',
          '.exe',
        ]);
        return;
      }

      // WSL -> toolchain nativa do Windows. cmd.exe não aceita caminhos UNC,
      // então o código é espelhado em /mnt/c e compilado do lado Windows.
      const { staging, profile, nodeDir } = winToolchain;
      step(`Windows: espelhando fonte para ${staging}`);
      fs.mkdirSync(staging, { recursive: true });
      const rsync = run('rsync', [
        '-a',
        '--delete',
        '--exclude', 'node_modules',
        '--exclude', 'target',
        '--exclude', 'dist',
        '--exclude', 'artifacts',
        '--exclude', '.git',
        `${ROOT}/`,
        `${staging}/`,
      ]);
      if (rsync.status !== 0) throw new Error('rsync para o staging do Windows falhou');

      const stagingWin = capture('wslpath', ['-w', staging]);
      const npmCmd = capture('wslpath', ['-w', path.join(nodeDir, 'npm.cmd')]);
      const nodeWinDir = capture('wslpath', ['-w', nodeDir]);
      const cargoBinWin = capture('wslpath', ['-w', path.join(profile, '.cargo/bin')]);
      if (!stagingWin || !npmCmd) throw new Error('não foi possível converter caminhos para Windows');

      // cmd.exe não roda com cwd UNC (caminho \\wsl.localhost\...), então o build
      // é disparado por um .cmd gravado no próprio staging do Windows.
      // O staging guarda o próprio node_modules (o rsync o exclui). Ele fica
      // desatualizado quando package-lock.json muda, então reinstalamos sempre
      // que o lockfile for mais novo que a instalação registrada pelo npm.
      const stagingLock = path.join(staging, 'package-lock.json');
      const stagingInstallMark = path.join(staging, 'node_modules/.package-lock.json');
      const stagingTauriCli = path.join(staging, 'node_modules/.bin/tauri.cmd');
      const needsInstall =
        !fs.existsSync(stagingTauriCli) ||
        !fs.existsSync(stagingInstallMark) ||
        (fs.existsSync(stagingLock) &&
          fs.statSync(stagingLock).mtimeMs > fs.statSync(stagingInstallMark).mtimeMs);
      info(
        needsInstall
          ? 'dependências do staging desatualizadas — rodando `npm ci` no Windows'
          : 'dependências do staging atualizadas',
      );

      const scriptPath = path.join(staging, 'build-autoshorts.cmd');
      const scriptWin = path.join(stagingWin, 'build-autoshorts.cmd');
      const bundleFlag = bundles ? ` -- --bundles ${bundles}` : '';
      const installLines = needsInstall
        ? [
            'echo [build] instalando dependencias no Windows...',
            'call npm ci --no-audit --no-fund',
            'if errorlevel 1 exit /b 1',
          ]
        : [];
      fs.writeFileSync(
        scriptPath,
        [
          '@echo off',
          'setlocal',
          'cd /d "%~dp0"',
          `set "PATH=${[nodeWinDir, cargoBinWin].filter(Boolean).join(';')};%PATH%"`,
          ...installLines,
          `call npm run tauri:build${bundleFlag}`,
          'exit /b %errorlevel%',
          '',
        ].join('\r\n'),
      );

      const res = run('cmd.exe', ['/c', scriptWin], { cwd: staging });
      if (res.status !== 0) throw new Error('build no lado Windows falhou');
      collect('windows', [path.join(staging, 'src-tauri/target/release/bundle')], [
        '.msi',
        '.exe',
      ]);
    },
  },
  {
    id: 'macos',
    label: 'macOS (.dmg / .app)',
    reason() {
      if (!IS_MAC) return 'macOS exige macOS + Xcode — impossível compilar a partir de Linux/WSL';
      if (!which('xcodebuild')) return 'Xcode não instalado';
      return null;
    },
    build() {
      const bundles = process.env.MACOS_BUNDLES ?? 'app,dmg';
      const res = run('npx', ['tauri', 'build', '--bundles', bundles]);
      if (res.status !== 0) throw new Error('`tauri build` falhou');
      collect('macos', [path.join(ROOT, 'src-tauri/target/release/bundle')], ['.dmg', '.app']);
    },
  },
];

/* ---------------------------------------------------------------- execution */

const selected = targets.filter(
  (t) => (!ONLY || ONLY.includes(t.id)) && !SKIP.includes(t.id),
);

if (selected.length === 0) {
  fail('nenhuma plataforma selecionada (verifique --only/--skip)');
  process.exit(1);
}

log(c.bold(`AutoShorts — build multiplataforma (${selected.length} alvo(s))`));
info(`host: ${process.platform}${IS_WSL ? ' (WSL)' : ''}  ·  raiz: ${ROOT}`);
if (DRY_RUN) warn('modo dry-run: nenhum comando será executado');

const results = [];

for (const target of selected) {
  step(target.label);
  const blocked = target.reason();
  if (blocked) {
    warn(`pulado: ${blocked}`);
    results.push({ id: target.id, status: 'skipped', detail: blocked });
    continue;
  }
  const started = Date.now();
  try {
    target.build();
    const secs = Math.round((Date.now() - started) / 1000);
    ok(`concluído em ${secs}s`);
    results.push({ id: target.id, status: 'built', detail: `${secs}s` });
  } catch (err) {
    fail(err.message);
    results.push({ id: target.id, status: 'failed', detail: err.message });
  }
}

step('Resumo');
const icon = { built: c.green('✔'), skipped: c.yellow('!'), failed: c.red('✖') };
for (const r of results) {
  const label = targets.find((t) => t.id === r.id).label;
  log(`  ${icon[r.status]} ${r.id.padEnd(8)} ${r.status.padEnd(8)} ${c.dim(label)} — ${r.detail}`);
}
const built = results.filter((r) => r.status === 'built').map((r) => r.id);
if (built.length) {
  log(`\n  ${c.green('Artefatos:')} ${path.relative(ROOT, ARTIFACTS)}/{${built.join(',')}}`);
}
const hardFailures = results.filter((r) => r.status === 'failed');
if (hardFailures.length) {
  log('');
  fail(`${hardFailures.length} build(s) falharam`);
  process.exit(1);
}
