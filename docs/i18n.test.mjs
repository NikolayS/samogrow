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

const { LOCALES, CODES, chooseLocale, matchLocale, queryLocale, optionLabel, STORAGE_KEY } = I18N;

const indexHtml = readFileSync(join(docs, "index.html"), "utf8");
const i18nJs = readFileSync(join(docs, "i18n.js"), "utf8");
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
  const allowedTags = new Set(["A", "B", "CODE", "EM", "I", "SPAN"]);
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

test("every data-i18n key in index.html exists in en.json", () => {
  for (const k of usedKeys) assert.ok(k in en, `index.html references missing key ${k}`);
});

test("every en.json key is used by index.html or the JS runtime", () => {
  const jsApplied = new Set(["meta.title", "meta.description"]);
  for (const k of Object.keys(en)) {
    assert.ok(usedKeys.has(k) || jsApplied.has(k), `unused key ${k}`);
  }
});

test("bootstrap code list in index.html matches LOCALES in i18n.js", () => {
  const m = indexHtml.match(/var codes = \[([^\]]+)\]/);
  assert.ok(m, "bootstrap codes array not found in index.html");
  const bootCodes = m[1].split(",").map((s) => s.trim().replace(/"/g, ""));
  assert.deepEqual(bootCodes, CODES);
});

test("English defaults baked into index.html match en.json (no drift)", () => {
  // Spot-check a few plain-text keys whose values appear verbatim in the HTML.
  for (const k of ["nav.cost", "spec.eyebrow", "how.title", "cost.title", "feat.title", "foot.gh"]) {
    assert.ok(indexHtml.includes(`>${en[k]}<`), `index.html default text drifted for ${k}`);
  }
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
  assert.match(indexHtml, /localStorage\.getItem\("samogrow-lang"\)/);
});

// ---------- executable browser-runtime coverage ----------

const minimalPage = (initial = "en") => `<!doctype html>
<html${initial === null ? "" : ` data-i18n-initial="${initial}"`} class="i18n-pending">
<head><title>English title</title><meta name="description" content="English description"></head>
<body>
  <button id="lang-btn" aria-expanded="false" aria-controls="lang-menu"><span id="lang-current">EN</span></button>
  <ul id="lang-menu" hidden></ul>
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
  assert.equal(document.activeElement.dataset.code, "en");
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
});

test("auto-detected locale is added to the URL for sharing", async () => {
  const dom = runtimeDom({ initial: null, languages: ["ru-RU"], url: "https://samogrow.test/#how" });
  await flush();
  assert.equal(dom.window.document.documentElement.lang, "ru");
  assert.equal(dom.window.location.search, "?lang=ru");
  assert.equal(dom.window.location.hash, "#how");
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

const bootstrapScript = indexHtml.match(/<script>\s*(\/\/ i18n bootstrap[\s\S]*?)<\/script>/)?.[1];

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
  { id: "I-1", date: "2026-07-13", sev: "SEV-2", issue: "https://github.com/NikolayS/samogrow/issues/3",
    img: "img/incidents/2026-07-13-reservoir-128x10.jpeg", key: "i1" },
  { id: "I-3", date: "2026-07-24", sev: "SEV-3", issue: "https://github.com/NikolayS/samogrow/issues/6",
    img: "img/incidents/2026-07-24-pest-frass-macro.jpeg", key: "i3" },
  { id: "I-5", date: "2026-08-12", sev: "SEV-3", issue: "https://github.com/NikolayS/samogrow/issues/10",
    img: "img/incidents/2026-08-12-aphids-parsley.jpeg", key: "i5" },
  { id: "I-6", date: "2026-08-15", sev: "SEV-3", issue: "https://github.com/NikolayS/samogrow/issues/11",
    img: "img/incidents/2026-08-18-neem-burn-basil.jpeg", key: "i6" },
];

test("incident section exists, is in the nav, and carries all four dated incidents", () => {
  assert.match(indexHtml, /<section id="incidents">/);
  assert.match(indexHtml, /<a href="#incidents" data-i18n="nav.incidents">/);
  const section = indexHtml.slice(indexHtml.indexOf('<section id="incidents">'), indexHtml.indexOf("<!-- MEME WALL"));
  assert.equal((section.match(/class="inc-card"/g) || []).length, 4);
  for (const inc of INCIDENTS) {
    assert.ok(section.includes(`<span class="inc-id">${inc.id}</span>`), `${inc.id} chip missing`);
    assert.ok(section.includes(`<span class="inc-date">${inc.date}</span>`), `${inc.id} date wrong`);
    assert.ok(section.includes(`<span class="inc-sev">${inc.sev}</span>`), `${inc.id} severity wrong`);
    assert.ok(section.includes(`href="${inc.issue}"`), `${inc.id} issue link missing`);
    assert.ok(section.includes(`src="${inc.img}"`), `${inc.id} image not local`);
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

test("each incident has translated title/story/impact/lesson/alt/caption in every locale", () => {
  for (const inc of INCIDENTS) {
    for (const part of ["title", "story", "impact", "lesson", "alt", "cap"]) {
      const key = `inc.${inc.key}.${part}`;
      assert.ok(key in en, `missing en key ${key}`);
      for (const [code, dict] of Object.entries(dicts)) {
        assert.ok((dict[key] || "").trim().length > 0, `${code}.json ${key} empty`);
      }
    }
    assert.ok(indexHtml.includes(`data-i18n-attrs="alt:inc.${inc.key}.alt"`), `alt wiring missing for ${inc.id}`);
  }
});

// ---------- pricing context ----------

test("U.S. baseline labeling is explicit on every price frame", () => {
  assert.ok(en["cost.sub"].includes("U.S. mid-2026 baseline"), "cost.sub not labeled U.S. baseline");
  assert.ok(/not a quote/.test(en["cost.sub"]), "cost.sub must disclaim quote status");
  assert.ok(en["spec.allin.value"].includes("U.S."), "spec-card all-in value not U.S.-labeled");
  assert.ok(en["parts.fine"].includes("U.S. mid-2026"), "parts fine print not U.S.-labeled");
  assert.ok(en["cost.us.note"].includes("USD") && en["cost.us.note"].includes("U.S. mid-2026"),
    "cost.us.note must state USD + U.S. mid-2026");
  assert.match(indexHtml, /data-i18n="cost.us.note"/);
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

test("new pricing/incident strings keep prices and links intact across all 20 locales", () => {
  // Covered structurally by the global parity tests; assert the new keys are present everywhere.
  const newKeys = Object.keys(en).filter((k) => k.startsWith("pl.") || k.startsWith("inc.") || k === "cost.us.note" || k === "nav.incidents");
  assert.ok(newKeys.length >= 45, "expected the new key families to exist");
  for (const [code, dict] of Object.entries(dicts)) {
    for (const k of newKeys) assert.ok(k in dict, `${code}.json missing ${k}`);
  }
});
