import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { normalizeSiteUrl, seoPlugin } from './seo-plugin.ts'

const require = createRequire(import.meta.url)
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))
const pdfjsAssetDirs = ['cmaps', 'standard_fonts', 'wasm'] as const

const assetTypes: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.js': 'text/javascript',
}

function pdfjsAssets(): Plugin {
  let outDir = ''

  return {
    name: 'pdfjs-assets',
    configResolved(config) {
      outDir = config.build.outDir
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url?.split('?')[0]
        if (!raw) return next()
        const dir = pdfjsAssetDirs.find((name) => raw === `/${name}` || raw.startsWith(`/${name}/`))
        if (!dir) return next()
        let rel = ''
        try {
          rel = decodeURIComponent(raw.slice(`/${dir}/`.length))
        } catch {
          next()
          return
        }
        if (!rel || rel.includes('\0')) return next()
        const root = path.resolve(pdfjsRoot, dir)
        const file = path.resolve(root, rel)
        const inside = file === root || file.startsWith(root + path.sep)
        if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('Content-Type', assetTypes[path.extname(file)] ?? 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
    writeBundle() {
      for (const dir of pdfjsAssetDirs) {
        fs.cpSync(path.join(pdfjsRoot, dir), path.join(outDir, dir), { recursive: true })
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL)
  return {
    plugins: [react(), pdfjsAssets(), seoPlugin(siteUrl)],
  }
})
