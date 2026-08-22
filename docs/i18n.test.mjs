// Tests for the docs/ i18n layer. Run with either:
//   node --test docs/i18n.test.mjs
//   bun test docs/i18n.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const docs = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const I18N = require(join(docs, "i18n.js"));
const MARKET = require(join(docs, "market.js"));

const { LOCALES, CODES, chooseLocale, matchLocale, queryLocale, optionLabel, STORAGE_KEY } = I18N;

const indexHtml = readFileSync(join(docs, "index.html"), "utf8");
const i18nJs = readFileSync(join(docs, "i18n.js"), "utf8");
const marketJs = readFileSync(join(docs, "market.js"), "utf8");
const blogHtml = readFileSync(join(docs, "blog.html"), "utf8");
const blogJs = readFileSync(join(docs, "blog.js"), "utf8");
const blogCss = readFileSync(join(docs, "blog.css"), "utf8");
const bootstrapJs = readFileSync(join(docs, "i18n-bootstrap.js"), "utf8");
const faviconSvg = readFileSync(join(docs, "favicon.svg"), "utf8");
const blogPageFiles = ["blog.html", "incident-i1.html", "incident-i3.html", "incident-i5.html", "incident-i6.html"];
const readme = readFileSync(join(docs, "..", "README.md"), "utf8");
const spec = readFileSync(join(docs, "..", "spec", "SPEC.md"), "utf8");
const localeFiles = readdirSync(join(docs, "i18n")).filter((f) => f.endsWith(".json")).sort();
const dicts = Object.fromEntries(
  localeFiles.map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(docs, "i18n", f), "utf8"))])
);
const en = dicts.en;

// ---------- locale roster ----------

test("exactly 20 locales are declared and shipped", () => {
  assert.equal(LOCALES.length, 20);
  assert.equal(localeFiles.length, 20);
  assert.deepEqual(localeFiles.map((f) => f.replace(/\.json$/, "")).sort(), [...CODES].sort());
});

test("required locales present: en, ru, uk", () => {
  for (const code of ["en", "ru", "uk"]) {
    assert.ok(CODES.includes(code), `missing locale ${code}`);
    assert.ok(dicts[code], `missing locale file ${code}.json`);
  }
});

test("locale codes are unique lowercase language subtags", () => {
  assert.equal(new Set(CODES).size, 20);
  for (const code of CODES) assert.match(code, /^[a-z]{2,3}$/);
});

test("language switcher is alphabetically ordered by its visible abbreviation", () => {
  const abbrs = LOCALES.map((l) => l.abbr);
  assert.deepEqual(abbrs, [...abbrs].sort((a, b) => a.localeCompare(b, "en")));
});

test("switcher labels are unique 2–3 letter abbreviations (no flags)", () => {
  const abbrs = LOCALES.map((l) => l.abbr);
  assert.equal(new Set(abbrs).size, 20);
  for (const l of LOCALES) {
    assert.match(l.abbr, /^[A-Z]{2,3}$/, `bad abbr for ${l.code}: ${l.abbr}`);
  }
});

test("visible option content is the abbreviation ONLY; native name goes to aria-label", () => {
  for (const l of LOCALES) {
    const { visible, accessibleName } = optionLabel(l);
    assert.equal(visible, l.abbr, `visible label for ${l.code} must be the bare abbreviation`);
    assert.match(visible, /^[A-Z]{2,3}$/);
    assert.ok(accessibleName.includes(l.name), `accessible name for ${l.code} should carry the native name`);
  }
  // The runtime must render parts.visible as the option text and never render the
  // native name as visible content (aria-label/title only).
  assert.match(i18nJs, /abbr\.textContent = parts\.visible/);
  assert.match(i18nJs, /setAttribute\("aria-label", parts\.accessibleName\)/);
  assert.ok(!/className = "native"/.test(i18nJs), "no visible native-name span allowed");
});

test("every locale declares a text direction; Arabic is rtl", () => {
  for (const l of LOCALES) assert.ok(l.dir === "ltr" || l.dir === "rtl");
  assert.equal(LOCALES.find((l) => l.code === "ar").dir, "rtl");
});

// ---------- no flags anywhere ----------

test("no flag emoji in page, runtime, or any locale file", () => {
  // Regional-indicator pairs (🇺🇸 …), waving flags, and the tag-sequence flags.
  const flagRe = /[\u{1F1E6}-\u{1F1FF}\u{1F3F4}\u{1F6A9}]|\u{1F3F3}/u;
  const sources = { "index.html": indexHtml, "i18n.js": i18nJs };
  for (const [code, dict] of Object.entries(dicts)) sources[`${code}.json`] = JSON.stringify(dict);
  for (const [name, text] of Object.entries(sources)) {
    assert.ok(!flagRe.test(text), `flag emoji found in ${name}`);
  }
});

// ---------- locale parity + content preservation ----------

test("all locales have exactly the same keys as en, with non-empty string values", () => {
  const enKeys = Object.keys(en).sort();
  assert.ok(enKeys.length > 100, "en.json unexpectedly small");
  for (const [code, dict] of Object.entries(dicts)) {
    assert.deepEqual(Object.keys(dict).sort(), enKeys, `key mismatch in ${code}.json`);
    for (const [k, v] of Object.entries(dict)) {
      assert.equal(typeof v, "string", `${code}.json ${k} not a string`);
      assert.ok(v.trim().length > 0, `${code}.json ${k} empty`);
    }
  }
});

const tagCounts = (s) => {
  const counts = {};
  for (const m of s.matchAll(/<\/?([a-z][a-z0-9]*)\b/gi)) {
    const t = m[1].toLowerCase();
    counts[t] = (counts[t] || 0) + 1;
  }
  return counts;
};

test("inline markup (tags) is preserved in every translation", () => {
  for (const [code, dict] of Object.entries(dicts)) {
    if (code === "en") continue;
    for (const [k, enVal] of Object.entries(en)) {
      assert.deepEqual(tagCounts(dict[k]), tagCounts(enVal), `${code}.json ${k}: tag mismatch`);
    }
  }
});

test("links (hrefs) are preserved verbatim in every translation", () => {
  const hrefs = (s) => [...s.matchAll(/href="([^"]+)"/g)].map((m) => m[1]).sort();
  for (const [code, dict] of Object.entries(dicts)) {
    for (const [k, enVal] of Object.entries(en)) {
      assert.deepEqual(hrefs(dict[k]), hrefs(enVal), `${code}.json ${k}: href mismatch`);
    }
  }
});

