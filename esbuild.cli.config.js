const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher-cli',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] cli build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        } else {
          console.error('    Location information not available');
        }
      });
      console.log('[watch] cli build finished');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/cli.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: !production,
    platform: 'node',
    outfile: 'out/cli.js',
    logLevel: 'silent',
    // 优先使用 ESM 入口，避免某些包的 CJS/UMD 入口残留相对 require 导致运行时缺文件
    mainFields: ['module', 'main'],
    resolveExtensions: ['.ts', '.js'],
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
