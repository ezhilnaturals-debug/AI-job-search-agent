/* app.js - UI logic. No preset skills, titles, locations or experience: all inputs come from the user's CV and filters. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var cv = null;
  var feed = { jobs: [], updated: "" };
  var pageSize = 25, shown = pageSize;

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function toText(html) {
    html = String(html || "");
    if (html.indexOf("<") === -1) return html;
    return (new DOMParser().parseFromString(html, "text/html").body.textContent || "").replace(/\s+/g, " ").trim();
  }
  function chips(list, cls, max) {
    return list.slice(0, max || 30).map(function (s) { return "<span class='tag " + (cls || "") + "'>" + esc(s) + "</span>"; }).join("");
  }
  function myYears() {
    var v = parseFloat($("myyears").value);
    return v > 0 ? v : 0;
  }

  /* ---------- 1. CV upload ---------- */
  $("cv").addEventListener("change", async function () {
    var file = this.files[0];
    if (!file) return;
    var status = $("cvstatus");
    status.textContent = "Reading CV...";
    try {
      var name = file.name.toLowerCase(), text = "";
      if (name.endsWith(".txt")) {
        text = await file.text();
      } else if (name.endsWith(".pdf")) {
        if (!window.pdfjsLib) throw new Error("PDF reader not loaded");
        var pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        for (var i = 1; i <= pdf.numPages; i++) {
          var page = await pdf.getPage(i);
          var content = await page.getTextContent();
          text += content.items.map(function (x) { return x.str; }).join(" ") + "\n";
        }
      } else {
        throw new Error("Unsupported file");
      }
      if (text.trim().length < 100) throw new Error("No readable text");
      cv = Matcher.buildCv(text);
      status.textContent = "CV loaded (" + text.length + " characters read).";
      showProfile();
      scoreAll();
      renderJobs();
    } catch (e) {
      cv = null;
      $("profile").style.display = "none";
      status.textContent = "Could not read this CV. Use a text-based PDF (not a scan) or a TXT file.";
      renderJobs();
    }
  });

  function showProfile() {
    var det = Matcher.detectYears(cv.text);
    $("myyears").value = det.years || "";
    $("yearsnote").textContent = det.years
      ? "Detected " + det.years + " years (" + det.source + "). Change it if wrong."
      : "Could not detect experience in your CV. Enter it to include experience in scores.";
    $("cvterms").innerHTML = cv.topTerms.length
      ? chips(cv.topTerms.map(function (t) { return t.label; }), "", 24)
      : "<span class='note'>No repeated terms found.</span>";
    $("profile").style.display = "block";
  }

  /* ---------- 2. Job feed from jobs.json ---------- */
  function loadFeed() {
    fetch("jobs.json", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        feed.updated = d.updated_at || "";
        feed.jobs = (d.jobs || []).map(function (j) {
          var text = toText(j.description);
          return {
            title: j.title || "", company: j.company || "", location: j.location || "",
            date: j.date || "", url: j.url || "", source: j.source || "", tags: j.tags || [],
            text: text, req: Matcher.requiredYears(text), a: null, score: 0
          };
        });
        var sources = {};
        feed.jobs.forEach(function (j) { if (j.source) sources[j.source] = 1; });
        $("f_source").innerHTML = "<option value=''>Any source</option>" +
          Object.keys(sources).sort().map(function (s) { return "<option>" + esc(s) + "</option>"; }).join("");
        if (cv) scoreAll();
        renderJobs();
      })
      .catch(function () {
        $("joblist").innerHTML = "<p class='note'>Job feed (jobs.json) could not be loaded.</p>";
      });
  }

  function scoreAll() {
    feed.jobs.forEach(function (j) {
      j.a = Matcher.analyze(j.title, j.text, cv);
    });
    rescore();
  }
  function rescore() {
    var y = myYears();
    feed.jobs.forEach(function (j) { if (j.a) j.score = Matcher.combine(j.a.termScore, y, j.req); });
  }

  /* ---------- filters ---------- */
  function readFilters() {
    return {
      kw: $("f_kw").value.split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean),
      loc: $("f_loc").value.trim().toLowerCase(),
      world: $("f_world").checked,
      source: $("f_source").value,
      days: parseInt($("f_days").value, 10) || 0,
      min: parseInt($("f_min").value, 10) || 0,
      hide: $("f_hide").checked,
      sort: $("f_sort").value
    };
  }
  function hasPhrase(hay, phrase) {
    var re = new RegExp("(^|[^a-z0-9])" + phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9])");
    return re.test(hay);
  }
  function passes(j, f) {
    if (f.kw.length) {
      var hay = (j.title + " " + j.tags.join(" ") + " " + j.text).toLowerCase();
      if (!f.kw.some(function (k) { return hasPhrase(hay, k); })) return false;
    }
    if (f.loc) {
      var l = j.location.toLowerCase();
      var ok = l.indexOf(f.loc) !== -1;
      if (!ok && f.world) ok = /worldwide|anywhere|global|remote/.test(l) && !/(us|usa|uk|canada|europe|emea|eu)\s*(only|based)?$/.test(l);
      if (!ok) return false;
    }
    if (f.source && j.source !== f.source) return false;
    if (f.days) {
      var t = Date.parse(j.date);
      if (!t || (Date.now() - t) / 86400000 > f.days) return false;
    }
    if (j.score < f.min) return false;
    if (f.hide && j.req && myYears() && j.req > myYears()) return false;
    return true;
  }

  function renderJobs() {
    var box = $("joblist");
    if (!cv) {
      box.innerHTML = "<p class='note'>Upload your CV to see jobs ranked against it.</p>";
      $("jobmeta").textContent = "";
      return;
    }
    if (!feed.jobs.length) return;
    var f = readFilters();
    var list = feed.jobs.filter(function (j) { return passes(j, f); });
    list.sort(f.sort === "date"
      ? function (a, b) { return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0); }
      : function (a, b) { return b.score - a.score; });

    $("jobmeta").textContent = list.length + " of " + feed.jobs.length + " jobs match your filters" +
      (feed.updated ? " \u2022 feed updated " + new Date(feed.updated).toLocaleDateString() : "");

    if (!list.length) {
      box.innerHTML = "<p class='note'>No jobs match these filters. Loosen a filter or try different keywords.</p>";
      return;
    }
    var html = list.slice(0, shown).map(function (j) {
      var v = Matcher.verdict(j.score);
      var meta = [j.company, j.location, j.source, j.date ? new Date(j.date).toLocaleDateString() : ""].filter(Boolean).map(esc).join(" \u2022 ");
      var safeUrl = /^https?:\/\//i.test(j.url) ? j.url : "#";
      return "<div class='job'>" +
        "<div class='jobtop'><div><b>" + esc(j.title) + "</b><div class='note'>" + meta + "</div></div>" +
        "<div class='badge " + v.cls + "'>" + j.score + "%</div></div>" +
        (j.req ? "<div class='note'>Asks for about " + j.req + "+ years experience</div>" : "") +
        "<details><summary>Why this score</summary>" +
        (j.a.matched.length ? "<p class='green small'>In your CV</p>" + chips(j.a.matched, "", 20) : "") +
        (j.a.missing.length ? "<p class='yellow small'>Not found in your CV</p>" + chips(j.a.missing, "", 20) : "") +
        "</details>" +
        "<a class='btn' href='" + esc(safeUrl) + "' target='_blank' rel='noopener noreferrer'>Open job \u2197</a></div>";
    }).join("");
    if (list.length > shown) html += "<button class='secondary' id='more'>Show more (" + (list.length - shown) + " left)</button>";
    box.innerHTML = html;
    var more = $("more");
    if (more) more.onclick = function () { shown += pageSize; renderJobs(); };
  }

  ["f_kw", "f_loc"].forEach(function (id) { $(id).addEventListener("input", function () { shown = pageSize; renderJobs(); }); });
  ["f_world", "f_source", "f_days", "f_hide", "f_sort"].forEach(function (id) { $(id).addEventListener("change", function () { shown = pageSize; renderJobs(); }); });
  $("f_min").addEventListener("input", function () { $("f_min_val").textContent = this.value + "%"; shown = pageSize; renderJobs(); });
  $("myyears").addEventListener("input", function () { if (cv) { rescore(); renderJobs(); } });

  /* ---------- search links ---------- */
  $("searchbtn").addEventListener("click", function () {
    var kw = $("f_kw").value.split(",")[0].trim();
    var note = "";
    if (!kw && cv && cv.topTerms.length) {
      var phrases = cv.topTerms.filter(function (t) { return t.n === 2; });
      var pick = phrases.length ? phrases.slice(0, 2) : cv.topTerms.slice(0, 2);
      kw = pick.map(function (t) { return t.label; }).join(" ");
      note = "No keyword entered, so your CV's top terms were used: " + kw;
    }
    if (!kw) {
      $("searchlinks").innerHTML = "<p class='note'>Enter a keyword in the filters, or upload your CV first.</p>";
      return;
    }
    var loc = $("f_loc").value.trim();
    var q = encodeURIComponent, slug = function (s) { return q(s.toLowerCase().replace(/\s+/g, "-")); };
    var links = [
      ["LinkedIn Jobs", "https://www.linkedin.com/jobs/search/?keywords=" + q(kw) + (loc ? "&location=" + q(loc) : "")],
      ["Indeed", "https://in.indeed.com/jobs?q=" + q(kw) + (loc ? "&l=" + q(loc) : "")],
      ["Naukri", "https://www.naukri.com/" + slug(kw) + "-jobs" + (loc ? "-in-" + slug(loc) : "")],
      ["Google Jobs", "https://www.google.com/search?q=" + q(kw + " jobs" + (loc ? " " + loc : ""))]
    ];
    $("searchlinks").innerHTML = (note ? "<p class='note'>" + esc(note) + "</p>" : "") +
      links.map(function (l) { return "<a class='btn' href='" + l[1] + "' target='_blank' rel='noopener noreferrer'>" + l[0] + " \u2197</a>"; }).join("");
  });

  /* ---------- 3. Analyze one pasted job ---------- */
  $("analyzebtn").addEventListener("click", function () {
    if (!cv) { alert("Please upload your CV first."); return; }
    var jd = $("jd").value.trim();
    if (!jd) { alert("Please paste the job description."); return; }
    var title = $("title").value.trim(), company = $("company").value.trim();
    var a = Matcher.analyze(title, jd, cv);
    var typed = parseFloat($("years").value);
    var req = typed > 0 ? typed : Matcher.requiredYears(jd);
    var y = myYears();
    var score = Matcher.combine(a.termScore, y, req);
    var v = Matcher.verdict(score);

    var exp;
    if (req && y) exp = y >= req
      ? "<p class='green'>Your " + y + " years meets the " + req + "+ years asked.</p>"
      : "<p class='yellow'>Possible gap: the job asks " + req + "+ years, your CV shows " + y + ".</p>";
    else if (req) exp = "<p class='note'>The job asks " + req + "+ years, but your experience is not set above, so it is not scored.</p>";
    else exp = "<p class='note'>No experience requirement found in this job, so experience is not scored.</p>";

    var html = "<div class='card'><h2>Job match report</h2>" +
      "<div class='score " + v.cls + "'>" + score + "%</div><h3 class='" + v.cls + "'>" + v.label + "</h3>" +
      "<p><b>" + esc(title || "Job role") + "</b>" + (company ? " \u2022 " + esc(company) : "") + "</p><hr>" +
      "<h3>Keyword coverage: " + a.termScore + "%</h3>" +
      "<p class='note'>Based on the " + a.termCount + " most important terms in this job description.</p>" +
      (a.matched.length ? "<h4 class='green'>Found in your CV</h4>" + chips(a.matched, "", 40) : "") +
      (a.missing.length ? "<h4 class='yellow'>Not found in your CV</h4>" + chips(a.missing, "", 40) +
        "<p class='note'>If you really have these skills, add them to your CV in the same words the job uses.</p>" : "") +
      "<hr><h3>Experience</h3>" + exp +
      "<p class='note'>This is a keyword-based estimate, not a recruiter's decision.</p></div>";
    $("report").innerHTML = html;
    $("report").scrollIntoView({ behavior: "smooth" });
  });

  $("f_min_val").textContent = $("f_min").value + "%";
  renderJobs();
  loadFeed();
})();