test("dollar prices are preserved in every translation", () => {
  // Don't let sentence punctuation right after a price ("$280,") into the match.
  const prices = (s) => (s.match(/\$\d(?:[\d,.]*\d)?/g) || []).sort();
  for (const [code, dict] of Object.entries(dicts)) {
    for (const [k, enVal] of Object.entries(en)) {
      assert.deepEqual(prices(dict[k]), prices(enVal), `${code}.json ${k}: price mismatch`);
    }
  }
});

test("brand / technical tokens are preserved in every translation", () => {
  // Latin-script tokens that must survive translation untouched wherever en uses them.
  const tokens = ["samogrow", "Claude", "Telegram", "Kasa", "Tapo", "RTSP", "MIT",
    "Gardyn", "AeroGarden", "MasterBlend", "Barrina", "GitHub", "Wi-Fi", "DWC", "ppm"];
  const mayInflect = new Set(["Telegram", "Gardyn", "AeroGarden", "GitHub"]);
  for (const [code, dict] of Object.entries(dicts)) {
    if (code === "en") continue;
    for (const [k, enVal] of Object.entries(en)) {
      for (const tok of tokens) {
        const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Product names can take grammatical suffixes (e.g. Polish
        // "Telegramie"); immutable technical identifiers may not.
        const tokenRe = mayInflect.has(tok)
          ? new RegExp(escaped, "g")
          : new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g");
        const n = [...enVal.matchAll(tokenRe)].length;
        if (n === 0) continue;
        const got = [...dict[k].matchAll(tokenRe)].length;
        assert.ok(got >= n, `${code}.json ${k}: token "${tok}" missing (${got} < ${n})`);
      }
    }
    // Critical brands stay in the same semantic fields, even where the
    // surrounding language applies a grammatical prefix/suffix.
    assert.ok(dict["how.sub"].includes("Claude"), `${code}.json how.sub: Claude context lost`);
    assert.ok(dict["how.sub"].includes("Telegram"), `${code}.json how.sub: Telegram context lost`);
    assert.ok(dict["hero.lede"].includes("samogrow"), `${code}.json hero.lede: samogrow context lost`);
  }
});

test("locale HTML uses only the reviewed tags and attributes", () => {
  const allowedTags = new Set(["A", "B", "CODE", "EM", "I", "P", "SPAN"]);
  const allowedAttrs = {
    A: new Set(["href", "target", "rel"]),
    SPAN: new Set(["class"])
  };
  for (const [code, dict] of Object.entries(dicts)) {
    for (const [key, value] of Object.entries(dict)) {
      const fragment = JSDOM.fragment(value);
      for (const el of fragment.querySelectorAll("*")) {
        assert.ok(allowedTags.has(el.tagName), `${code}.${key}: disallowed <${el.tagName.toLowerCase()}>`);
        for (const attr of el.getAttributeNames()) {
          assert.ok(allowedAttrs[el.tagName]?.has(attr), `${code}.${key}: disallowed ${el.tagName}.${attr}`);
          assert.ok(!attr.toLowerCase().startsWith("on"), `${code}.${key}: event handler attribute`);
        }
        if (el.tagName === "A") {
          assert.match(el.getAttribute("href") || "", /^https:\/\//, `${code}.${key}: unsafe link`);
          assert.equal(el.getAttribute("target"), "_blank");
          assert.equal(el.getAttribute("rel"), "noopener");
        }
        if (el.tagName === "SPAN") assert.equal(el.getAttribute("class"), "code");
      }
    }
  }
});

// ---------- index.html wiring ----------

const usedKeys = new Set(
  [...indexHtml.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]).concat(
    [...indexHtml.matchAll(/data-i18n-attrs="([^"]+)"/g)].flatMap((m) =>
      m[1].split(",").map((p) => p.split(":")[1].trim())
    )
  )
);
for (const key of ["inc.title", "inc.eyebrow", "inc.sub", "inc.readmore"]) usedKeys.add(key);
for (const incident of ["i1", "i3", "i5", "i6"]) {
  for (const part of ["title", "summary", "story", "impact", "lesson", "alt", "cap"]) {
    usedKeys.add(`inc.${incident}.${part}`);
  }
}

test("every data-i18n key in index.html exists in en.json", () => {
  for (const k of usedKeys) assert.ok(k in en, `index.html references missing key ${k}`);
});

test("every en.json key is used by index.html or the JS runtime", () => {
  const jsApplied = new Set(["meta.title", "meta.description"]);
  for (const k of Object.keys(en)) {
    assert.ok(usedKeys.has(k) || jsApplied.has(k), `unused key ${k}`);
  }
});

