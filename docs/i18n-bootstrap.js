/* Pick the locale before first paint so non-English pages do not flash English.
 * This mirrors the URL/storage/browser precedence and matching in i18n.js. */
(function () {
  "use strict";
  var codes = ["ar","bn","de","en","es","fr","hi","id","it","ja","ko","nl","pl","pt","ru","th","tr","uk","vi","zh"];
  function match(tag) {
    var normalized = String(tag || "").toLowerCase();
    if (codes.indexOf(normalized) >= 0) return normalized;
    var base = normalized.split("-")[0];
    return codes.indexOf(base) >= 0 ? base : null;
  }
  var pick = null;
  try { pick = match(new URLSearchParams(location.search).get("lang")); } catch (e) {}
  if (!pick) {
    try { pick = localStorage.getItem("samogrow-lang"); } catch (e) {}
    pick = match(pick);
  }
  if (!pick) {
    var prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || "en"];
    for (var i = 0; i < prefs.length && !pick; i++) pick = match(prefs[i]);
  }
  document.documentElement.setAttribute("data-i18n-initial", pick || "en");
  if (pick && pick !== "en") {
    document.documentElement.classList.add("i18n-pending");
    window.__samogrowI18nTimer = setTimeout(function () {
      document.documentElement.classList.remove("i18n-pending");
      window.__samogrowI18nTimer = null;
    }, 2000);
  }
})();
