// Subora blog generator. Called from tools/build-pages.mjs (run: node tools/build-pages.mjs).
// Posts live in tools/blog/posts/*.mjs. Each file exports one post object (see the two examples).
// Output: blog/index.html, blog/<slug>.html, blog/feed.xml. Image per post: assets/blog/<slug>.png (1200x630).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function buildBlog(ctx) {
  const { ROOT, SITE, ORG, WEBSITE, ld, header, footer, esc, attr, typo, fullTitle, warn, cta } = ctx;
  const POSTS_DIR = path.join(ROOT, 'tools/blog/posts');
  const OUT = path.join(ROOT, 'blog');
  fs.mkdirSync(OUT, { recursive: true });

  const posts = [];
  for (const f of fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(POSTS_DIR, f)).href);
    posts.push(mod.default);
  }
  posts.sort((a, b) => (b.date + b.slug).localeCompare(a.date + a.slug));

  const longDate = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const textOf = h => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const AUTHOR = { '@type': 'Organization', '@id': SITE + '/#editorial', name: 'Subora Editorial Team', url: SITE + '/about', parentOrganization: { '@id': SITE + '/#organization' } };

  const head = ({ title, desc, url, type = 'website', image, extra = '', graph }) => `<!doctype html>
<html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#d1fe17">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="Subora blog" href="${SITE}/blog/feed.xml">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="Subora"><meta property="og:locale" content="en_NG">
<meta property="og:url" content="${url}"><meta property="og:title" content="${attr(title)}"><meta property="og:description" content="${attr(desc)}">
<meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
${extra}<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${attr(title)}"><meta name="twitter:description" content="${attr(desc)}"><meta name="twitter:image" content="${image}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Manrope:wght@800&display=swap">
<link rel="stylesheet" href="/assets/site.css">
${ld(...graph)}
</head><body>
`;
  const tail = `\n${footer()}\n<script src="/assets/chat-widget.js" defer></script>\n</body></html>\n`;

  /* ---------- one post ---------- */
  const rendered = [];
  for (const p of posts) {
    for (const k of ['slug', 'title', 'h1', 'desc', 'date', 'updated', 'category', 'lede', 'tldr', 'body', 'faq', 'sources', 'editorial', 'imageAlt']) if (!p[k]) throw new Error(`Post ${p.slug || '?'} is missing "${k}"`);
    const url = `${SITE}/blog/${p.slug}`;
    const img = `${SITE}/assets/blog/${p.slug}.png`;
    const words = textOf(p.body + p.faq.map(q => q.join(' ')).join(' ') + p.tldr.join(' ') + p.lede).split(' ').length;
    const mins = Math.max(1, Math.round(words / 220));
    const t = fullTitle(p.title);
    if (p.desc.length > 160) warn.push(`blog/${p.slug}: meta description is ${p.desc.length} characters (aim for 155 or fewer).`);
    if (t.length > 62) warn.push(`blog/${p.slug}: title is ${t.length} characters (aim for 60 or fewer).`);

    // every footnote marker in the text must point at a real source, and every source must be used
    const used = new Set([...p.body.matchAll(/href="#src-(\d+)"/g)].map(m => +m[1]));
    for (const n of used) if (!p.sources.find(s => s.id === n)) throw new Error(`${p.slug}: text cites [${n}] but there is no source ${n}`);
    for (const s of p.sources) if (!used.has(s.id)) warn.push(`blog/${p.slug}: source [${s.id}] is listed but never cited in the text.`);

    const h2s = [...p.body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)];
    if (h2s.length < 4) warn.push(`blog/${p.slug}: only ${h2s.length} sections with ids; the table of contents will be thin.`);
    const toc = h2s.map(m => `<li><a href="#${m[1]}">${textOf(m[2])}</a></li>`).join('') + `<li><a href="#faq">Frequently asked questions</a></li><li><a href="#sources">Sources</a></li>`;

    const faq = p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('');
    const sources = p.sources.map(s => `<li id="src-${s.id}">${s.internal ? `<a href="${s.url}">${esc(s.title)}</a>` : `<a href="${s.url}" rel="noopener" target="_blank">${esc(s.title)}</a>`}<span class="src-meta"> ${esc(s.publisher)}${s.date ? ', ' + esc(s.date) : ''}. ${esc(s.note || '')}</span></li>`).join('');
    const related = posts.filter(o => o.slug !== p.slug).map(o => `<li><a href="/blog/${o.slug}">${esc(o.h1)}</a></li>`).join('');

    const graph = [ORG, WEBSITE, AUTHOR,
      { '@type': 'BlogPosting', '@id': url + '#post', mainEntityOfPage: { '@type': 'WebPage', '@id': url }, url, headline: typo(p.h1).slice(0, 110), alternativeHeadline: typo(p.title), description: typo(p.desc),
        image: [{ '@type': 'ImageObject', url: img, width: 1200, height: 630 }], datePublished: p.date, dateModified: p.updated, inLanguage: 'en-NG', isAccessibleForFree: true,
        author: { '@id': SITE + '/#editorial' }, publisher: { '@id': SITE + '/#organization' }, isPartOf: { '@id': SITE + '/blog#blog' }, articleSection: p.category, keywords: (p.keywords || []).join(', '), wordCount: words,
        about: (p.about || []).map(a => ({ '@type': 'Thing', name: a })), citation: p.sources.filter(s => !s.internal).map(s => ({ '@type': 'CreativeWork', name: s.title, url: s.url, publisher: { '@type': 'Organization', name: s.publisher } })) },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE + '/blog' }, { '@type': 'ListItem', position: 3, name: typo(p.h1), item: url }] }];

    const html = head({ title: t, desc: p.desc, url, type: 'article', image: img, graph,
      extra: `<meta property="article:published_time" content="${p.date}T08:00:00+01:00"><meta property="article:modified_time" content="${p.updated}T08:00:00+01:00"><meta property="article:section" content="${attr(p.category)}"><meta property="article:author" content="Subora Editorial Team">\n` }) +
