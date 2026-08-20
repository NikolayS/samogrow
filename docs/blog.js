/* Shared incident renderer. blog.html omits data-post to render the index;
 * incident-i*.html sets data-post to select one record from this roster. */
(function () {
  "use strict";

  var incidents = [
    {
      key: "i1", id: "I-1", date: "2026-07-13", severity: "SEV-2",
      file: "incident-i1.html", issue: "https://github.com/NikolayS/samogrow/issues/3",
      image: "img/incidents/2026-07-13-reservoir-128x10.jpeg", width: 1600, height: 880,
      title: "The ×10 incident — a tenfold nutrient overdose",
      story: "The cheap TDS pen showed “115” and nobody noticed the tiny ×10 flag next to it. The reservoir was dosed as if the water were ten times cleaner than it was, and the salt concentration burned the plants within days.",
      impact: "<b>Impact:</b> salt burn across the tote — necrotic mint, declining parsley; the most expensive lesson of the field test.",
      lesson: "<b>Lesson:</b> always read the multiplier flag and relay true ppm; a units-validation step now guards every reported reading.",
      alt: "Evidence photo from incident I-1: a handheld TDS meter held over the DWC reservoir reads 128 with the small ×10 multiplier flag lit — the reading that revealed the tenfold nutrient overdose.",
      caption: "The smoking gun: 128 on the display, ×10 flag lit — 1,280 ppm in the reservoir."
    },
    {
      key: "i3", id: "I-3", date: "2026-07-24", severity: "SEV-3",
      file: "incident-i3.html", issue: "https://github.com/NikolayS/samogrow/issues/6",
      image: "img/incidents/2026-07-24-pest-frass-macro.jpeg", width: 1600, height: 862,
      title: "The leafroller — a stowaway on a transplant",
      story: "A caterpillar hitchhiked in on a garden-center transplant and spent two weeks eating mint by night, hiding in a silked rolled leaf by day. It was never seen in the act — the case was cracked from its droppings accumulating on the lid.",
      impact: "<b>Impact:</b> one mint stem stripped bare, chewed mint and basil leaves; no plant lost.",
      lesson: "<b>Lesson:</b> transplants import pests — inspect and quarantine new plants, and treat frass as a first-class alarm signal.",
      alt: "Evidence photo from incident I-3: macro shot of black frass pellets — caterpillar droppings — scattered on the yellow reservoir lid, the clue that finally revealed the hidden leafroller.",
      caption: "Not soil: frass on the lid — the droppings that gave the nocturnal caterpillar away."
    },
    {
      key: "i5", id: "I-5", date: "2026-08-12", severity: "SEV-3",
      file: "incident-i5.html", issue: "https://github.com/NikolayS/samogrow/issues/10",
      image: "img/incidents/2026-08-12-aphids-parsley.jpeg", width: 1500, height: 1275,
      title: "Aphids the camera never saw",
      story: "Sap-sucking aphids colonized the parsley and basil, cupping the basil's new growth. The automated camera checks are blind to pests this small — a hands-on leaf inspection found them, days after an early warning (“a few small flies”) went unacted-on.",
      impact: "<b>Impact:</b> distorted basil growth and stippled parsley; recoverable, no plant lost.",
      lesson: "<b>Lesson:</b> the camera is not a pest sensor — schedule human leaf checks, and act on small anomalies instead of filing them away.",
      alt: "Evidence photo from incident I-5: close-up of grey-green aphids clustered along parsley stems and leaves, with fine pale stippling on the foliage.",
      caption: "Aphid clusters on the parsley — invisible to the overhead camera, obvious in the hand."
    },
    {
      key: "i6", id: "I-6", date: "2026-08-15", severity: "SEV-3",
      file: "incident-i6.html", issue: "https://github.com/NikolayS/samogrow/issues/11",
      image: "img/incidents/2026-08-18-neem-burn-basil.jpeg", width: 1500, height: 1200,
      title: "Neem under the light — the self-inflicted burn",
      story: "Treating the aphids, we sprayed neem oil once (~2026-08-15) with the grow light ON. Neem is phototoxic: oil film plus radiant light scorched the basil and mint. Damage surfaced 2026-08-18; the RCA landed 2026-08-20. The pest treatment worked — and caused the next incident.",
      impact: "<b>Impact:</b> bronze necrotic patches on basil (worst) and mint; leaf-level only, recovering.",
      lesson: "<b>Lesson:</b> lights OFF before spraying any oil — a hard precondition now written into the treatment guidance, not a footnote.",
      alt: "Evidence photo from incident I-6: basil leaves with large bronze-brown necrotic scorch patches across the leaf surfaces — oil phototoxicity damage from a neem spray applied under the grow light.",
      caption: "Bronze scorch on the basil, three days after a neem spray under a lit grow light."
    }
  ];

  function meta(item) {
    return '<div class="meta">' + item.id + ' · ' + item.date + ' · ' + item.severity + '</div>';
  }

  function card(item) {
    return '<a class="post-card" data-lang-link href="' + item.file + '">' +
      '<img src="' + item.image + '" width="' + item.width + '" height="' + item.height + '" loading="lazy" alt="' + item.alt + '" data-i18n-attrs="alt:inc.' + item.key + '.alt">' +
      '<div class="copy">' + meta(item) + '<h2 data-i18n="inc.' + item.key + '.title">' + item.title + '</h2>' +
      '<p data-i18n="inc.' + item.key + '.story">' + item.story + '</p></div></a>';
  }

  function post(item) {
    return '<article class="post shell">' + meta(item) +
      '<h1 data-i18n="inc.' + item.key + '.title">' + item.title + '</h1>' +
      '<p class="story" data-i18n="inc.' + item.key + '.story">' + item.story + '</p>' +
      '<figure><img src="' + item.image + '" width="' + item.width + '" height="' + item.height + '" alt="' + item.alt + '" data-i18n-attrs="alt:inc.' + item.key + '.alt">' +
      '<figcaption data-i18n="inc.' + item.key + '.cap">' + item.caption + '</figcaption></figure>' +
      '<ul class="facts"><li data-i18n="inc.' + item.key + '.impact">' + item.impact + '</li>' +
      '<li data-i18n="inc.' + item.key + '.lesson">' + item.lesson + '</li></ul>' +
      '<div class="actions"><a data-lang-link href="blog.html">← <span data-i18n="inc.title">The incident blog</span></a>' +
      '<a href="' + item.issue + '" target="_blank" rel="noopener" data-i18n="inc.readmore">Full write-up &amp; RCA on GitHub →</a></div></article>';
  }

  var root = document.getElementById("blog-content");
  if (!root) return;
  var key = document.body.getAttribute("data-post");
  if (key) {
    var selected = incidents.find(function (item) { return item.key === key; });
    if (selected) {
      root.innerHTML = post(selected);
      return;
    }
  }
  root.innerHTML = '<header class="hero shell"><span class="eyebrow">Field notes</span>' +
    '<h1 data-i18n="inc.title">The incident blog</h1><p class="lede" data-i18n="inc.sub">Real gardens produce real incidents, and we run them like production outages: dated, severity-tagged, blameless, and written up in public.</p></header>' +
    '<div class="post-grid shell">' + incidents.map(card).join("") + '</div>';
})();
