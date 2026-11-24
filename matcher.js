/*
 * matcher.js - CV <-> job matching with NO preset skills, titles or experience.
 * Everything is derived from the CV text and the job text you give it.
 */
(function (root) {
  "use strict";

  var STOP = new Set((
    "a about above across after again against all also am an and any are as at be because been before being below " +
    "between both but by can could did do does doing down during each few for from further had has have having he her " +
    "here hers him his how i if in into is it its just me more most my no nor not of off on once only or other our out " +
    "over own same she should so some such than that the their them then there these they this those through to too " +
    "under until up very was we were what when where which while who whom why will with would you your yours " +
    "within etc including include includes per via using use used work works working role roles job jobs candidate " +
    "candidates looking join joining position responsibilities responsibility requirements required requirement " +
    "preferred plus strong good great excellent knowledge understanding experience experiences years year team teams " +
    "company ensure well new like part full time must may able ability skills skill related relevant opportunity " +
    "apply benefits equal employer employment location salary day days month months one two three etc eg ie " +
    "senior junior lead help make take get need needs based high level highly proven demonstrated passion " +
    "responsible working environment industry global world people customers customer"
  ).split(/\s+/));

  var SHORT_OK = new Set(["hr", "qa", "qc", "bi", "ai", "ml", "ui", "ux", "pm", "it"]);
  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  function isKeep(w) {
    if (STOP.has(w)) return false;
    if (/^\d+$/.test(w)) return false;
    return w.length >= 3 || SHORT_OK.has(w);
  }

  function stem(w) {
    if (w.length <= 3) return w;
    var s = w;
    if (/ies$/.test(s) && s.length > 4) s = s.slice(0, -3) + "y";
    else if (/(ss|us|is)$/.test(s)) s = s;
    else if (/ing$/.test(s) && s.length > 5) s = s.slice(0, -3).replace(/([bcdfghjklmnpqrtvwxz])\1$/, "$1");
    else if (/ed$/.test(s) && s.length > 4) s = s.slice(0, -2).replace(/([bcdfghjklmnpqrtvwxz])\1$/, "$1");
    else if (/(s|x|z|ch|sh)es$/.test(s) && s.length > 4) s = s.slice(0, -2);
    else if (/s$/.test(s)) s = s.slice(0, -1);
    if (/e$/.test(s) && s.length > 4) s = s.slice(0, -1);
    return s;
  }

  function segments(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\u2019']/g, "")
      .split(/[\n\r.;:,|\u2022\u00b7\u25cf\u25aa()\[\]{}!?"]+/);
  }

  function tokensOf(seg) {
    return seg.replace(/[-\/_]/g, " ").match(/[a-z0-9][a-z0-9+#]*(?:&[a-z0-9+#]+)*/g) || [];
  }

  function bump(map, key, label, idx, n) {
    var e = map.get(key);
    if (e) { e.count += n; }
    else map.set(key, { key: key, label: label, count: n, first: idx });
  }

  function extract(text) {
    var uni = new Map(), bi = new Map(), idx = 0;
    segments(text).forEach(function (seg) {
      var toks = tokensOf(seg);
      for (var i = 0; i < toks.length; i++) {
        idx++;
        var a = toks[i];
        if (isKeep(a)) bump(uni, stem(a), a, idx, 1);
        if (i + 1 < toks.length) {
          var b = toks[i + 1];
          if (isKeep(a) && isKeep(b)) bump(bi, stem(a) + " " + stem(b), a + " " + b, idx, 1);
        }
      }
    });
    return { uni: uni, bi: bi };
  }

  function topList(ext, limit) {
    var all = [];
    ext.bi.forEach(function (e) { if (e.count >= 2) all.push({ label: e.label, count: e.count * 1.5, n: 2, first: e.first }); });
    ext.uni.forEach(function (e) { if (e.count >= 2) all.push({ label: e.label, count: e.count, n: 1, first: e.first }); });
    all.sort(function (x, y) { return y.count - x.count || x.first - y.first; });
    return all.slice(0, limit || 20);
  }

  function buildCv(text) {
    var ext = extract(text);
    var uniSet = new Set(ext.uni.keys()), biSet = new Set(ext.bi.keys());
    return { text: text, uniSet: uniSet, biSet: biSet, ext: ext, topTerms: topList(ext, 24) };
  }

  function selectJobTerms(title, jdText, cap) {
    var ext = extract(jdText || "");
    var t = extract(title || "");
    t.uni.forEach(function (e, k) {
      var x = ext.uni.get(k);
      if (x) { x.count += 3; x.title = true; } else ext.uni.set(k, { key: k, label: e.label, count: 3, first: 0, title: true });
    });
    t.bi.forEach(function (e, k) {
      var x = ext.bi.get(k);
      if (x) { x.count += 3; x.title = true; } else ext.bi.set(k, { key: k, label: e.label, count: 3, first: 0, title: true });
    });

    var bis = [];
    ext.bi.forEach(function (e) { if (e.count >= 2 || e.title) bis.push({ key: e.key, label: e.label, count: e.count, first: e.first, n: 2 }); });
    var unis = [];
    ext.uni.forEach(function (e) { unis.push({ key: e.key, label: e.label, count: e.count, first: e.first, n: 1 }); });

    unis = unis.filter(function (u) {
      return !bis.some(function (b) { return b.key.split(" ").indexOf(u.key) !== -1 && b.count >= u.count; });
    });

    var all = bis.concat(unis);
    all.sort(function (x, y) { return y.count - x.count || x.first - y.first; });
    return all.slice(0, cap || 45).map(function (e) {
      e.weight = 1 + Math.log(e.count);
      return e;
    });
  }

  function analyze(title, jdText, cv) {
    var terms = selectJobTerms(title, jdText);
    var got = 0, total = 0, matched = [], missing = [];
    terms.forEach(function (t) {
      total += t.weight;
      if (t.n === 2) {
        if (cv.biSet.has(t.key)) { got += t.weight; matched.push(t.label); }
        else {
          var parts = t.key.split(" ");
          if (parts.every(function (p) { return cv.uniSet.has(p); })) { got += t.weight * 0.5; matched.push(t.label); }
          else missing.push(t.label);
        }
      } else if (cv.uniSet.has(t.key)) { got += t.weight; matched.push(t.label); }
      else missing.push(t.label);
    });
    return {
      termScore: total ? Math.round(got / total * 100) : 0,
      termCount: terms.length,
      matched: matched,
      missing: missing
    };
  }

  function monthOf(s) { return s ? MONTHS.indexOf(s.slice(0, 3)) : -1; }

  function detectYears(text, now) {
    now = now || new Date();
    var t = String(text || "").toLowerCase();

    var explicit = null, m;
    var re = /(\d{1,2})(?:\.\d)?\s*\+?\s*(?:years?|yrs?)\b/g;
    while ((m = re.exec(t))) {
      var ctx = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
      var v = +m[1];
      if (/experience|expertise|professional/.test(ctx) && v >= 1 && v <= 45) explicit = Math.max(explicit || 0, v);
    }
    if (explicit) return { years: explicit, source: "stated in your CV" };

    t = t.replace(/\b(\d{1,2})\s*\/\s*((?:19|20)\d{2})\b/g, function (_, mm, yy) {
      var i = +mm - 1; return (MONTHS[i] || "jan") + " " + yy;
    });
    var mon = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";
    var rr = new RegExp("(?:" + mon + "[a-z]*\\.?\\s+)?((?:19|20)\\d{2})\\s*(?:-|\u2013|\u2014|to|till|until)\\s*(?:" + mon + "[a-z]*\\.?\\s+)?((?:19|20)\\d{2}|present|current|till date|date|now|ongoing)", "g");
    var nowY = now.getFullYear() + now.getMonth() / 12;
    var spans = [];
    while ((m = rr.exec(t))) {
      var before = t.slice(Math.max(0, m.index - 70), m.index);
      if (/(b\.?e|b\.?tech|m\.?tech|degree|university|college|school|diploma|mba|bachelor|master|hsc|sslc|graduat)/.test(before.slice(-70))) continue;
      var sm = monthOf(m[1]), em = monthOf(m[3]);
      var s = +m[2] + (sm >= 0 ? sm / 12 : 0);
      var e;
      if (/^\d/.test(m[4])) e = +m[4] + (em >= 0 ? (em + 1) / 12 : 0.5);
      else e = nowY;
      if (s >= 1970 && e >= s && e <= nowY + 0.1) spans.push([s, e]);
    }
    if (!spans.length) return { years: null, source: "not found" };
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var total = 0, cs = spans[0][0], ce = spans[0][1];
    for (var i = 1; i < spans.length; i++) {
      if (spans[i][0] <= ce) ce = Math.max(ce, spans[i][1]);
      else { total += ce - cs; cs = spans[i][0]; ce = spans[i][1]; }
    }
    total += ce - cs;
    return { years: Math.round(total), source: "estimated from work dates in your CV" };
  }

  function requiredYears(text) {
    var t = String(text || "").toLowerCase(), best = null, m;
    var re = /(\d{1,2})\s*\+?\s*(?:(?:-|\u2013|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)\b/g;
    while ((m = re.exec(t))) {
      var ctx = t.slice(Math.max(0, m.index - 80), m.index + m[0].length + 80);
      var v = +m[1];
      if (/experience/.test(ctx) && v >= 1 && v <= 30) best = Math.max(best || 0, v);
    }
    return best;
  }

  function combine(termScore, cvYears, reqYears) {
    if (cvYears > 0 && reqYears > 0) {
      var exp = cvYears >= reqYears ? 100 : Math.max(30, Math.round(cvYears / reqYears * 100));
      return Math.round(termScore * 0.8 + exp * 0.2);
    }
    return termScore;
  }

  function verdict(score) {
    if (score >= 75) return { label: "Strong match", cls: "green" };
    if (score >= 50) return { label: "Possible match", cls: "yellow" };
    return { label: "Low match", cls: "red" };
  }

  var api = {
    buildCv: buildCv, analyze: analyze, detectYears: detectYears,
    requiredYears: requiredYears, combine: combine, verdict: verdict
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Matcher = api;
})(typeof window !== "undefined" ? window : this);