test("shared bootstrap code list matches LOCALES and is loaded by every page", () => {
  const m = bootstrapJs.match(/var codes = \[([^\]]+)\]/);
  assert.ok(m, "bootstrap codes array not found");
  const bootCodes = m[1].split(",").map((s) => s.trim().replace(/"/g, ""));
  assert.deepEqual(bootCodes, CODES);
  for (const file of ["index.html", ...blogPageFiles]) {
    const html = file === "index.html" ? indexHtml : readFileSync(join(docs, file), "utf8");
    assert.match(html, /<script src="i18n-bootstrap\.js"><\/script>/, `${file} missing pre-paint bootstrap`);
  }
});

test("every page declares the local SVG favicon", () => {
  assert.match(faviconSvg, /^<svg\b/);
  assert.match(faviconSvg, /viewBox="0 0 64 64"/);
  for (const file of ["index.html", ...blogPageFiles]) {
    const html = file === "index.html" ? indexHtml : readFileSync(join(docs, file), "utf8");
    const dom = new JSDOM(html);
    const icon = dom.window.document.querySelector('link[rel="icon"]');
    assert.equal(icon?.getAttribute("href"), "favicon.svg", `${file} missing favicon href`);
    assert.equal(icon?.getAttribute("type"), "image/svg+xml", `${file} missing favicon MIME type`);
  }
});

test("English defaults baked into index.html match en.json (no drift)", () => {
  // Spot-check a few plain-text keys whose values appear verbatim in the HTML.
  for (const k of ["nav.cost", "spec.eyebrow", "how.title", "cost.title", "feat.title", "foot.gh"]) {
    assert.ok(indexHtml.includes(`>${en[k]}<`), `index.html default text drifted for ${k}`);
  }
});

test("metadata descriptions do not advertise stale fixed build prices", () => {
  const stale = /~?\$\s*(255|280|335)|\$3[\u2013-]7|~?\$35/;
  for (const [code, dict] of Object.entries(dicts)) {
    assert.doesNotMatch(dict["meta.description"], stale, `${code} metadata contains stale pricing`);
  }
  const staticDescription = new JSDOM(indexHtml).window.document.querySelector('meta[name="description"]').content;
  assert.equal(staticDescription, en["meta.description"]);
});

test("switcher markup is present, accessible, sticky-topbar hosted", () => {
  assert.match(indexHtml, /id="lang-switcher"/);
  assert.match(indexHtml, /aria-haspopup="listbox"/);
  assert.match(indexHtml, /aria-controls="lang-menu"/);
  assert.match(indexHtml, /role="listbox"/);
  assert.match(indexHtml, /data-i18n-attrs="aria-label:lang.switcher"/);
  // switcher lives inside the sticky topbar block
  const topbar = indexHtml.slice(indexHtml.indexOf('class="topbar"'), indexHtml.indexOf("<!-- HERO -->"));
  assert.ok(topbar.includes('id="lang-switcher"'), "switcher not inside topbar");
  assert.match(indexHtml, /\.topbar\s*\{\s*[^}]*position:\s*sticky/);
});

// ---------- selection / auto-detection logic ----------

test("manual stored choice overrides navigator languages", () => {
  assert.equal(chooseLocale("uk", ["de-DE", "de"]), "uk");
  assert.equal(chooseLocale("ru", ["en-US"]), "ru");
  assert.equal(chooseLocale("UK", ["de-DE"]), "uk");
  assert.equal(chooseLocale("pt-BR", ["de-DE"]), "pt");
});

test("invalid stored value is ignored", () => {
  assert.equal(chooseLocale("xx", ["fr-FR"]), "fr");
  assert.equal(chooseLocale("", ["it"]), "it");
  assert.equal(chooseLocale(null, ["ja-JP"]), "ja");
});

test("exact and regional-subtag matching", () => {
  assert.equal(matchLocale("uk"), "uk");
  assert.equal(matchLocale("uk-UA"), "uk");
  assert.equal(matchLocale("pt-BR"), "pt");
  assert.equal(matchLocale("zh-Hans-CN"), "zh");
  assert.equal(matchLocale("RU-ru"), "ru");
  assert.equal(matchLocale("xx-XX"), null);
  assert.equal(matchLocale(""), null);
});

test("first matching navigator language wins, in order", () => {
  assert.equal(chooseLocale(null, ["xx", "ko-KR", "fr-FR"]), "ko");
  assert.equal(chooseLocale(null, ["ar-EG", "en"]), "ar");
});

test("lang query parameter accepts exact and regional locale tags", () => {
  assert.equal(queryLocale("?lang=ru"), "ru");
  assert.equal(queryLocale("?campaign=launch&lang=pt-BR"), "pt");
  assert.equal(queryLocale("?lang=UK"), "uk");
  assert.equal(queryLocale("?lang=xx"), null);
  assert.equal(queryLocale(""), null);
});

test("falls back to English when nothing matches", () => {
  assert.equal(chooseLocale(null, ["eo", "tlh"]), "en");
  assert.equal(chooseLocale(null, []), "en");
  assert.equal(chooseLocale(undefined, undefined), "en");
});

test("persistence uses a stable storage key wired into the runtime", () => {
  assert.equal(STORAGE_KEY, "samogrow-lang");
  assert.match(i18nJs, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(bootstrapJs, /localStorage\.getItem\("samogrow-lang"\)/);
});

test("README documents URL-first locale precedence and a shareable example", () => {
  assert.match(readme, /Locale precedence is a shareable `\?lang=<code>` URL parameter/);
  assert.match(readme, /https:\/\/samogrow\.dev\/\?lang=uk#incidents/);
  assert.match(readme, /without reloading or losing other query parameters or the page anchor/);
  assert.match(readme, /pre-paint `codes` roster in `docs\/i18n-bootstrap\.js`/);
});

// ---------- executable browser-runtime coverage ----------

const minimalPage = (initial = "en") => `<!doctype html>
<html${initial === null ? "" : ` data-i18n-initial="${initial}"`} class="i18n-pending">
<head><title>English title</title><meta name="description" content="English description"></head>
<body>
  <button id="lang-btn" aria-expanded="false" aria-controls="lang-menu"><span id="lang-current">EN</span></button>
  <ul id="lang-menu" hidden></ul>
  <a data-lang-link href="blog.html">Blog</a>
  <a data-lang-link href="notes/post.html#evidence">Nested post</a>
  <a data-lang-link href="https://example.com/vendor">External vendor</a>
  <h2 data-i18n="sample">English sample</h2>
  <img data-i18n-attrs="alt:sample.alt,src:sample.src,constructor:sample.src" alt="English alt" src="safe.png">
</body></html>`;

const sampleDict = (code) => ({
  "meta.title": `${code} title`,
  "meta.description": `${code} description`,
  sample: `${code} sample`,
  "sample.alt": `${code} alt`,
  "sample.src": "javascript:alert(1)"
});

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function runtimeDom({ initial = "en", languages = ["en-US"], stored, storageThrows = false, fetchImpl,
  url = "https://samogrow.test/" } = {}) {
  const dom = new JSDOM(minimalPage(initial), {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  Object.defineProperty(dom.window.document, "readyState", { value: "complete", configurable: true });
  Object.defineProperty(dom.window.navigator, "languages", { value: languages, configurable: true });
  Object.defineProperty(dom.window.navigator, "language", { value: languages[0] || "en", configurable: true });
  if (storageThrows) {
    Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("storage disabled"); } });
  } else if (stored !== undefined) {
    dom.window.localStorage.setItem(STORAGE_KEY, stored);
  }
  dom.window.fetch = fetchImpl || (async (url) => {
    const code = /\/([a-z]{2,3})\.json$/.exec(url)?.[1] || "en";
    return { ok: true, json: async () => sampleDict(code) };
  });
  dom.window.console.warn = () => {};
  dom.window.eval(i18nJs);
  return dom;
}

test("switcher executes click and keyboard interactions with abbreviation-only options", async () => {
  const dom = runtimeDom();
  const { document, KeyboardEvent } = dom.window;
  const button = document.querySelector("#lang-btn");
  const menu = document.querySelector("#lang-menu");
  const options = [...menu.querySelectorAll("[role=option]")];
  assert.equal(options.length, 20);
  assert.deepEqual(options.map((option) => option.textContent), LOCALES.map((locale) => locale.abbr));

  button.click();
  assert.equal(menu.hidden, false);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement.dataset.code, "en");

  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.equal(document.activeElement.dataset.code, "es");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(document.activeElement.dataset.code, "zh");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  assert.equal(document.activeElement.dataset.code, "ar");
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, button);

  button.click();
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, button);

  button.click();
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(menu.hidden, true);
  assert.equal(document.activeElement, button);

  button.click();
  options.find((option) => option.dataset.code === "ru").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  );
  await flush();
  assert.equal(document.documentElement.lang, "ru");
  assert.equal(document.querySelector("#lang-current").textContent, "RU");
  assert.equal(dom.window.localStorage.getItem(STORAGE_KEY), "ru");
  assert.equal(dom.window.location.search, "?lang=ru");
  assert.equal(options.find((option) => option.dataset.code === "ru").getAttribute("aria-selected"), "true");
});

