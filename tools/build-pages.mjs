// Subora static page generator. Run from the project root:  node tools/build-pages.mjs
// Reads your app's own FAQ, terms, privacy and refund text out of index.html, so the pages never drift from the app.
// Fill tools/site.config.json (email, phone, location, business name) and run again. Empty fields are left out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/site.config.json'), 'utf8'));
const SITE = CFG.site_url.replace(/\/$/, '');
const INDEX = path.join(ROOT, 'index.html');
let idx = fs.readFileSync(INDEX, 'utf8');
const warn = [];

/* ---------- pull real copy out of the app ---------- */
function grab(src, at) {
  let d = 0, q = null;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '[') d++;
    else if (c === ']' && --d === 0) return src.slice(at, i + 1);
  }
  throw new Error('Unbalanced array in index.html');
}
const N = n => '₦' + Math.round(n).toLocaleString('en-NG');
function arr(marker, { before } = {}) {
  let p = before ? idx.indexOf(before) : idx.indexOf(marker);
  if (p < 0) throw new Error('Could not find ' + (before || marker) + ' in index.html');
  if (before) p = idx.lastIndexOf(marker, p);
  const at = idx.indexOf('[', p + marker.length - 1);
  const txt = grab(idx, at);
  return new Function('FEE', 'N', 'WFEE', 'S', 'SUBORA_CONFIG', 'return ' + txt)(0.1, N, 100, { levy: { amount: 2000 } }, { SUPPORT_EMAIL: CFG.support_email });
}
const HELP = arr('const HELP=[');
const FAQ_BASICS = arr('const faq=[');
const TERMS = arr('const sec=[', { before: "head('Terms and Conditions')" });
const PRIVACY = arr('const sec=[', { before: "head('Privacy Policy')" });
const REFUNDS = arr('const sec=[', { before: "head('Refund policy')" });
if (TERMS.length < 8 || PRIVACY.length < 6 || REFUNDS.length < 5 || HELP.length < 6) throw new Error('Extraction looks wrong; check index.html');