`${header('/blog')}
<main id="main" class="page"><div class="wrap"><article class="post page-in">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/blog">Blog</a> / <span>${esc(p.category)}</span></nav>
<p class="kicker">${esc(p.category)}</p>
<h1>${esc(p.h1)}</h1>
<p class="lede">${p.lede}</p>
<p class="byline">By <a href="/about">Subora Editorial Team</a> · Published <time datetime="${p.date}">${longDate(p.date)}</time> · Updated <time datetime="${p.updated}">${longDate(p.updated)}</time> · ${mins} min read</p>
<aside class="takeaways" aria-labelledby="kt"><h2 id="kt">Key takeaways</h2><ul>${p.tldr.map(x => `<li>${x}</li>`).join('')}</ul></aside>
<nav class="toc" aria-label="In this article"><h2>In this article</h2><ol>${toc}</ol></nav>
<div class="post-body">${p.body}</div>
<section class="faq" aria-labelledby="faq"><h2 id="faq">Frequently asked questions</h2>${faq}</section>
<section class="sources" aria-labelledby="sources"><h2 id="sources">Sources</h2><p class="muted">Links open the original page. Figures and prices change, so check the source before you act on them.</p><ol>${sources}</ol></section>
<aside class="note editorial"><p>${p.editorial}</p></aside>
${related ? `<section class="more" aria-labelledby="more"><h2 id="more">Keep reading</h2><ul>${related}</ul></section>` : ''}
${cta(p.ctaTitle || 'Buy digital access with escrow', p.ctaText || 'Browse listings in naira. Your payment is held until you confirm that your access works.')}
</article></div></main>${tail}`;
    fs.writeFileSync(path.join(OUT, p.slug + '.html'), html);
    rendered.push({ p, url, words, mins, titleLen: t.length });
  }

  /* ---------- blog index ---------- */
  const bUrl = SITE + '/blog';
  const bTitle = 'Subora Blog: Digital Subscription and Safety Guides';
  const bDesc = 'Practical guides for Nigerians on paying for dollar subscriptions, avoiding digital scams, and buying and selling digital access safely.';
  const cards = rendered.map(({ p, mins }) => `<article class="card-post"><p class="kicker">${esc(p.category)}</p><h2><a href="/blog/${p.slug}">${esc(p.h1)}</a></h2><p>${esc(p.desc)}</p><p class="byline"><time datetime="${p.date}">${longDate(p.date)}</time> · ${mins} min read</p></article>`).join('');
  const indexGraph = [ORG, WEBSITE, AUTHOR,
    { '@type': 'Blog', '@id': bUrl + '#blog', url: bUrl, name: 'Subora Blog', description: bDesc, inLanguage: 'en-NG', publisher: { '@id': SITE + '/#organization' }, isPartOf: { '@id': SITE + '/#website' },
      blogPost: rendered.map(({ p, url }) => ({ '@type': 'BlogPosting', '@id': url + '#post', headline: typo(p.h1), url, datePublished: p.date, dateModified: p.updated, author: { '@id': SITE + '/#editorial' } })) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: 'Blog', item: bUrl }] }];
  fs.writeFileSync(path.join(OUT, 'index.html'), head({ title: bTitle, desc: bDesc, url: bUrl, image: SITE + '/og-image.png', graph: indexGraph }) +
`${header('/blog')}
<main id="main" class="page"><div class="wrap"><div class="page-in"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <span>Blog</span></nav>
<h1>The Subora blog</h1><p class="lede">Plain-English guides for buying and selling digital access in Nigeria: how to pay for dollar subscriptions, how to spot scams, and how escrow keeps your money safe.</p>
<div class="post-list">${cards}</div>
${cta()}
</div></div></main>${tail}`);

  /* ---------- RSS ---------- */
  const rssDate = d => new Date(d + 'T08:00:00+01:00').toUTCString();
  fs.writeFileSync(path.join(OUT, 'feed.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Subora Blog</title><link>${bUrl}</link><description>${attr(bDesc)}</description><language>en-NG</language><atom:link href="${SITE}/blog/feed.xml" rel="self" type="application/rss+xml"/>
${rendered.map(({ p, url }) => `<item><title>${attr(typo(p.h1))}</title><link>${url}</link><guid isPermaLink="true">${url}</guid><pubDate>${rssDate(p.date)}</pubDate><description>${attr(typo(p.desc))}</description></item>`).join('\n')}
</channel></rss>\n`);

  const urls = [[bUrl, rendered.map(r => r.p.updated).sort().pop()], ...rendered.map(({ p, url }) => [url, p.updated])];
  return { rendered, urls };
}
