import esbuild from 'esbuild'

const watch = process.argv.includes('--watch')

const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['electron'],
}

const builds = [
  {
    ...shared,
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main/main.js',
  },
  {
    ...shared,
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload/preload.js',
  },
]

async function main() {
  if (watch) {
    const contexts = await Promise.all(builds.map((config) => esbuild.context(config)))
    await Promise.all(contexts.map((context) => context.watch()))
    console.log('Watching Electron main/preload...')
    return
  }
  await Promise.all(builds.map((config) => esbuild.build(config)))
  console.log('Electron build complete')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