test("URL locale overrides stored and browser choices and is canonicalized", async () => {
  const dom = runtimeDom({
    initial: "de",
    stored: "fr",
    languages: ["es-ES"],
    url: "https://samogrow.test/?campaign=launch&lang=pt-BR#cost"
  });
  await flush();
  assert.equal(dom.window.document.documentElement.lang, "pt");
  assert.equal(dom.window.location.search, "?campaign=launch&lang=pt");
  assert.equal(dom.window.location.hash, "#cost");
  assert.equal(dom.window.localStorage.getItem(STORAGE_KEY), "fr", "URL selection must not overwrite the saved manual preference");
});

test("manual switch updates the shareable URL without dropping query parameters or hash", async () => {
  const dom = runtimeDom({ url: "https://samogrow.test/?ref=newsletter#incidents" });
  dom.window.document.querySelector('[data-code="uk"]').click();
  await flush();
  assert.equal(dom.window.location.search, "?ref=newsletter&lang=uk");
  assert.equal(dom.window.location.hash, "#incidents");
  assert.equal(dom.window.localStorage.getItem(STORAGE_KEY), "uk");
  const links = [...dom.window.document.querySelectorAll('a[data-lang-link]')].map((a) => a.getAttribute("href"));
  assert.deepEqual(links, ["/blog.html?lang=uk", "/notes/post.html?lang=uk#evidence", "https://example.com/vendor"]);
});

test("auto-detected locale is added to the URL for sharing", async () => {
  const dom = runtimeDom({ initial: null, languages: ["ru-RU"], url: "https://samogrow.test/#how" });
  await flush();
  assert.equal(dom.window.document.documentElement.lang, "ru");
  assert.equal(dom.window.location.search, "?lang=ru");
  assert.equal(dom.window.location.hash, "#how");
});

test("default English and invalid-query fallback are reflected in the share URL", async () => {
  const english = runtimeDom({ initial: null, languages: ["xx-ZZ"], url: "https://samogrow.test/#how" });
  await flush();
  assert.equal(english.window.document.documentElement.lang, "en");
  assert.equal(english.window.location.search, "?lang=en");
  assert.equal(english.window.location.hash, "#how");

  const stored = runtimeDom({ initial: null, stored: "fr", languages: ["es-ES"],
    url: "https://samogrow.test/?campaign=launch&lang=bogus#cost" });
  await flush();
  assert.equal(stored.window.document.documentElement.lang, "fr");
  assert.equal(stored.window.location.search, "?campaign=launch&lang=fr");
  assert.equal(stored.window.location.hash, "#cost");
});

test("runtime applies translated DOM, metadata, attributes, and RTL direction", async () => {
  const dom = runtimeDom({ initial: "ar" });
  await flush();
  const { document } = dom.window;
  assert.equal(document.documentElement.lang, "ar");
  assert.equal(document.documentElement.dir, "rtl");
  assert.equal(document.title, "ar title");
  assert.equal(document.querySelector('meta[name="description"]').content, "ar description");
  assert.equal(document.querySelector("[data-i18n=sample]").textContent, "ar sample");
  assert.equal(document.querySelector("img").alt, "ar alt");
  assert.equal(document.querySelector("img").getAttribute("src"), "safe.png", "src is not an allowed translated attribute");
  assert.equal(document.querySelector("img").getAttribute("constructor"), null, "prototype properties are not allowed attributes");
  assert.equal(document.documentElement.classList.contains("i18n-pending"), false);
});

test("failed fetch reveals English, does not persist the failed choice, and evicts the cache", async () => {
  let calls = 0;
  const dom = runtimeDom({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { ok: true, json: async () => sampleDict("ru") };
    }
  });
  const ru = dom.window.document.querySelector('[data-code="ru"]');
  ru.click();
  await flush();
  assert.equal(dom.window.document.documentElement.classList.contains("i18n-pending"), false);
  assert.equal(dom.window.localStorage.getItem(STORAGE_KEY), null);

  ru.click();
  await flush();
  assert.equal(calls, 2, "a rejected locale fetch must be evicted from the cache");
  assert.equal(dom.window.document.documentElement.lang, "ru");
  assert.equal(dom.window.localStorage.getItem(STORAGE_KEY), "ru");
});

test("failed manual switch preserves the last known-good saved preference", async () => {
  const dom = runtimeDom({
    initial: "ru",
    stored: "ru",
    fetchImpl: async (url) => {
      if (url.endsWith("/ar.json")) throw new Error("offline");
      return { ok: true, json: async () => sampleDict("ru") };
    }
  });
  await flush();
  dom.window.document.querySelector('[data-code="ar"]').click();
  await flush();
  assert.equal(dom.window.document.documentElement.lang, "ru");
  assert.equal(dom.window.localStorage.getItem(STORAGE_KEY), "ru");
});

test("non-ok locale response takes the same safe fallback path", async () => {
  const dom = runtimeDom({
    initial: "uk",
    url: "https://samogrow.test/?lang=uk#how",
    fetchImpl: async () => ({ ok: false, status: 404 })
  });
  await flush();
  assert.equal(dom.window.document.documentElement.lang, "");
  assert.equal(dom.window.document.querySelector("#lang-current").textContent, "EN");
  assert.equal(dom.window.document.documentElement.classList.contains("i18n-pending"), false);
  assert.equal(dom.window.location.search, "?lang=en", "failed locale must not leave a misleading share URL");
  assert.equal(dom.window.location.hash, "#how");
});

