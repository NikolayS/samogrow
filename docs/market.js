/* samogrow market-price switcher — dependency-free and static-host friendly. */
(function (root) {
  "use strict";

  var MARKETS = ["us", "eu", "aliexpress"];
  var DEFAULT_MARKET = "us";
  var STORAGE_KEY = "samogrow-market";
  var EU_REGIONS = [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL",
    "PT", "RO", "SE", "SI", "SK", "IS", "LI", "NO", "CH", "GB", "UA"
  ];
  var EU_LANGUAGES = [
    "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "ga", "hr",
    "hu", "is", "it", "lt", "lv", "mt", "nl", "no", "pl", "pt", "ro",
    "sk", "sl", "sv", "uk"
  ];

  var DATA = {
    us: {
      stack: { appliances: "$68", grow: "$188", total: "~$256", manual: "~$232", automated: "~$256", safety: "+~$55" },
      rows: {
        samo: ["$256", "~$70", "~$326", "~$54"],
        auk: ["$229", "~$80–120*", "~$309–349*", "~$77–87*"],
        click: ["$200", "~$400", "~$600", "~$67"],
        gardyn: ["$899", null, null, null]
      }
    },
    eu: {
      stack: { appliances: "~$95–120", grow: "~$200–260", total: "~$295–380", manual: "~$265–350", automated: "~$295–380", safety: "+~$60–90" },
      rows: {
        samo: ["~$295–380", "~$70–80", "~$365–460", "~$61–77"],
        auk: ["~$253", "~$81–122*", "~$334–375*", "~$84–94*"],
        click: ["~$289", "~$360", "~$649", "~$72"],
        gardyn: ["unavailable", "unavailable", "unavailable", "unavailable"]
      }
    },
    aliexpress: {
      stack: { appliances: "~$42", grow: "~$148–218", total: "~$190–260", manual: "~$170–235", automated: "~$190–260", safety: "+~$35–60" },
      rows: {
        samo: ["~$190–260", "~$35–70", "~$225–330", "~$38–55"],
        auk: [null, null, null, null],
        click: [null, null, null, null],
        gardyn: [null, null, null, null]
      }
    }
  };

  function validMarket(value) {
    var normalized = String(value || "").toLowerCase();
    return MARKETS.indexOf(normalized) >= 0 ? normalized : null;
  }

  function queryMarket(search) {
    try { return validMarket(new URLSearchParams(String(search || "")).get("market")); }
    catch (e) { return null; }
  }

  function regionOf(tag) {
    var parts = String(tag || "").replace(/_/g, "-").split("-");
    for (var i = 1; i < parts.length; i++) {
      if (/^[A-Za-z]{2}$/.test(parts[i])) return parts[i].toUpperCase();
    }
    return null;
  }

  function inferMarket(languages) {
    var list = languages || [];
    for (var i = 0; i < list.length; i++) {
      var region = regionOf(list[i]);
      if (region === "US" || region === "CA") return "us";
      if (EU_REGIONS.indexOf(region) >= 0) return "eu";
      if (region) return DEFAULT_MARKET;
      var language = String(list[i] || "").replace(/_/g, "-").split("-")[0].toLowerCase();
      if (EU_LANGUAGES.indexOf(language) >= 0) return "eu";
    }
    return DEFAULT_MARKET;
  }

  function chooseMarket(search, stored, languages) {
    return queryMarket(search) || validMarket(stored) || inferMarket(languages);
  }

  var api = {
    MARKETS: MARKETS,
    DATA: DATA,
    DEFAULT_MARKET: DEFAULT_MARKET,
    STORAGE_KEY: STORAGE_KEY,
    validMarket: validMarket,
    queryMarket: queryMarket,
    inferMarket: inferMarket,
    chooseMarket: chooseMarket
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SamogrowMarket = api;
  if (typeof document === "undefined") return;

  function storedMarket() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function syncUrl(market) {
    try {
      var url = new URL(root.location.href);
      url.searchParams.set("market", market);
      root.history.replaceState(root.history.state, "", url.href);
    } catch (e) {}
  }

  function translatedStatus(status) {
    var key = status === "unavailable" ? "cmp.unavailable" : "cmp.notVerified";
    var source = document.querySelector('[data-market-copy="' + key + '"]');
    return source ? source.innerHTML : (status === "unavailable" ? "Unavailable" : "Not verified");
  }

  function render(market, persist, sync) {
    var data = DATA[market];
    if (!data) return;

    Object.keys(data.stack).forEach(function (key) {
      var el = document.querySelector('[data-market-stack="' + key + '"]');
      if (el) el.textContent = data.stack[key];
    });

    Object.keys(data.rows).forEach(function (row) {
      var values = data.rows[row];
      ["hardware", "consumables", "total", "perSpot"].forEach(function (column, index) {
        var cell = document.querySelector('[data-market-cell="' + row + '.' + column + '"]');
        if (!cell) return;
        var value = values[index];
        cell.classList.toggle("status", value === null || value === "unavailable");
        if (value === null) cell.innerHTML = translatedStatus("notVerified");
        else if (value === "unavailable") cell.innerHTML = translatedStatus("unavailable");
        else cell.textContent = value;
      });
    });

    var tabs = document.querySelectorAll("[data-market-tab]");
    for (var i = 0; i < tabs.length; i++) {
      var active = tabs[i].getAttribute("data-market-tab") === market;
      tabs[i].setAttribute("aria-selected", active ? "true" : "false");
      tabs[i].setAttribute("tabindex", active ? "0" : "-1");
    }
    var panels = document.querySelectorAll("[data-market-panel]");
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].getAttribute("data-market-panel") !== market;
    }
    var details = document.querySelectorAll("[data-market-detail]");
    for (var k = 0; k < details.length; k++) {
      details[k].hidden = details[k].getAttribute("data-market-detail") !== market;
    }
    var commercialNotes = document.querySelectorAll("[data-market-commercial-note]");
    for (var m = 0; m < commercialNotes.length; m++) {
      commercialNotes[m].hidden = market === "aliexpress";
    }

    if (sync !== false) syncUrl(market);
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, market); } catch (e) {}
    }
  }

  function init() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll("[data-market-tab]"));
    if (!tabs.length) return;
    var languages = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    var current = chooseMarket(root.location.search, storedMarket(), languages);

    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () {
        current = tab.getAttribute("data-market-tab");
        render(current, true);
      });
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        var next = index;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        tabs[next].focus();
        tabs[next].click();
      });
    });

    render(current, false);
    root.addEventListener("popstate", function () {
      current = queryMarket(root.location.search) || inferMarket(languages);
      render(current, false, false);
    });
    document.addEventListener("samogrow:locale-applied", function () { render(current, false); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(typeof globalThis !== "undefined" ? globalThis : this);