/* ---------- helpers ---------- */
const typo = s => String(s).replace(/(\w)'(\w)/g, '$1’$2').replace(/(\w)'(?=[\s.,;:!?)]|$)/g, '$1’');
const esc = s => typo(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const has = v => v && String(v).trim();
const date = new Date(CFG.updated + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fullTitle = t => (t.length + 9 <= 60 ? t + ' | Subora' : t);

const MARK = `<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#0e1f10"/><rect x=".75" y=".75" width="30.5" height="30.5" rx="8.4" fill="none" stroke="#d1fe17" stroke-opacity=".35" stroke-width="1.5"/><path d="M21.6 8.4A5.4 5.4 0 1 0 16 16.2" fill="none" stroke="#d1fe17" stroke-width="3.8" stroke-linecap="round"/><path d="M16 16.2A5.4 5.4 0 1 1 10.4 23.6" fill="none" stroke="#fff" stroke-width="3.8" stroke-linecap="round"/><circle cx="23.4" cy="6.6" r="1.7" fill="#d1fe17"/></svg>`;
fs.writeFileSync(path.join(ROOT, 'favicon.svg'), MARK.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(' width="32" height="32" aria-hidden="true"', ''));
fs.writeFileSync(path.join(ROOT, 'logo.svg'), fs.readFileSync(path.join(ROOT, 'favicon.svg'), 'utf8'));
let LOGO = '/logo.svg';
if (fs.existsSync(path.join(ROOT, 'logo.png'))) LOGO = '/logo.png';
else warn.push('logo.png is missing (Google prefers a PNG). Schema uses logo.svg instead.');

/* ---------- shared content blocks (the landing page copy, reused on every page) ---------- */
const CTA_SIGNUP = '/signup', CTA_LOGIN = '/login', CTA_SELL = '/sell';
const B = {
  what: `<h2>What is Subora?</h2>
<p>Many digital tools are priced for one person but can be shared safely between a few. Subora lets approved vendors sell those spare places, along with courses, templates and other digital goods, at a fraction of the usual price.</p>
<p>You pay from a wallet you fund yourself. Your money is held by Subora until you confirm that what you bought works. Only then is the vendor paid. It is the safety of a shop, with the prices of a shared plan. Anyone can browse the marketplace, and you only need an account to buy.</p>`,
  find: `<h2>What can I buy on Subora?</h2>
<p>Listings fall into a few simple groups. Prices are shown in Nigerian naira (₦).</p>
<ul><li><b>AI assistants.</b> A private place on plans for chat, writing and image tools.</li><li><b>Streaming and music.</b> One screen or one seat on a family or premium plan.</li><li><b>Design and software.</b> Team seats for tools used at work and school.</li><li><b>Courses and templates.</b> Recorded lessons, project files, templates and content packs.</li><li><b>Accounts and numbers.</b> Aged social accounts and virtual numbers, with extra checks on every seller.</li></ul>`,
  steps: `<h2>How does buying on Subora work?</h2>
<ol class="steps"><li><b>Browse, then create a free account.</b> Anyone can look through listings and compare prices. When you are ready to buy, sign up with your email and phone number and confirm with a one-time code.</li><li><b>Fund your wallet.</b> Add money by card, bank transfer or USSD. It is credited when the payment is confirmed.</li><li><b>Pick a listing and read the vendor’s terms.</b> Each vendor states what you get and the rules of use. You accept them before you pay.</li><li><b>Pay into escrow.</b> Your money is held, not sent. Your access appears on your subscription card.</li><li><b>Confirm it works.</b> The vendor is paid once you confirm, or after 48 hours with no problem reported.</li></ol>`,
  safe: `<h2>How does Subora keep my money safe?</h2>
<p>Safety is built into every order, not added afterwards.</p>
<ul><li><b>Escrow.</b> Vendors never hold your money while you are checking access.</li><li><b>Refunds.</b> If access breaks, report it from the card. A refund can be full or for the days you did not use.</li><li><b>Disputes with a record.</b> If you and a vendor disagree, Subora decides using the full chat and payment record, and writes down the reason.</li><li><b>Permanent history.</b> Chats, payments and disputes cannot be edited or deleted by anyone, so every problem can be traced.</li></ul>
<p><a href="/safety">Read the full safety guide</a></p>`,
  access: `<h2>How do I get my login or code?</h2>
<p>Many listings deliver automatically. A sign-in code or an access link arrives on your card within seconds, with no need to wait for the vendor. If you need a person, you can chat with the vendor before and after you buy. If they are away, you can send an urgent nudge by SMS and email, and Subora support steps in if there is still no reply.</p>`,
  sellers: `<h2>Who sells on Subora?</h2>
<p>Vendors are few and approved by hand. They give their identity documents and bank details before they can sell, and every listing is reviewed before it goes live. Sellers are easy to tell apart by their tick: a blue tick marks a verified vendor who passed our identity checks, and a gold tick marks a listing sold directly by Subora.</p>`,
  cost: `<h2>What does Subora cost?</h2>
<p>Creating an account and buying are free. You pay only the price on the listing, from your wallet. Vendors pay a 10% fee on each sale and a small flat fee on each withdrawal, which keeps the marketplace running and funds the checks above.</p>`
};
const faqDetails = list => `<div class="faq">${list.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>`;
const cta = (h = 'Ready to see what is inside?', p = 'Browse listings and compare prices now. Create a free account when you are ready to buy or chat with vendors.') =>
  `<aside class="cta"><div><h2>${h}</h2><p>${p}</p></div><div class="row"><a class="btn dark" href="/store">Browse the marketplace</a><a class="btn" href="${CTA_SIGNUP}">Create free account</a></div></aside>`;

/* ---------- organisation data (only what you filled in) ---------- */
const sameAs = Object.values(CFG.social || {}).filter(has);
const ORG = {
  '@type': 'Organization', '@id': SITE + '/#organization', name: 'Subora', url: SITE + '/', logo: SITE + LOGO,
  description: 'Subora is a Nigerian marketplace for shared subscriptions, online courses, software seats and digital goods, with escrow on every order.',
  areaServed: 'NG', ...(has(CFG.business_name) ? { legalName: CFG.business_name } : {}),
  ...(sameAs.length ? { sameAs } : {}),
  ...((has(CFG.support_email) || has(CFG.phone)) ? { contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', areaServed: 'NG', availableLanguage: 'English', ...(has(CFG.support_email) ? { email: CFG.support_email } : {}), ...(has(CFG.phone) ? { telephone: CFG.phone } : {}), hoursAvailable: { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: '08:00', closes: '22:00' } } } : {}),
  ...(has(CFG.city_state) ? { address: { '@type': 'PostalAddress', addressLocality: CFG.city_state, addressCountry: 'NG' } } : {})
};
const WEBSITE = { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: 'Subora', publisher: { '@id': SITE + '/#organization' }, inLanguage: 'en-NG' };
const ld = (...nodes) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c')}</script>`;
const plain = h => typo(h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());

/* ---------- page definitions ---------- */
const emailLine = has(CFG.support_email) ? `<a href="mailto:${attr(CFG.support_email)}">${esc(CFG.support_email)}</a>` : '';
const company = [has(CFG.business_name) && `Subora is operated by ${esc(CFG.business_name)}${has(CFG.registration_number) ? ` (registration number ${esc(CFG.registration_number)})` : ''}.`, has(CFG.city_state) && `We are based in ${esc(CFG.city_state)}, Nigeria.`].filter(Boolean).join(' ');
if (!company) warn.push('About page: no business name or location yet (site.config.json). The "Who runs Subora?" section is left out.');
if (!has(CFG.support_email)) warn.push('No support_email set: the Contact page has no email, and the privacy policy contact line points to in-app chat.');
if (!has(CFG.phone) && !has(CFG.whatsapp)) warn.push('No phone or WhatsApp number set: the Contact page lists chat and email only.');
if (!sameAs.length) warn.push('No social profile links set: Organization schema has no sameAs.');

const pages = [
  {
    slug: 'about', type: 'AboutPage', title: 'About Subora: a safer way to share digital access',
    desc: 'Subora is a Nigerian marketplace for shared subscriptions, online courses, software seats and digital goods, with escrow on every order.',
    h1: 'About Subora',
    lede: 'Subora is a Nigerian marketplace where approved vendors sell shared subscriptions, online courses, software seats and other digital goods. Every payment is held in escrow until the buyer confirms that it works.',
    body: `${B.what}
<h2>Who is Subora for?</h2>
<p>Subora is for buyers in Nigeria who want the lower price of a shared plan without the risk of paying a stranger, and for vendors who want a trusted place to sell spare places and digital products. Everything is priced in naira, and you can fund your wallet by card, bank transfer or USSD.</p>
<h2>What does Subora stand for?</h2>
<ul><li><b>Escrow on every order.</b> Your payment is held until you confirm that your access works.</li><li><b>Vendors approved by hand.</b> Vendors give identity documents and bank details, and every listing is reviewed before it goes live.</li><li><b>Permanent records.</b> Chats, wallet entries and dispute statements cannot be edited or deleted, so any problem can be traced and settled fairly.</li><li><b>Plain fees.</b> Buying is free. Vendors pay a 10% fee on each sale and a flat ${N(100)} per withdrawal.</li></ul>
<h2>How does Subora make money?</h2>
<p>Subora charges vendors 10% of each sale and a flat ${N(100)} for each withdrawal to a bank, plus a monthly marketing levy that pays for adverts that bring buyers to the marketplace. Buyers pay only the price shown on the listing. The full wording is in the <a href="/terms">Terms and Conditions</a>.</p>
${company ? `<h2>Who runs Subora?</h2><p>${company}</p>` : ''}
<h2>Where to read next</h2>
<ul><li><a href="/how-it-works">How Subora works</a>, from funding your wallet to confirming delivery</li><li><a href="/safety">Buying safely on Subora</a>, including refunds and disputes</li><li><a href="/faq">Frequently asked questions</a></li><li><a href="/contact">Contact Subora</a></li></ul>
${cta()}`
  },
  {
    slug: 'how-it-works', type: 'WebPage', title: 'How Subora works: wallet, escrow and delivery',
    desc: 'Fund your wallet, pick a listing, pay into escrow and confirm your access works. See how buying and selling shared subscriptions on Subora works.',
    h1: 'How Subora works',
    lede: 'You fund a wallet, pick a listing, pay into escrow and confirm that your access works. The vendor is paid only after you confirm, or after 48 hours with no problem reported.',
    body: `${B.steps}
${B.access}
<h2>How do I fund my wallet?</h2>
<p>Tap Fund wallet and pay by card, bank transfer or USSD. Your wallet is credited when the payment is confirmed. You pay for everything on Subora from this wallet, which is why you cannot pay a vendor directly: payments outside Subora have no escrow, no refunds and no dispute help.</p>
<h2>Can I buy more than one month at once?</h2>
<p>Yes, on most subscriptions. You pick the plan length on the listing, and longer plans cost less per month.</p>
${B.find}
<h2>How do I sell on Subora?</h2>
<p>Vendors apply and are approved by hand. You give your identity documents and bank details, and each listing is reviewed before it goes live. Verified vendors unlock Pro tools. Sellers of gift cards, crypto and accounts need extra asset seller status. Vendors pay a 10% fee on each sale and a flat ${N(100)} per withdrawal, with a ${N(2000)} minimum withdrawal.</p>
<p><a class="btn pri" href="${CTA_SELL}">Apply to sell on Subora</a></p>
<p>Read <a href="/safety">how vendors are checked</a> and the full <a href="/terms">Terms and Conditions</a>.</p>
${cta()}`
  },
  {
    slug: 'safety', type: 'WebPage', title: 'Buying safely on Subora: escrow, refunds, disputes',
    desc: 'Subora holds every payment in escrow, approves vendors by hand and keeps a permanent record of chats and payments. See how refunds and disputes work.',
    h1: 'Buying safely on Subora',
    lede: 'Subora holds your payment in escrow, checks every vendor by hand, and keeps a permanent record of every chat, payment and dispute, so problems can be settled fairly.',
    pre: `<div class="facts"><div><b>Escrow</b><span>Your money is held until you confirm your access works</span></div><div><b>48 hours</b><span>For a vendor to answer a refund request</span></div><div><b>By hand</b><span>Every vendor is approved before they can sell</span></div><div><b>Permanent</b><span>Chats and payments cannot be edited or deleted</span></div></div>`,
    body: `<h2>How does escrow protect my money?</h2>
<p>When you pay, Subora holds the money instead of sending it to the vendor. The vendor is paid once you confirm that your login, code or link works, or after 48 hours if you have not reported a problem. While you are checking your access, the vendor never holds your money.</p>
<h2>What if my access stops working?</h2>
<p>Tap Report a problem on your subscription card. The vendor has 48 hours to respond, and your payment stays frozen in escrow while they do. A refund can be full, for the days you did not use, or a custom amount, and it goes back to your Subora wallet straight away. If you and the vendor disagree, Subora decides using the full chat and payment record, writes down the reason, and decides within 48 hours of both sides sharing their evidence. Read the full <a href="/refunds">refund policy</a>.</p>
<h2>How are vendors checked?</h2>
<p>Vendors apply and are approved by hand. They give identity documents, a selfie and bank details before they can sell, and every listing is reviewed before it goes live. Payouts only go to a bank account in the vendor’s own verified name.</p>
<p>A blue tick marks a verified vendor who passed these checks. A gold tick marks a listing sold directly by Subora.</p>
<h2>How are gift card, crypto, account and number sellers checked?</h2>
<p>These sellers carry more risk, so they have extra steps: identity verification, a video selfie, a proof of address and a ${N(100000)} security deposit. Confirmed claims give a seller strikes. Three confirmed claims pause their listings, five suspend the account, and fraud closes it and uses the deposit to repay buyers. Claim windows are short and clear:</p>
<ul><li><b>Gift cards:</b> report within 30 minutes of revealing the code, with a screenshot. The vendor has 2 hours to replace it or refund you, then Subora decides.</li><li><b>Crypto:</b> refunded in full if nothing arrives within 1 hour of payment, or if the wrong amount is sent.</li><li><b>OTP numbers:</b> refunded automatically if no SMS arrives within 20 minutes.</li><li><b>Accounts:</b> can be claimed within 24 hours of handover.</li></ul>
<h2>How do I avoid scams on Subora?</h2>
<ul><li>Pay only through Subora. Payments outside Subora have no escrow, no refunds and no dispute help.</li><li>Report any chat message that asks you to pay or talk outside Subora. Those messages are hidden and reviewed.</li><li>Subora staff never ask for your password, your codes or payment outside the app.</li><li>Turn on two-step verification in your profile, so a new device, a withdrawal or a bank change needs a code sent to your phone.</li></ul>
<h2>What are the third-party rules about shared accounts?</h2>
<p>Subora is a marketplace: we provide the place where buyers and vendors meet, and we do not own, supply or control what vendors list. Some services, such as streaming, AI and software providers, have their own rules about sharing accounts or reselling access, and some do not allow it. Each vendor is responsible for checking those rules before listing. A provider can also change or end access at any time, and the refund rules then apply. See section 9 of the <a href="/terms">Terms and Conditions</a>.</p>
<h2>I am a brand or rights holder. How do I report a listing?</h2>
<p>Send us a rights holder notice. We review notices within 24 hours and pause the listing while we check. See <a href="/contact">how to contact us</a>.</p>
${cta('Shop with escrow on every order', 'Browse listings and compare prices now. Create a free account when you are ready to buy or chat with vendors.')}`
  },
  {
    slug: 'faq', type: 'FAQPage', title: 'Subora FAQ: buying, wallet, refunds and security',
    desc: 'Answers to common questions about buying, funding your wallet, getting codes, refunds, disputes, account security and selling on Subora.',
    h1: 'Frequently asked questions',
    lede: 'Quick answers about buying, wallets, refunds, security and selling on Subora. If you cannot find yours, contact support.',
    groups: [['The basics', FAQ_BASICS], ...HELP.map(h => [h[0], h[2]])],
    body: null
  },
  {
    slug: 'contact', type: 'ContactPage', title: 'Contact Subora support',
    desc: 'Chat with Subora support every day from 8am to 10pm West Africa Time. Find contact details, response times and how to report a listing.',
    h1: 'Contact Subora',
    lede: `Chat with Subora support every day from 8am to 10pm West Africa Time. Chat replies usually come within 15 to 30 minutes in support hours${emailLine ? ', and email replies within 24 hours' : ''}.`,
    body: `<h2>How can I contact Subora?</h2>
<dl class="kv"><dt>Live chat</dt><dd>In the app, open the Help Centre and tap Chat with support</dd><dt>Hours</dt><dd>8am to 10pm West Africa Time, every day</dd><dt>Typical reply</dt><dd>Within 15 to 30 minutes in chat hours</dd><dt>Disputes</dt><dd>Decided within 48 hours of both sides sharing evidence</dd>${emailLine ? `<dt>Email</dt><dd>${emailLine}</dd>` : ''}${has(CFG.whatsapp) ? `<dt>WhatsApp</dt><dd><a href="https://wa.me/${attr(CFG.whatsapp.replace(/\D/g, ''))}">${esc(CFG.whatsapp)}</a></dd>` : ''}${has(CFG.phone) ? `<dt>Phone</dt><dd><a href="tel:${attr(CFG.phone.replace(/[^\d+]/g, ''))}">${esc(CFG.phone)}</a></dd>` : ''}${has(CFG.city_state) ? `<dt>Location</dt><dd>${esc(CFG.city_state)}, Nigeria</dd>` : ''}</dl>
<h2>What should I do if an order goes wrong?</h2>
<p>Tap Report a problem on the subscription card for that order. The vendor has 48 hours to respond and your payment stays in escrow meanwhile. If the vendor does not reply, tap Nudge vendor in the chat: they are alerted by SMS and email, and Subora support steps in if there is still no answer. See <a href="/safety">how refunds and disputes work</a>.</p>
<h2>I am a brand or rights holder. How do I report a listing?</h2>
<p>A service provider, brand or rights holder can ask us to remove a listing that breaks their rules or rights. We review notices within 24 hours and pause the listing while we check. ${emailLine ? `Email ${emailLine} with the brand name, the listing and what rule or right it breaks.` : 'Use the Rights holder notice form in the app with the brand name, the listing and what rule or right it breaks.'}</p>
<div class="note"><p>Subora staff never ask for your password, your codes or payment outside the app.</p></div>
${cta('New to Subora?', 'Browse listings and compare prices now. Create a free account when you are ready to buy or chat with vendors.')}`
  },
  {
    slug: 'terms', type: 'WebPage', title: 'Terms and Conditions',
    desc: 'The terms that apply to buyers and vendors on Subora: accounts, listings, escrow, fees, refunds, disputes and third-party rules.',
    h1: 'Terms and Conditions',
    lede: 'These terms explain how buyers and vendors use Subora, how escrow and fees work, and what each side is responsible for.',
    upd: true, sections: TERMS
  },
  {
    slug: 'privacy', type: 'WebPage', title: 'Privacy Policy',
    desc: 'What personal data Subora collects, why, who it is shared with, how long it is kept, and your rights under the Nigeria Data Protection Act 2023.',
    h1: 'Privacy Policy',
    lede: 'This policy explains what personal data Subora collects, why we use it, who we share it with, and the rights you have over it.',
    upd: true,
    sections: PRIVACY.map(([h, t]) => h === 'Contact' ? [h, has(CFG.support_email) ? t : 'Questions about your data: use Chat with support in the app.'] : [h, t])
  },
  {
    slug: 'refunds', type: 'WebPage', title: 'Refund policy',
    desc: 'How refunds work on Subora for subscriptions, courses, gift cards, crypto, accounts and OTP numbers, and how fast the money reaches your wallet.',
    h1: 'Refund policy',
    lede: 'If something you bought does not work, you can report it and get a full or prorated refund. This page shows the rules for each kind of listing.',
    upd: true,
    intro: `<h2>How do I get a refund?</h2><p>Tap Report a problem on the subscription card. The vendor has 48 hours to respond. If you disagree, Subora decides using the full record. Every refund is recorded in both wallets. Read more about <a href="/safety">refunds and disputes</a>.</p>`,
    sections: REFUNDS
  }
];

/* ---------- page rendering ---------- */
const NAV = [['/store', 'Marketplace'], ['/how-it-works', 'How it works'], ['/safety', 'Safety'], ['/faq', 'FAQ'], ['/about', 'About'], ['/contact', 'Contact']];
const header = cur => `<a class="skip" href="#main">Skip to content</a><header class="site-hdr"><div class="wrap"><a class="logo" href="/" aria-label="Subora home">${MARK}<span>Subora</span></a><nav aria-label="Main">${NAV.map(([h, l]) => `<a href="${h}"${cur === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav><div class="acts"><a class="btn sm" href="${CTA_LOGIN}">Log in</a><a class="btn sm pri" href="${CTA_SIGNUP}">Sign up</a></div></div></header>`;
const footer = () => `<footer class="site-ftr"><div class="wrap"><div class="fgrid"><div><a class="logo" href="/" aria-label="Subora home">${MARK}<span>Subora</span></a><p>Shared subscriptions, courses, software and digital products, with escrow on every order.</p>${has(CFG.business_name) ? `<p>${esc(CFG.business_name)}</p>` : ''}</div><div><h2>Learn</h2><ul><li><a href="/store">Marketplace</a></li><li><a href="/how-it-works">How it works</a></li><li><a href="/safety">Safety</a></li><li><a href="/faq">FAQ</a></li><li><a href="/about">About</a></li></ul></div><div><h2>Support</h2><ul><li><a href="/contact">Contact</a></li><li><a href="${CTA_SIGNUP}">Create an account</a></li><li><a href="${CTA_SELL}">Sell on Subora</a></li></ul></div><div><h2>Legal</h2><ul><li><a href="/terms">Terms and Conditions</a></li><li><a href="/privacy">Privacy Policy</a></li><li><a href="/refunds">Refund policy</a></li></ul></div></div><div class="fbase"><span>© 2026 Subora.</span><span>Prices are shown in Nigerian naira (₦)</span></div></div></footer>`;

function render(p) {
  const url = `${SITE}/${p.slug}`;
  let main;
  let qa = null;
  if (p.groups) {
    qa = p.groups.flatMap(g => g[1]);
    main = `<div class="chips" aria-label="Topics">${p.groups.map(g => `<a href="#${slug(g[0])}">${esc(g[0])}</a>`).join('')}</div>` +
      p.groups.map(g => `<h2 id="${slug(g[0])}">${esc(g[0])}</h2>${faqDetails(g[1])}`).join('') + cta('Still have a question?', 'Chat with support every day from 8am to 10pm West Africa Time.').replace(/<div class="row">.*?<\/div>/, `<div class="row"><a class="btn dark" href="/contact">Contact support</a></div>`);
  } else if (p.sections) {
    main = (p.intro || '') + p.sections.map(([h, t]) => `<h2>${esc(h)}</h2><p>${esc(t)}</p>`).join('') +
      `<p>See also: <a href="/terms">Terms</a>, <a href="/privacy">Privacy</a>, <a href="/refunds">Refunds</a>, <a href="/contact">Contact</a>.</p>`;
  } else main = p.body;
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <span>${esc(p.h1)}</span></nav>`;
  const graph = [ORG, WEBSITE,
    { '@type': p.type, '@id': url + '#page', url, name: p.h1, description: p.desc, inLanguage: 'en-NG', isPartOf: { '@id': SITE + '/#website' }, about: { '@id': SITE + '/#organization' },
      ...(qa ? { mainEntity: qa.map(([q, a]) => ({ '@type': 'Question', name: typo(q), acceptedAnswer: { '@type': 'Answer', text: typo(a) } })) } : {}) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' }, { '@type': 'ListItem', position: 2, name: p.h1, item: url }] }];
  const t = fullTitle(p.title);
  if (p.desc.length > 160) warn.push(`${p.slug}: meta description is ${p.desc.length} characters (aim for 155 or fewer).`);
  const html = `<!doctype html>
<html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(t)}</title>
<meta name="description" content="${attr(p.desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#d1fe17">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website"><meta property="og:site_name" content="Subora"><meta property="og:locale" content="en_NG">
<meta property="og:url" content="${url}"><meta property="og:title" content="${attr(t)}"><meta property="og:description" content="${attr(p.desc)}">
<meta property="og:image" content="${SITE}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${attr(t)}"><meta name="twitter:description" content="${attr(p.desc)}"><meta name="twitter:image" content="${SITE}/og-image.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Manrope:wght@800&display=swap">
<link rel="stylesheet" href="/assets/site.css">
${ld(...graph)}
</head><body>
${header('/' + p.slug)}
<main id="main" class="page"><div class="wrap"><div class="page-in">${crumbs}<h1>${esc(p.h1)}</h1><p class="lede">${esc(p.lede)}</p>${p.upd ? `<p class="upd">Last updated ${date}</p>` : ''}${p.pre || ''}${main}</div></div></main>
${footer()}
</body></html>
`;
  fs.writeFileSync(path.join(ROOT, p.slug + '.html'), html);
  const words = plain(html.split('<main')[1] || '').split(' ').length;
  return { slug: p.slug, words, title: t.length };
}
const report = pages.map(render);

/* ---------- knowledge.md: what the support chatbot knows (built from the public pages above) ---------- */
const toText = h => typo(h
  .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<div class="chips"[\s\S]*?<\/div>/g, '')
  .replace(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g, '\n**Q: $1**\nA: $2\n')
  .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/g, '\n# $1\n')
  .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, '\n## $1\n')
  .replace(/<li[^>]*>/g, '\n- ').replace(/<dt>/g, '\n- ').replace(/<\/dt>/g, ': ')
  .replace(/<\/(p|div|ul|ol|dl|aside|details)>/g, '\n')
  .replace(/<a [^>]*class="btn[^>]*>[\s\S]*?<\/a>/g, '')
  .replace(/<nav[\s\S]*?<\/nav>/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
const SUPPORT = has(CFG.support_email) ? CFG.support_email : '';
let KB = `# Subora knowledge base (generated ${CFG.updated}; do not edit by hand)\n\nSubora is a Nigerian marketplace for shared subscriptions, courses, software seats and digital goods, with escrow on every order. Prices are in naira (₦).\n\n## Contact and escalation\n- Human support: live chat in the app (Help Centre, then Chat with support), every day 8am to 10pm West Africa Time${SUPPORT ? `\n- Support email: ${SUPPORT}` : ''}\n- Typical reply: 15 to 30 minutes in chat hours${SUPPORT ? ', within 24 hours by email' : ''}\n\n## Site pages (link users with these paths)\n- /store marketplace, /login, /signup, /sell (apply to sell), /help (Help Centre), /account (buyer account), /vendor (vendor dashboard), /how-it-works, /safety, /faq, /about, /contact, /terms, /privacy, /refunds\n`;
for (const p of pages) {
  const html = fs.readFileSync(path.join(ROOT, p.slug + '.html'), 'utf8');
  const m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  if (!m) continue;
  KB += `\n\n---\n# PAGE /${p.slug}\n` + toText(m[1]).replace(/^# .*\n/, '').replace(/^See also:.*$/gm, '');
}
KB += '\n';
fs.writeFileSync(path.join(ROOT, 'knowledge.md'), KB);
console.log(`knowledge.md written: ${KB.length} characters (about ${Math.round(KB.length / 4)} tokens)`);

/* ---------- home page: head tags + crawlable shell inside #app ---------- */
const HOME_TITLE = 'Subora Marketplace: shared subscriptions with escrow';
const HOME_DESC = 'Subora marketplace for shared subscriptions, courses, software seats and digital goods in Nigeria. Every payment is held in escrow until you confirm.';
idx = idx.replace(/<title>[^<]*<\/title>/, `<title>${HOME_TITLE}</title>`)
  .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${HOME_DESC}">`);
const headBlock = `<!--SEO-HEAD-START-->
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
${ld(ORG, WEBSITE)}
<!--SEO-HEAD-END-->`;
if (idx.includes('<!--SEO-HEAD-START-->')) idx = idx.replace(/<!--SEO-HEAD-START-->[\s\S]*?<!--SEO-HEAD-END-->/, headBlock);
else idx = idx.replace('</head>', headBlock + '\n</head>');

const shellNav = NAV.map(([h, l]) => `<a href="${h}">${l}</a>`).join('');
const shell = `<!--SEO-SHELL-START-->
<div class="wrap land2" id="seo-shell"><nav aria-label="Main" style="display:flex;gap:14px;flex-wrap:wrap;padding:14px 0"><a href="/" style="font-weight:800">Subora</a>${shellNav}<a href="${CTA_LOGIN}">Log in</a><a href="${CTA_SIGNUP}">Sign up</a></nav>
<header class="lh"><h1>Subora marketplace: buy and share digital access, safely</h1><p class="lede">Subora is a marketplace for shared subscriptions, online courses, software seats and digital goods. This page explains how it works. Browse the marketplace without an account, and create a free account when you are ready to buy.</p><div class="lcta"><a class="btn pri lg" href="/store">Browse the marketplace</a> <a class="btn lg" href="${CTA_SIGNUP}">Create free account</a> <a class="btn lg" href="${CTA_LOGIN}">Log in</a></div></header>
<div class="larticle"><article class="lbody">${[B.what, B.find, B.steps, B.safe, B.access, B.sellers, B.cost].map(s => `<section>${s}</section>`).join('')}<section><h2>Questions</h2>${faqDetails(FAQ_BASICS)}<p><a href="/faq">See all questions</a></p></section></article></div>
<footer class="lsmall" style="padding:24px 0"><a href="/about">About</a> · <a href="/contact">Contact</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/refunds">Refunds</a></footer></div>
<!--SEO-SHELL-END-->`;
if (idx.includes('<!--SEO-SHELL-START-->')) idx = idx.replace(/<!--SEO-SHELL-START-->[\s\S]*?<!--SEO-SHELL-END-->/, shell);
else if (idx.includes('<div id="app" data-w="d"></div>')) idx = idx.replace('<div id="app" data-w="d"></div>', `<div id="app" data-w="d">${shell}</div>`);
else throw new Error('Could not find the empty #app container in index.html');
fs.writeFileSync(INDEX, idx);

/* ---------- sitemap.xml, robots.txt, 404.html ---------- */
const urls = [SITE + '/', SITE + '/store', ...pages.map(p => `${SITE}/${p.slug}`)];
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc><lastmod>${CFG.updated}</lastmod></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(ROOT, 'robots.txt'),
  `# Subora: public pages are open to search engines and AI crawlers.\nUser-agent: *\nAllow: /\nDisallow: /account/\nDisallow: /vendor/\nDisallow: /admin/\nDisallow: /case/\nDisallow: /knowledge.md\n\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(path.join(ROOT, '404.html'), `<!doctype html>
<html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Page not found | Subora</title>
<meta name="description" content="This page does not exist on Subora. Try the links below.">
<meta name="robots" content="noindex,follow">
<script>(function(){var p=location.pathname;if(/^[/](store|login|signup|sell|help|account|vendor|admin|case|listing|seller)([/]|$)/.test(p)){try{sessionStorage.setItem('subora_r',p+location.search+location.hash)}catch(e){}document.documentElement.style.visibility='hidden';location.replace('/')}})();</script>
<meta name="theme-color" content="#d1fe17">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Manrope:wght@800&display=swap">
<link rel="stylesheet" href="/assets/site.css">
</head><body>
${header('')}
<main id="main" class="page"><div class="wrap"><div class="page-in"><h1>Page not found</h1><p class="lede">That address does not exist on Subora. It may have moved, or the link may have a typo.</p>
<h2>Where would you like to go?</h2>
<ul><li><a href="/">Subora home</a></li><li><a href="/how-it-works">How Subora works</a></li><li><a href="/safety">Buying safely on Subora</a></li><li><a href="/faq">Frequently asked questions</a></li><li><a href="/contact">Contact Subora</a></li></ul>
<p><a class="btn pri" href="/">Back to home</a></p></div></div></main>
${footer()}
</body></html>
`);

console.log('Pages written:'); report.forEach(r => console.log(`  /${r.slug}  ${r.words} words, title ${r.title} chars`));
if (warn.length) { console.log('\nStill to fill in or check:'); warn.forEach(w => console.log('  - ' + w)); }