test("a stale fetch cannot overwrite a newer locale selection", async () => {
  const pending = {};
  const dom = runtimeDom({
    fetchImpl: (url) => new Promise((resolve) => { pending[/\/([a-z]+)\.json$/.exec(url)[1]] = resolve; })
  });
  const options = dom.window.document.querySelectorAll("[data-code]");
  [...options].find((option) => option.dataset.code === "ru").click();
  [...options].find((option) => option.dataset.code === "ar").click();

  pending.ar({ ok: true, json: async () => sampleDict("ar") });
  await flush();
  pending.ru({ ok: true, json: async () => sampleDict("ru") });
  await flush();
  assert.equal(dom.window.document.documentElement.lang, "ar");
  assert.equal(dom.window.document.documentElement.dir, "rtl");
  assert.equal(dom.window.localStorage.getItem(STORAGE_KEY), "ar");
});

test("disabled localStorage falls back to navigator language without throwing", async () => {
  const dom = runtimeDom({ initial: null, languages: ["uk-UA"], storageThrows: true });
  await flush();
  assert.equal(dom.window.document.documentElement.lang, "uk");
  assert.equal(dom.window.document.querySelector("#lang-current").textContent, "UK");
});

const bootstrapScript = bootstrapJs;

function runBootstrap({ stored, languages = ["en-US"], storageThrows = false,
  url = "https://samogrow.test/" } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url,
    runScripts: "outside-only"
  });
  Object.defineProperty(dom.window.navigator, "languages", { value: languages, configurable: true });
  Object.defineProperty(dom.window.navigator, "language", { value: languages[0] || "en", configurable: true });
  if (storageThrows) {
    Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("storage disabled"); } });
  } else if (stored !== undefined) {
    dom.window.localStorage.setItem(STORAGE_KEY, stored);
  }
  let timer, delay;
  dom.window.setTimeout = (callback, milliseconds) => {
    timer = callback;
    delay = milliseconds;
    return 1;
  };
  dom.window.eval(bootstrapScript);
  return { dom, timer, delay };
}

test("pre-paint bootstrap and runtime matcher choose the same locale", () => {
  const cases = [
    { stored: "UK", languages: ["de-DE"] },
    { stored: "pt-BR", languages: ["de-DE"] },
    { stored: "xx", languages: ["zh-Hans-CN", "en"] },
    { languages: ["xx", "ru-RU"] },
    { storageThrows: true, languages: ["uk-UA"] },
    { languages: ["eo"] }
  ];
  for (const sample of cases) {
    const { dom } = runBootstrap(sample);
    assert.equal(
      dom.window.document.documentElement.dataset.i18nInitial,
      chooseLocale(sample.stored, sample.languages)
    );
  }
});

test("pre-paint bootstrap gives ?lang= precedence over storage and browser settings", () => {
  const { dom } = runBootstrap({
    stored: "de",
    languages: ["fr-FR"],
    url: "https://samogrow.test/?lang=uk#incidents"
  });
  assert.equal(dom.window.document.documentElement.dataset.i18nInitial, "uk");
  assert.equal(dom.window.document.documentElement.classList.contains("i18n-pending"), true);
});

test("loading-document branch initializes once on DOMContentLoaded", async () => {
  const dom = new JSDOM(minimalPage("en"), {
    url: "https://samogrow.test/",
    runScripts: "outside-only"
  });
  Object.defineProperty(dom.window.document, "readyState", { value: "loading", configurable: true });
  dom.window.fetch = async () => ({ ok: true, json: async () => sampleDict("en") });
  dom.window.eval(i18nJs);
  assert.equal(dom.window.document.querySelectorAll("[role=option]").length, 0);
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await flush();
  assert.equal(dom.window.document.querySelectorAll("[role=option]").length, 20);
});

test("pre-paint bootstrap safety timer reveals baked-in English after 2000 ms", () => {
  const { dom, timer, delay } = runBootstrap({ languages: ["uk-UA"] });
  assert.equal(delay, 2000);
  assert.equal(dom.window.document.documentElement.classList.contains("i18n-pending"), true);
  timer();
  assert.equal(dom.window.document.documentElement.classList.contains("i18n-pending"), false);
  assert.equal(dom.window.__samogrowI18nTimer, null);
});

// ---------- incident blog ----------

const INCIDENTS = [
  { id: "I-1", date: "2026-07-13", sev: "SEV-2", file: "incident-i1.html", issue: "https://github.com/NikolayS/samogrow/issues/3",
    img: "img/incidents/2026-07-13-reservoir-128x10.jpeg", key: "i1" },
  { id: "I-3", date: "2026-07-24", sev: "SEV-3", file: "incident-i3.html", issue: "https://github.com/NikolayS/samogrow/issues/6",
    img: "img/incidents/2026-07-24-pest-frass-macro.jpeg", key: "i3" },
  { id: "I-5", date: "2026-08-12", sev: "SEV-3", file: "incident-i5.html", issue: "https://github.com/NikolayS/samogrow/issues/10",
    img: "img/incidents/2026-08-12-aphids-parsley.jpeg", key: "i5" },
  { id: "I-6", date: "2026-08-15", sev: "SEV-3", file: "incident-i6.html", issue: "https://github.com/NikolayS/samogrow/issues/11",
    img: "img/incidents/2026-08-18-neem-burn-basil.jpeg", key: "i6" },
];

function runBlog(file = "blog.html", url = `https://samogrow.test/${file}`) {
  const dom = new JSDOM(readFileSync(join(docs, file), "utf8"), { url, runScripts: "outside-only" });
  dom.window.eval(blogJs);
  return dom;
}

test("blog.js executes the index and renders four correctly wired cards", () => {
  const dom = runBlog();
  const cards = [...dom.window.document.querySelectorAll(".post-card")];
  assert.equal(cards.length, 4);
  for (const [index, inc] of INCIDENTS.entries()) {
    const card = cards[index];
    assert.equal(card.getAttribute("href"), inc.file);
    assert.equal(card.querySelector("img").getAttribute("src"), inc.img);
    assert.equal(card.querySelector("h2").dataset.i18n, `inc.${inc.key}.title`);
    assert.equal(card.querySelector("p").dataset.i18n, `inc.${inc.key}.summary`);
  }
  assert.equal(dom.window.document.querySelector('[data-i18n="inc.sub"]').textContent.trim(), en["inc.sub"]);
  assert.equal(dom.window.document.querySelector('[data-i18n="inc.eyebrow"]').textContent.trim(), en["inc.eyebrow"]);
});

