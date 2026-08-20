/* samogrow i18n runtime — no dependencies, static-files-only (GitHub Pages).
 *
 * Locale data lives in i18n/<code>.json (one flat key→string map per language;
 * values may carry inline HTML that must be preserved by translations).
 * English is baked into index.html, so the first paint in English costs nothing.
 *
 * Locale choice: localStorage (manual pick) → navigator.languages (exact tag,
 * then base subtag, e.g. "pt-BR" → "pt") → "en".
 *
 * The pure parts (LOCALES, matchLocale, chooseLocale, optionLabel) are exported
 * for the Node test suite; the DOM section only runs in a browser.
 */
(function (root) {
  "use strict";

  var LOCALES = [
    { code: "en", abbr: "EN", name: "English", dir: "ltr" },
    { code: "es", abbr: "ES", name: "Español", dir: "ltr" },
    { code: "fr", abbr: "FR", name: "Français", dir: "ltr" },
    { code: "de", abbr: "DE", name: "Deutsch", dir: "ltr" },
    { code: "it", abbr: "IT", name: "Italiano", dir: "ltr" },
    { code: "pt", abbr: "PT", name: "Português", dir: "ltr" },
    { code: "nl", abbr: "NL", name: "Nederlands", dir: "ltr" },
    { code: "pl", abbr: "PL", name: "Polski", dir: "ltr" },
    { code: "ru", abbr: "RU", name: "Русский", dir: "ltr" },
    { code: "uk", abbr: "UK", name: "Українська", dir: "ltr" },
    { code: "tr", abbr: "TR", name: "Türkçe", dir: "ltr" },
    { code: "ar", abbr: "AR", name: "العربية", dir: "rtl" },
    { code: "hi", abbr: "HI", name: "हिन्दी", dir: "ltr" },
    { code: "bn", abbr: "BN", name: "বাংলা", dir: "ltr" },
    { code: "id", abbr: "ID", name: "Bahasa Indonesia", dir: "ltr" },
    { code: "vi", abbr: "VI", name: "Tiếng Việt", dir: "ltr" },
    { code: "th", abbr: "TH", name: "ไทย", dir: "ltr" },
    { code: "ja", abbr: "JA", name: "日本語", dir: "ltr" },
    { code: "ko", abbr: "KO", name: "한국어", dir: "ltr" },
    { code: "zh", abbr: "ZH", name: "中文", dir: "ltr" }
  ];

  var DEFAULT_LOCALE = "en";
  var STORAGE_KEY = "samogrow-lang";
  var CODES = LOCALES.map(function (l) { return l.code; });

  /* Match one BCP-47 tag against our locale codes: exact (case-insensitive),
   * then primary language subtag ("uk-UA" → "uk", "zh-Hans-CN" → "zh"). */
  function matchLocale(tag) {
    if (!tag) return null;
    var t = String(tag).toLowerCase();
    if (CODES.indexOf(t) >= 0) return t;
    var base = t.split("-")[0];
    return CODES.indexOf(base) >= 0 ? base : null;
  }

  /* stored: value from localStorage (manual choice; wins if valid).
   * requested: navigator.languages-style array, in preference order. */
  function chooseLocale(stored, requested) {
    if (stored && CODES.indexOf(String(stored)) >= 0) return String(stored);
    var list = requested || [];
    for (var i = 0; i < list.length; i++) {
      var m = matchLocale(list[i]);
      if (m) return m;
    }
    return DEFAULT_LOCALE;
  }

  /* Switcher option labeling: the VISIBLE text is the abbreviation only;
   * the native language name is exposed to assistive tech via aria-label. */
  function optionLabel(locale) {
    return { visible: locale.abbr, accessibleName: locale.abbr + " — " + locale.name };
  }

  var api = {
    LOCALES: LOCALES,
    CODES: CODES,
    DEFAULT_LOCALE: DEFAULT_LOCALE,
    STORAGE_KEY: STORAGE_KEY,
    matchLocale: matchLocale,
    chooseLocale: chooseLocale,
    optionLabel: optionLabel
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SamogrowI18n = api;

  if (typeof document === "undefined") return; // Node (tests) stops here.

  /* ---------------- DOM section ---------------- */

  var dictCache = {}; // code -> promise of dict
  var current = DEFAULT_LOCALE;

  function findLocale(code) {
    for (var i = 0; i < LOCALES.length; i++) if (LOCALES[i].code === code) return LOCALES[i];
    return LOCALES[0];
  }

  function getStored() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function loadDict(code) {
    if (!dictCache[code]) {
      dictCache[code] = fetch("i18n/" + code + ".json").then(function (r) {
        if (!r.ok) throw new Error("locale fetch failed: " + code + " (" + r.status + ")");
        return r.json();
      });
      dictCache[code].catch(function () { delete dictCache[code]; });
    }
    return dictCache[code];
  }

  function reveal() {
    document.documentElement.classList.remove("i18n-pending");
  }

  function applyDict(code, dict) {
    var locale = findLocale(code);
    var html = document.documentElement;
    html.lang = code;
    html.dir = locale.dir;

    if (dict["meta.title"]) document.title = dict["meta.title"];
    var meta = document.querySelector('meta[name="description"]');
    if (meta && dict["meta.description"]) meta.setAttribute("content", dict["meta.description"]);

    var nodes = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-i18n");
      if (Object.prototype.hasOwnProperty.call(dict, key)) nodes[i].innerHTML = dict[key];
    }
    var attrNodes = document.querySelectorAll("[data-i18n-attrs]");
    for (var j = 0; j < attrNodes.length; j++) {
      var pairs = attrNodes[j].getAttribute("data-i18n-attrs").split(",");
      for (var k = 0; k < pairs.length; k++) {
        var sep = pairs[k].indexOf(":");
        if (sep < 0) continue;
        var attr = pairs[k].slice(0, sep).trim();
        var akey = pairs[k].slice(sep + 1).trim();
        if (Object.prototype.hasOwnProperty.call(dict, akey)) attrNodes[j].setAttribute(attr, dict[akey]);
      }
    }
    current = code;
    updateSwitcher();
    reveal();
  }

  function setLocale(code, persist) {
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
    }
    loadDict(code).then(function (dict) {
      applyDict(code, dict);
    }, function (err) {
      // Locale failed to load: never leave the page hidden or half-applied.
      reveal();
      if (root.console && console.warn) console.warn("samogrow i18n:", err);
    });
  }

  /* ---------------- switcher widget ---------------- */

  var btn, menu, currentLabel;

  function updateSwitcher() {
    if (!btn) return;
    currentLabel.textContent = findLocale(current).abbr;
    var opts = menu.querySelectorAll("[role=option]");
    for (var i = 0; i < opts.length; i++) {
      opts[i].setAttribute("aria-selected", opts[i].getAttribute("data-code") === current ? "true" : "false");
    }
  }

  function closeMenu(focusBtn) {
    if (menu.hidden) return;
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (focusBtn) btn.focus();
  }

  function openMenu() {
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    var sel = menu.querySelector('[aria-selected="true"]') || menu.firstElementChild;
    if (sel) sel.focus();
  }

  function optionEls() {
    return Array.prototype.slice.call(menu.querySelectorAll("[role=option]"));
  }

  function buildSwitcher() {
    btn = document.getElementById("lang-btn");
    menu = document.getElementById("lang-menu");
    currentLabel = document.getElementById("lang-current");
    if (!btn || !menu || !currentLabel) return;

    LOCALES.forEach(function (locale) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("tabindex", "-1");
      li.setAttribute("data-code", locale.code);
      li.setAttribute("lang", locale.code);
      var parts = optionLabel(locale);
      var abbr = document.createElement("span");
      abbr.className = "abbr";
      abbr.textContent = parts.visible; // visible content: abbreviation only
      li.appendChild(abbr);
      li.setAttribute("aria-label", parts.accessibleName);
      li.title = parts.accessibleName;
      li.addEventListener("click", function () {
        closeMenu(true);
        setLocale(locale.code, true); // manual choice persists
      });
      li.addEventListener("keydown", function (e) {
        var opts = optionEls();
        var idx = opts.indexOf(document.activeElement);
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          closeMenu(true);
          setLocale(locale.code, true);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          (opts[Math.min(idx + 1, opts.length - 1)] || opts[0]).focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          (opts[Math.max(idx - 1, 0)] || opts[0]).focus();
        } else if (e.key === "Home") {
          e.preventDefault(); opts[0].focus();
        } else if (e.key === "End") {
          e.preventDefault(); opts[opts.length - 1].focus();
        } else if (e.key === "Escape" || e.key === "Tab") {
          closeMenu(e.key === "Escape");
        }
      });
      menu.appendChild(li);
    });

    btn.addEventListener("click", function () {
      if (menu.hidden) openMenu(); else closeMenu(false);
    });
    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openMenu();
      }
    });
    document.addEventListener("click", function (e) {
      if (!menu.hidden && !btn.contains(e.target) && !menu.contains(e.target)) closeMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu(false);
    });

    updateSwitcher();
  }

  function init() {
    buildSwitcher();
    var initial = chooseLocale(getStored(), navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language || DEFAULT_LOCALE]);
    if (initial === DEFAULT_LOCALE) {
      reveal(); // page is already English
      updateSwitcher();
    } else {
      setLocale(initial, false); // auto-detection does not persist
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
