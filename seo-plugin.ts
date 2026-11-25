import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'

type Feature = { title: string; body: string }

type SiteCopy = {
  name: string
  title: string
  description: string
  tagline: string
  headline: string
  lead: string
  featuresHeading: string
  features: Feature[]
  limits: string[]
}

const AI_AGENTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'Google-Extended',
  'GoogleOther',
  'Applebot',
  'Applebot-Extended',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-SearchBot',
  'Amazonbot',
  'YouBot',
  'cohere-ai',
  'DuckAssistBot',
  'Meta-ExternalAgent',
  'Meta-ExternalFetcher',
]

function loadSite(): SiteCopy {
  const file = new URL('./src/content/site.json', import.meta.url)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as SiteCopy
}

export function normalizeSiteUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/$/, '')
  if (!trimmed) return ''
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return ''
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
  if (url.username || url.password || url.search || url.hash) return ''
  return trimmed
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function jsonLd(site: SiteCopy, siteUrl: string): string {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: site.name,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript and a modern browser.',
    description: site.description,
    inLanguage: 'en',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: site.features.map((feature) => `${feature.title}: ${feature.body}`),
  }
  if (siteUrl) data.url = `${siteUrl}/`
  return JSON.stringify(data).replaceAll('<', '\\u003c')
}

function headTags(site: SiteCopy, siteUrl: string): string {
  const pageUrl = siteUrl ? `${siteUrl}/` : ''
  const lines = [
    `<title>${escapeHtml(site.title)}</title>`,
    `<meta name="description" content="${escapeHtml(site.description)}" />`,
    `<meta name="application-name" content="${escapeHtml(site.name)}" />`,
    `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large" />`,
    `<meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large" />`,
    `<meta name="bingbot" content="index, follow, max-snippet:-1, max-image-preview:large" />`,
    `<link rel="manifest" href="/manifest.webmanifest" />`,
    `<link rel="help" href="/llms.txt" type="text/plain" title="Summary for AI assistants" />`,
  ]
  if (pageUrl) {
    lines.push(`<link rel="canonical" href="${escapeHtml(pageUrl)}" />`)
    lines.push(`<meta property="og:url" content="${escapeHtml(pageUrl)}" />`)
  }
  lines.push(
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(site.name)}" />`,
    `<meta property="og:title" content="${escapeHtml(site.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(site.description)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeHtml(site.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(site.description)}" />`,
    `<script type="application/ld+json">${jsonLd(site, siteUrl)}</script>`,
  )
  return lines.map((line) => `    ${line}`).join('\n')
}

function staticBody(site: SiteCopy): string {
  const limits = site.limits.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  const features = site.features
    .map(
      (feature) =>
        `<li><h3>${escapeHtml(feature.title)}</h3><p>${escapeHtml(feature.body)}</p></li>`,
    )
    .join('')
  return `<main class="drop-screen seo-fallback">
      <div class="drop-card">
        <p class="brand-word">${escapeHtml(site.name)}</p>
        <p class="eyebrow">${escapeHtml(site.tagline)}</p>
        <h1>${escapeHtml(site.headline)}</h1>
        <p class="lead">${escapeHtml(site.lead)}</p>
        <ul class="limits">${limits}</ul>
      </div>
      <section class="about" aria-labelledby="capabilities">
        <h2 id="capabilities">${escapeHtml(site.featuresHeading)}</h2>
        <ul class="features">${features}</ul>
      </section>
    </main>`
}

export function robotsTxt(siteUrl: string): string {
  const agents = AI_AGENTS.map((name) => `User-agent: ${name}`).join('\n')
  const sitemap = siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''
  return `User-agent: *
Allow: /

# Search crawlers are covered above. These agents are allowed so answer
# engines can read the public page. Remove a block if you do not want that
# product to use the site.
${agents}
Allow: /
${sitemap}`
}

export function llmsTxt(site: SiteCopy, siteUrl: string): string {
  const home = siteUrl ? `${siteUrl}/` : '/'
  const features = site.features.map((feature) => `- ${feature.title}: ${feature.body}`).join('\n')
  const limits = site.limits.map((item) => `- ${item}`).join('\n')
  return `# ${site.name}

> ${site.description}

${site.name} is a free web application for editing a PDF in the browser. It does not require an account. The document is opened locally in the tab and is not sent to a server.

## What it can do

${features}

## Limits

${limits}

## Pages

- [${site.name}](${home}): Open the editor
`
}

export function sitemapXml(siteUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeHtml(siteUrl)}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`
}

export function manifestJson(site: SiteCopy): string {
  return JSON.stringify(
    {
      name: site.name,
      short_name: site.name,
      description: site.description,
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#e7e2d8',
      theme_color: '#24211d',
      lang: 'en',
      icons: [
        {
          src: '/favicon.svg',
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any',
        },
      ],
    },
    null,
    2,
  )
}

function send(res: ServerResponse, type: string, body: string) {
  res.statusCode = 200
  res.setHeader('Content-Type', type)
  res.end(body)
}

function serveSeo(req: IncomingMessage, res: ServerResponse, siteUrl: string): boolean {
  const url = req.url?.split('?')[0]
  const site = loadSite()
  if (url === '/robots.txt') {
    send(res, 'text/plain; charset=utf-8', robotsTxt(siteUrl))
    return true
  }
  if (url === '/llms.txt') {
    send(res, 'text/plain; charset=utf-8', llmsTxt(site, siteUrl))
    return true
  }
  if (url === '/sitemap.xml') {
    if (!siteUrl) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Set VITE_SITE_URL to publish the sitemap.\n')
      return true
    }
    send(res, 'application/xml; charset=utf-8', sitemapXml(siteUrl))
    return true
  }
  if (url === '/manifest.webmanifest') {
    send(res, 'application/manifest+json; charset=utf-8', manifestJson(site))
    return true
  }
  return false
}

export function seoPlugin(siteUrl: string): Plugin {
  let outDir = ''
  const site = loadSite()

  return {
    name: 'seo',
    configResolved(config) {
      outDir = config.build.outDir
    },
    transformIndexHtml(html) {
      return html
        .replace('<!--seo-head-->', headTags(site, siteUrl))
        .replace('<!--seo-body-->', staticBody(site))
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (serveSeo(req, res, siteUrl)) return
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (serveSeo(req, res, siteUrl)) return
        next()
      })
    },
    closeBundle() {
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, 'robots.txt'), robotsTxt(siteUrl))
      fs.writeFileSync(path.join(outDir, 'llms.txt'), llmsTxt(site, siteUrl))
      fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), manifestJson(site))
      if (siteUrl) fs.writeFileSync(path.join(outDir, 'sitemap.xml'), sitemapXml(siteUrl))
    },
  }
}