test("blog.js executes every incident page and renders the selected post", () => {
  for (const inc of INCIDENTS) {
    const dom = runBlog(inc.file);
    const article = dom.window.document.querySelector("article.post");
    assert.ok(article, `${inc.file} did not render an article`);
    assert.equal(article.querySelector("h1").dataset.i18n, `inc.${inc.key}.title`);
    assert.equal(article.querySelector("img").dataset.i18nAttrs, `alt:inc.${inc.key}.alt`);
    assert.equal(article.querySelector("img").getAttribute("src"), inc.img);
    assert.equal(article.querySelector('a[target="_blank"]').getAttribute("href"), inc.issue);
  }
});

test("unknown incident key safely falls back to the blog index", () => {
  const html = readFileSync(join(docs, "incident-i1.html"), "utf8").replace('data-post="i1"', 'data-post="unknown"');
  const dom = new JSDOM(html, { url: "https://samogrow.test/incident-unknown.html", runScripts: "outside-only" });
  dom.window.eval(blogJs);
  assert.equal(dom.window.document.querySelectorAll(".post-card").length, 4);
});

test("blog rendering is translated with page-scoped metadata and language-preserving links", async () => {
  const dom = runBlog("incident-i1.html", "https://samogrow.test/incident-i1.html?lang=uk");
  Object.defineProperty(dom.window.document, "readyState", { value: "complete", configurable: true });
  dom.window.fetch = async (url) => {
    const code = /\/([a-z]{2,3})\.json$/.exec(url)?.[1] || "en";
    return { ok: true, json: async () => dicts[code] };
  };
  dom.window.eval(i18nJs);
  await flush();
  const { document } = dom.window;
  assert.equal(document.documentElement.lang, "uk");
  assert.equal(document.querySelector("h1").innerHTML, dicts.uk["inc.i1.title"]);
  assert.equal(document.title, dicts.uk["inc.i1.title"]);
  assert.equal(document.querySelector('meta[name="description"]').content,
    dicts.uk["inc.i1.summary"]);
  assert.equal(document.querySelector('a[href^="/blog.html"]').getAttribute("href"), "/blog.html?lang=uk");
});

test("incident blog and every post have separate language-preserving pages", () => {
  assert.match(indexHtml, /<section id="incidents">/);
  assert.match(indexHtml, /<a href="blog\.html" data-lang-link data-i18n="nav\.incidents">/);
  assert.match(blogHtml, /id="blog-content"/);
  for (const inc of INCIDENTS) {
    const page = readFileSync(join(docs, inc.file), "utf8");
    assert.match(page, new RegExp(`data-post="${inc.key}"`), `${inc.id} dedicated page missing`);
    assert.ok(blogJs.includes(`file: "incident-${inc.key}.html"`), `${inc.id} blog link missing`);
    assert.ok(blogJs.includes(`issue: "${inc.issue}"`), `${inc.id} issue link missing`);
    assert.ok(blogJs.includes(`image: "${inc.img}"`), `${inc.id} image not local`);
  }
  // I-6 narrative carries the full incident timeline.
  for (const d of ["2026-08-15", "2026-08-18", "2026-08-20"]) {
    assert.ok(en["inc.i6.story"].includes(d), `I-6 story missing date ${d}`);
  }
});

test("incident evidence images exist locally (no remote image runtime dependency)", () => {
  for (const inc of INCIDENTS) {
    const st = statSync(join(docs, inc.img));
    assert.ok(st.size > 10_000, `${inc.img} suspiciously small`);
  }
  // Every <img> on the page must be a relative, repo-local path.
  for (const m of indexHtml.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    assert.ok(!/^https?:/i.test(m[1]), `remote image: ${m[1]}`);
    assert.ok(statSync(join(docs, m[1])).size > 0, `missing image file: ${m[1]}`);
  }
});

test("each incident has translated summary/story/impact/lesson/alt/caption in every locale", () => {
  for (const [code, dict] of Object.entries(dicts)) {
    assert.ok((dict["inc.eyebrow"] || "").trim(), `${code}.json inc.eyebrow empty`);
  }
  for (const inc of INCIDENTS) {
    for (const part of ["title", "summary", "story", "impact", "lesson", "alt", "cap"]) {
      const key = `inc.${inc.key}.${part}`;
      assert.ok(key in en, `missing en key ${key}`);
      for (const [code, dict] of Object.entries(dicts)) {
        assert.ok((dict[key] || "").trim().length > 0, `${code}.json ${key} empty`);
      }
    }
    const dom = runBlog(inc.file);
    assert.equal(dom.window.document.querySelector("img").dataset.i18nAttrs, `alt:inc.${inc.key}.alt`);
    assert.equal(dom.window.document.querySelectorAll(".story > p").length, 3,
      `${inc.id} must render a three-paragraph narrative`);
  }
});

test("blog uses the light site palette and caps full-post image height", () => {
  for (const declaration of ["--bg: #f2ede0", "--card: #f7f3e8", "--ink: #1c2216", "--leaf: #35722f"]) {
    assert.ok(blogCss.includes(declaration), `blog palette missing ${declaration}`);
  }
  assert.match(blogCss, /\.post img\s*\{[^}]*max-height:\s*min\(62vh, 560px\);[^}]*object-fit:\s*contain;/,
    "full-post images need a viewport-aware height cap");
  assert.match(blogCss, /@media \(max-width: 720px\)[\s\S]*\.post img\s*\{\s*max-height:\s*50vh;/,
    "mobile full-post images need a stricter height cap");
});

// ---------- pricing context ----------

test("pricing frames identify their market, currency, and exclusions", () => {
  assert.ok(en["cost.sub"].includes("rough USD estimates"), "cost.sub must frame prices as estimates");
  assert.ok(en["cost.sub"].includes("excluding electricity") && en["cost.sub"].includes("AI/API"),
    "cost.sub must state the comparison exclusions");
  assert.ok(en["spec.allin.value"].includes("U.S."), "spec-card all-in value not U.S.-labeled");
  assert.ok(en["spec.eu.value"].includes("~$190–260") && en["spec.eu.value"].includes("rough"),
    "spec-card must show the rough non-U.S. estimate immediately");
  assert.ok(en["spec.eu.label"].includes("AliExpress"),
    "spec-card must identify ~$190–260 as the AliExpress sourcing estimate");
  assert.match(indexHtml, /data-i18n="spec\.eu\.value"/);
  assert.ok(en["parts.fine"].includes("U.S. mid-2026"), "parts fine print not U.S.-labeled");
  assert.ok(en["market.us.note"].includes("U.S. retail baseline"), "U.S. tab must identify its baseline");
});

