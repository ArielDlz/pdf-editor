# NextPDF

NextPDF is a free PDF editor that runs in the browser. The file stays on the device and is never uploaded. You can replace text on pages that already have a text layer, highlight, draw, place images, sign, cut a region, rotate or delete pages, and download the result.

## Develop

```bash
npm install
npm run dev
```

## Search and assistant discovery

Set the public origin before a production build so the canonical URL, Open Graph URL, and sitemap use the real address:

```bash
# .env
VITE_SITE_URL=https://your-domain.example
```

The build writes `robots.txt`, `llms.txt`, `manifest.webmanifest`, and, when that variable is set, `sitemap.xml`. After deploy, submit the sitemap in Google Search Console and Bing Webmaster Tools. Yahoo search uses Bing's index.

`/llms.txt` is a short plain-text summary for AI assistants. The same facts are in the page copy and in JSON-LD on the home page.