test("Poland / EU example: snapshot date, items, sources, subtotal arithmetic", () => {
  assert.ok(en["pl.cap"].includes("2026-08-20") && en["pl.cap"].includes("USD"), "pl.cap needs snapshot date + USD");
  const block = indexHtml.slice(indexHtml.indexOf('<div class="pl-example'), indexHtml.indexOf('<div style="margin-top:52px">'));
  for (const id of ["1005010779026398", "1005007785492121", "1005006041534079", "1005011855369431"]) {
    assert.ok(block.includes(`https://www.aliexpress.com/item/${id}.html`), `source link for item ${id} missing`);
  }
  const amts = [...block.matchAll(/class="amt">~\$(\d+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(amts, [17, 15, 14, 10, 7, 66, 129], "line amounts changed");
  assert.equal(amts.slice(0, 6).reduce((a, b) => a + b, 0), amts[6], "subtotal must equal the sum of lines");
  for (const [key, obs] of [["pl.pump.sub", "$10.08"], ["pl.meter.sub", "$7.08"], ["pl.box.sub", "$65.85"], ["pl.plugs.sub", "$8.50"]]) {
    assert.ok(en[key].includes(obs), `${key} must cite observed price ${obs}`);
  }
  assert.ok(en["pl.camera.sub"].includes("RTSP") && /unverified/.test(en["pl.camera.sub"]),
    "camera line must flag RTSP as unverified");
  assert.ok(en["pl.basket"].includes("~$190–260") && /not a checkout quote/.test(en["pl.basket"]),
    "basket estimate must state range + non-quote status");
});

test("Poland example caveats cover the compatibility and cost traps", () => {
  const c = en["pl.caveats"];
  for (const word of ["Shipping", "VAT", "customs", "voltage", "plug type", "RTSP", "protocol", "warranty"]) {
    assert.ok(c.includes(word), `caveat missing: ${word}`);
  }
  assert.ok(c.includes("Tuya") && c.includes("adapter work"),
    "must warn generic Tuya gear needs adapter work with current software");
  assert.ok(c.includes("Kasa") && c.includes("Tapo"), "must name the actually-supported hardware");
});

test("market switcher is shareable, persistent, locale-aware, and keyboard wired", () => {
  assert.deepEqual(MARKET.MARKETS, ["us", "eu", "aliexpress"]);
  assert.equal(MARKET.queryMarket("?lang=uk&market=eu"), "eu");
  assert.equal(MARKET.queryMarket("?market=bogus"), null);
  assert.equal(MARKET.chooseMarket("?market=aliexpress", "eu", ["de-DE"]), "aliexpress");
  assert.equal(MARKET.chooseMarket("", "eu", ["en-US"]), "eu");
  assert.equal(MARKET.inferMarket(["de-DE"]), "eu");
  assert.equal(MARKET.inferMarket(["de"]), "eu");
  assert.equal(MARKET.inferMarket(["en-GB"]), "eu");
  assert.equal(MARKET.inferMarket(["de-CH"]), "eu");
  assert.equal(MARKET.inferMarket(["fr-CA"]), "us");
  assert.equal(MARKET.inferMarket(["uk-UA"]), "eu");
  assert.equal(MARKET.inferMarket(["pt-BR"]), "us");
  assert.equal(MARKET.inferMarket(["es-MX"]), "us");
  assert.equal(MARKET.inferMarket(["pt", "en-US"]), "eu");
  assert.equal(MARKET.inferMarket([]), "us");
  assert.equal(MARKET.inferMarket(["xx-XX"]), "us");
  assert.equal(MARKET.chooseMarket("", "not-a-market", ["de-DE"]), "eu");
  const dom = new JSDOM(indexHtml);
  const tabs = [...dom.window.document.querySelectorAll("[data-market-tab]")];
  assert.deepEqual(tabs.map((tab) => tab.dataset.marketTab), MARKET.MARKETS);
  assert.ok(tabs.every((tab) => tab.getAttribute("role") === "tab"));
  for (const tab of tabs) {
    const panel = dom.window.document.getElementById(tab.getAttribute("aria-controls"));
    assert.equal(panel?.getAttribute("role"), "tabpanel");
    assert.equal(panel?.getAttribute("aria-labelledby"), tab.id);
  }
});

function marketRuntimeDom({ url = "https://samogrow.test/?lang=en&market=us#cost", languages = ["en-US"], stored,
  storageThrows = false } = {}) {
  const dom = new JSDOM(indexHtml, { url, runScripts: "outside-only", pretendToBeVisual: true });
  Object.defineProperty(dom.window.document, "readyState", { value: "complete", configurable: true });
  Object.defineProperty(dom.window.navigator, "languages", { value: languages, configurable: true });
  Object.defineProperty(dom.window.navigator, "language", { value: languages[0] || "en", configurable: true });
  if (storageThrows) {
    Object.defineProperty(dom.window, "localStorage", { get() { throw new Error("storage disabled"); } });
  } else if (stored !== undefined) {
    dom.window.localStorage.setItem(MARKET.STORAGE_KEY, stored);
  }
  dom.window.eval(marketJs);
  return dom;
}

test("market runtime executes tab, keyboard, URL, storage, status, and popstate behavior", () => {
  const dom = marketRuntimeDom();
  const { document, KeyboardEvent, PopStateEvent } = dom.window;
  const tabs = [...document.querySelectorAll("[data-market-tab]")];
  const activeMarket = () => document.querySelector('[data-market-tab][aria-selected="true"]').dataset.marketTab;

  tabs[1].click();
  assert.equal(activeMarket(), "eu");
  assert.equal(document.querySelector('[data-market-panel="eu"]').hidden, false);
  assert.equal(document.querySelector('[data-market-panel="us"]').hidden, true);
  assert.equal(document.querySelector('[data-market-cell="samo.total"]').textContent, "~$365–460");
  assert.equal(dom.window.localStorage.getItem(MARKET.STORAGE_KEY), "eu");
  assert.equal(new URL(dom.window.location.href).searchParams.get("market"), "eu");

  tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(activeMarket(), "aliexpress");
  const auk = document.querySelector('[data-market-cell="auk.hardware"]');
  assert.equal(auk.classList.contains("status"), true);
  assert.ok(auk.querySelector(".code"));
  assert.equal(document.querySelector("[data-market-commercial-note]").hidden, true);
  assert.equal(document.querySelector('[data-market-detail="aliexpress"]').hidden, false);

  tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  assert.equal(activeMarket(), "us");
  assert.equal(document.querySelector('[data-market-detail="aliexpress"]').hidden, true);
  tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(activeMarket(), "aliexpress");
  tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  assert.equal(activeMarket(), "eu");

  dom.window.history.replaceState(null, "", "?lang=en&market=us#cost");
  dom.window.dispatchEvent(new PopStateEvent("popstate"));
  assert.equal(activeMarket(), "us");
  assert.equal(new URL(dom.window.location.href).searchParams.get("market"), "us");

  dom.window.history.replaceState(null, "", "?lang=en#cost");
  dom.window.dispatchEvent(new PopStateEvent("popstate"));
  assert.equal(activeMarket(), "eu", "popstate without a URL market must restore the saved manual choice");
  assert.equal(new URL(dom.window.location.href).searchParams.get("market"), null);
});

test("market runtime degrades safely when localStorage is unavailable", () => {
  const dom = marketRuntimeDom({
    storageThrows: true,
    languages: ["de-DE"],
    url: "https://samogrow.test/?lang=en#cost"
  });
  const eu = dom.window.document.querySelector('[data-market-tab="eu"]');
  assert.equal(eu.getAttribute("aria-selected"), "true");
  const ali = dom.window.document.querySelector('[data-market-tab="aliexpress"]');
  assert.doesNotThrow(() => ali.click());
  assert.equal(ali.getAttribute("aria-selected"), "true");
  assert.equal(new URL(dom.window.location.href).searchParams.get("market"), "aliexpress");
});

test("each sourcing market has a complete and internally consistent SamoGrow estimate", () => {
  const number = (value) => Number((value.match(/\d+/) || ["0"])[0]);
  for (const market of MARKET.MARKETS) {
    const row = MARKET.DATA[market].rows.samo;
    assert.equal(row.length, 4, `${market} row must have four values`);
    assert.ok(row.every(Boolean), `${market} SamoGrow values must all be present`);
    const spots = 6;
    const totalLow = number(row[2]);
    const perSpotLow = number(row[3]);
    assert.ok(Math.abs(Math.round(totalLow / spots) - perSpotLow) <= 1,
      `${market} per-spot low end must match total / six spots`);
  }
  assert.equal(MARKET.DATA.eu.rows.gardyn[0], "unavailable");
  assert.ok(MARKET.DATA.aliexpress.rows.auk.every((value) => value === null),
    "AliExpress must not reuse commercial-system prices");
});

test("cost table excludes AI and normalizes every verified total per spot", () => {
  const table = new JSDOM(indexHtml).window.document.querySelector("table.cmp");
  const rows = [...table.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim())
  );
  assert.deepEqual(rows, [
    ["samogrow · 6 sites", "$256", "~$70", "~$326", "~$54"],
    ["Auk Mini 2 · 4 pots", "$229", "~$80–120*", "~$309–349*", "~$77–87*"],
    ["Click & Grow SG9 · 9 sites", "$200", "~$400", "~$600", "~$67"],
    ["Gardyn Home 4 · 30 sites", "$899", "Not verified", "Not verified", "Not verified"],
  ]);
  assert.ok(!table.textContent.includes("$120 AI"), "AI cost must not appear in comparison table");
  assert.ok(en["cmp.market.note"].includes("optional AI/API usage") && en["cmp.market.note"].includes("Electricity"));
  const note = en["cmp.auk.note"];
  for (const fact of ["six months", "2–3 refills", "€35", "not yet priced", "six full nine-pod restarts per year"]) {
    assert.ok(note.includes(fact), `Auk caveat missing: ${fact}`);
  }
  for (const [code, dict] of Object.entries(dicts)) {
    assert.ok(dict["cmp.sites"] && dict["cmp.pots"], `${code} missing translated capacity labels`);
    assert.ok(dict["cmp.auk.note"].includes("€35"), `${code} Auk caveat missing refill price`);
    assert.match(dict["cmp.auk.note"], /Mini 2/, `${code} Auk caveat missing Mini 2`);
  }
});

test("capability table labels each system's growing method", () => {
  const dom = new JSDOM(indexHtml).window.document;
  const table = [...dom.querySelectorAll("table.cmp")].find((candidate) =>
    candidate.querySelector('[data-i18n="cap.th.method"]')
  );
  assert.ok(table, "capability table missing growing-method column");
  const methods = [...table.querySelectorAll("tbody tr td:nth-child(2)")].map((cell) =>
    cell.getAttribute("data-i18n")
  );
  assert.deepEqual(methods, ["cap.method.samo", "cap.method.auk", "cap.method.click", "cap.method.gardyn"]);
  for (const [code, dict] of Object.entries(dicts)) {
    for (const key of ["cap.th.method", ...methods]) {
      assert.ok((dict[key] || "").trim(), `${code}.json ${key} empty`);
    }
  }
});

test("architecture schematic is centered despite the generic figure margin rule", () => {
  assert.match(indexHtml, /figure\.shot\.schematic\s*\{[^}]*margin:\s*34px auto 0;/,
    "schematic needs a selector specific enough to retain auto side margins");
});

test("SPEC cost comparison stays tied to the exported U.S. market data", () => {
  const auk = MARKET.DATA.us.rows.auk;
  const escaped = auk.map((value) => value.replace(/\*/g, "\\*") );
  assert.ok(spec.includes(`| Auk Mini 2, 4 pots | ${escaped[0]} | ${escaped[1]} | **${escaped[2].replace(/\\\*$/, "")}**\\* | **${escaped[3].replace(/\\\*$/, "")}**\\* |`));
  for (const fact of ["six months", "€35", "Mini 2", "not published", "optional AI/API usage"]) {
    assert.ok(spec.includes(fact), `SPEC Auk methodology missing: ${fact}`);
  }
});

test("new pricing/incident strings keep prices and links intact across all 20 locales", () => {
  // Covered structurally by the global parity tests; assert the new keys are present everywhere.
  const newKeys = Object.keys(en).filter((k) => k.startsWith("pl.") || k.startsWith("inc.") || k.startsWith("market.") || k.startsWith("cap.") || k === "cmp.market.note" || k === "nav.incidents");
  assert.ok(newKeys.length >= 60, "expected the new key families to exist");
  for (const [code, dict] of Object.entries(dicts)) {
    for (const k of newKeys) assert.ok(k in dict, `${code}.json missing ${k}`);
  }
});
