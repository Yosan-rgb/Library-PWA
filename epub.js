// epub.min.js — minimal EPUB renderer for the library PWA
// Replaces the 22k-line epubjs CDN build. Requires JSZip (already loaded).
// Implements the exact API surface used in reader.js.
// v2: column CSS pagination, EPUB CSS preserved, highlights persist across chapters, blob URL cleanup

(function (global) {
  "use strict";

  // ─── tiny helpers ────────────────────────────────────────────────────────────

  function parseXml(str) {
    return new DOMParser().parseFromString(str, "application/xml");
  }

  // resolve a relative path against a base dir, e.g. "OEBPS/" + "../img/x.jpg" → "img/x.jpg"
  function resolvePath(base, rel) {
    if (!rel || rel.startsWith("http") || rel.startsWith("data:")) return rel;
    var parts = (base + rel).split("/");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "..") out.pop();
      else if (parts[i] !== ".") out.push(parts[i]);
    }
    return out.join("/");
  }

  // our position format: "epos:chapterIndex:scrollFraction"
  function encodeCfi(chapterIndex, frac) {
    return "epos:" + chapterIndex + ":" + frac.toFixed(5);
  }

  function decodeCfi(cfi) {
    if (!cfi) return null;
    var m = cfi.match(/^epos:(\d+):([\d.]+)$/);
    if (m) return { idx: parseInt(m[1]), frac: parseFloat(m[2]) };
    return null; // real epubjs CFI — gracefully reset to ch 0
  }

  // FIX 3 helper — find a text string in the DOM and wrap it in a <mark> tag
  function wrapTextInMark(doc, searchText) {
    if (!searchText || !searchText.trim()) return null;
    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    var lower = searchText.toLowerCase();
    while ((node = walker.nextNode())) {
      var idx = node.textContent.toLowerCase().indexOf(lower);
      if (idx === -1) continue;
      try {
        var range = doc.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + searchText.length);
        var mark = doc.createElement("mark");
        mark.setAttribute("data-highlight", "true");
        range.surroundContents(mark);
        return mark;
      } catch (e) {
        // text spans element boundaries — skip gracefully
      }
    }
    return null;
  }

  // ─── ePub(arrayBuffer) ───────────────────────────────────────────────────────

  global.ePub = function (arrayBuffer) {

    var book = {
      _zip:      null,
      _dir:      "",
      _chapters: [],   // [{id, href, path}]
      _toc:      [],   // [{label, href}]

      ready:    null,
      spine:    { spineItems: [] },
      locations: null,
      loaded:   { navigation: null },

      // used by reader.js search: epub.load.bind(epub)
      load: function (href) {
        var ch = book._chapters.find(function (c) {
          return c.href === href || c.path === href;
        });
        if (!ch || !book._zip) return Promise.resolve("");
        var f = book._zip.file(ch.path);
        return f ? f.async("text") : Promise.resolve("");
      },

      renderTo: function (elementId, options) {
        return Rendition(book, elementId, options || {});
      }
    };

    // locations — percentage tracking
    book.locations = {
      _ready: false,
      generate: function () { this._ready = true; return Promise.resolve(); },
      length:   function () { return this._ready ? 999 : 0; },
      percentageFromCfi: function (cfi) {
        var pos = decodeCfi(cfi);
        if (!pos) return 0;
        return (pos.idx + pos.frac) / Math.max(book._chapters.length, 1);
      }
    };

    // ── parse the EPUB ZIP ──
    book.ready = JSZip.loadAsync(arrayBuffer).then(async function (zip) {
      book._zip = zip;

      // 1. find OPF package file via container.xml
      var containerXml = await zip.file("META-INF/container.xml").async("text");
      var opfPath = parseXml(containerXml)
        .querySelector("[full-path]").getAttribute("full-path");
      book._dir = opfPath.includes("/")
        ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

      // 2. parse OPF for manifest + reading order (spine)
      var opfXml = await zip.file(opfPath).async("text");
      var opfDoc = parseXml(opfXml);
      var manifest = {};
      opfDoc.querySelectorAll("manifest item").forEach(function (el) {
        manifest[el.getAttribute("id")] = {
          href: el.getAttribute("href"),
          type: el.getAttribute("media-type") || ""
        };
      });
      opfDoc.querySelectorAll("spine itemref").forEach(function (ref) {
        var id   = ref.getAttribute("idref");
        var item = manifest[id];
        if (item && item.type.includes("xhtml")) {
          book._chapters.push({
            id:   id,
            href: item.href,
            path: resolvePath(book._dir, item.href)
          });
        }
      });

      // 3. spine items with search support (used by reader.js search)
      book.spine.spineItems = book._chapters.map(function (ch, i) {
        return {
          id: ch.id, idref: ch.id, href: ch.href, index: i,
          _html: null,
          load: function (loader) {
            var self = this;
            return loader(ch.href).then(function (html) { self._html = html; });
          },
          find: function (query) {
            if (!this._html) return [];
            var tmp = document.createElement("div");
            tmp.innerHTML = this._html;
            var fullText = tmp.textContent;
            var lower = query.toLowerCase();
            var hits = [], pos = fullText.toLowerCase().indexOf(lower);
            while (pos !== -1 && hits.length < 15) {
              hits.push({
                cfi:    encodeCfi(i, 0),
                excerpt: fullText.slice(Math.max(0, pos - 50), pos + query.length + 50).trim()
              });
              pos = fullText.toLowerCase().indexOf(lower, pos + 1);
            }
            return hits;
          },
          unload: function () { this._html = null; }
        };
      });

      // 4. table of contents — try NCX (EPUB2) then nav.xhtml (EPUB3)
      try {
        var ncxMeta = Object.values(manifest).find(function (m) { return m.type.includes("ncx"); });
        if (ncxMeta) {
          var ncxXml = await zip.file(resolvePath(book._dir, ncxMeta.href)).async("text");
          parseXml(ncxXml).querySelectorAll("navPoint").forEach(function (np) {
            var label = np.querySelector("navLabel text");
            var src   = np.querySelector("content");
            if (label && src) book._toc.push({
              label: label.textContent.trim(),
              href:  src.getAttribute("src").split("#")[0]
            });
          });
        }
      } catch (e) { /* NCX not present */ }

      if (!book._toc.length) {
        try {
          var navMeta = Object.values(manifest).find(function (m) {
            return m.type.includes("html") && m.href && m.href.includes("nav");
          });
          if (navMeta) {
            var navHtml = await zip.file(resolvePath(book._dir, navMeta.href)).async("text");
            new DOMParser().parseFromString(navHtml, "text/html")
              .querySelectorAll("nav a").forEach(function (a) {
                var href = a.getAttribute("href");
                if (href) book._toc.push({ label: a.textContent.trim(), href: href.split("#")[0] });
              });
          }
        } catch (e) { /* no nav either */ }
      }
    });

    book.loaded.navigation = book.ready.then(function () { return { toc: book._toc }; });
    return book;
  };


  // ─── Rendition ───────────────────────────────────────────────────────────────

  function Rendition(book, elementId, options) {
    var wrap = typeof elementId === "string"
      ? document.getElementById(elementId) : elementId;

    // reading state
    var iframe     = null;
    var chIdx      = 0;
    var page       = 0;
    var pageCount  = 1;
    var scrollMode = options.flow === "scrolled-doc";

    // appearance — layered as overrides on top of the book's own CSS
    var fontSize   = 100;
    var fontFamily = null;    // null = respect the book's own font
    var bgColor    = "#ffffff";
    var textColor  = "#1a1a1a";

    var listeners        = { relocated: [], rendered: [], selected: [] };
    var registeredThemes = {};

    // FIX 3 — highlight persistence store: cfi → {text, chIdx}
    var storedHighlights = {};

    // FIX 4 — blob URLs for current chapter, all revoked on next chapter load
    var activeBlobUrls = [];

    function revokeBlobUrls() {
      activeBlobUrls.forEach(function (u) { URL.revokeObjectURL(u); });
      activeBlobUrls = [];
    }

    // ── iframe ──

    function buildIframe() {
      if (iframe) iframe.remove();
      iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
      iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:none;background:" + bgColor + ";";
      wrap.style.position  = "relative";
      wrap.appendChild(iframe);
    }

    function iDoc() {
      return iframe && (iframe.contentDocument || iframe.contentWindow.document);
    }

    // ── FIX 2 — extract and preserve the book's own CSS ──
    // Pulls inline <style> blocks and resolves <link> stylesheets from ZIP
    // Returns a single CSS string to inject before our overrides.

    async function extractBookCss(rawHtml, chDir) {
      var headMatch = rawHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      if (!headMatch) return "";
      var headHtml = headMatch[1];
      var css = "";

      // collect inline <style> blocks
      var styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      var sm;
      while ((sm = styleRe.exec(headHtml)) !== null) {
        css += sm[1] + "\n";
      }

      // resolve and inline linked stylesheets
      var linkRe = /<link[^>]+href="([^"]+)"[^>]*>/gi;
      var lm;
      while ((lm = linkRe.exec(headHtml)) !== null) {
        if (!/stylesheet/i.test(lm[0])) continue;
        try {
          var cssFile = book._zip.file(resolvePath(chDir, lm[1]));
          if (cssFile) css += await cssFile.async("text") + "\n";
        } catch (e) { /* stylesheet not found in ZIP */ }
      }

      return css;
    }

    // ── chapter loading ──

    async function loadChapter(idx, startFrac) {
      await book.ready;
      if (!book._chapters.length) return;

      revokeBlobUrls(); // FIX 4 — free memory from previous chapter

      idx   = Math.max(0, Math.min(idx, book._chapters.length - 1));
      chIdx = idx;
      page  = 0;

      var ch  = book._chapters[idx];
      var raw = "";
      try {
        raw = await book._zip.file(ch.path).async("text");
      } catch (e) {
        raw = "<html><body><p>Could not load this chapter.</p></body></html>";
      }

      var chDir = ch.path.includes("/")
        ? ch.path.slice(0, ch.path.lastIndexOf("/") + 1) : book._dir;

      // FIX 2 — grab the book's own styles before rewriting the page
      var bookCss = await extractBookCss(raw, chDir);

      // resolve image src attributes → blob URLs so they display correctly
      var imgRe = /src="([^"]+)"/gi;
      var im;
      while ((im = imgRe.exec(raw)) !== null) {
        var src = im[1];
        if (!src.startsWith("http") && !src.startsWith("data:")) {
          try {
            var zipImg = book._zip.file(resolvePath(chDir, src));
            if (zipImg) {
              var blobUrl = URL.createObjectURL(await zipImg.async("blob"));
              activeBlobUrls.push(blobUrl); // FIX 4 — track for revocation
              raw = raw.split('src="' + src + '"').join('src="' + blobUrl + '"');
            }
          } catch (e) { /* image not in ZIP */ }
        }
      }

      var bodyMatch   = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      var bodyContent = bodyMatch ? bodyMatch[1] : raw;

      var viewW = iframe.clientWidth  || wrap.clientWidth  || window.innerWidth;
      var viewH = iframe.clientHeight || wrap.clientHeight || window.innerHeight;

      var doc = iDoc();
      doc.open();
      doc.write(buildPageHtml(bodyContent, bookCss, viewW, viewH));
      doc.close();

      // wait for layout before measuring columns or restoring scroll
      await new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 80); }); });

      if (!scrollMode) {
        recalcPages(doc, viewW);
        if (startFrac > 0) {
          page = Math.min(Math.round(startFrac * (pageCount - 1)), pageCount - 1);
        }
        jumpToPage(doc, page, viewW);
      } else if (startFrac > 0) {
        var el = doc.documentElement;
        el.scrollTop = startFrac * Math.max(1, el.scrollHeight - el.clientHeight);
      }

      reapplyHighlights(idx, doc); // FIX 3

      var view = { document: doc, window: iframe.contentWindow };
      listeners.rendered.forEach(function (fn) { fn({ index: idx }, view); });

      // fire selected when user releases a text selection in the iframe
      function onSelectionEnd() {
        var sel  = doc.getSelection();
        var text = sel ? sel.toString().trim() : "";
        if (text.length > 1) {
          var cfi = encodeCfi(chIdx, getScrollFrac(doc));
          listeners.selected.forEach(function (fn) {
            fn(cfi, { window: iframe.contentWindow });
          });
        }
      }
      doc.addEventListener("mouseup",  onSelectionEnd);
      doc.addEventListener("touchend", onSelectionEnd, { passive: true });

      fireRelocated(doc);
    }

    // ── FIX 1 — column-based pagination ──
    // Content sits in a full-height CSS columns container.
    // Pages are revealed by translating that container left by (page * viewW).

    function buildPageHtml(bodyContent, bookCss, viewW, viewH) {

      // our overrides — come AFTER bookCss so they win specificity where needed
      var overrides =
        "body{margin:0!important;padding:0!important;overflow:hidden!important;" +
          "background:" + bgColor + "!important;}" +
        "img{max-width:100%!important;height:auto!important;display:block!important;}" +
        "mark{background:rgba(255,224,102,0.5)!important;border-radius:2px!important;}" +
        (fontFamily
          ? "body,p,span,div,li,h1,h2,h3,h4{font-family:" + fontFamily + "!important;}"
          : "") +
        "body{color:" + textColor + "!important;font-size:" + fontSize + "%!important;}";

      var layoutCss;
      if (scrollMode) {
        layoutCss =
          "html,body{margin:0;padding:0;height:auto;overflow-x:hidden;background:" + bgColor + ";}" +
          "#rdr-wrap{padding:20px 24px;box-sizing:border-box;line-height:1.75;" +
            "background:" + bgColor + ";color:" + textColor + ";}";
      } else {
        // FIX 1 — each column is exactly viewW wide.
        // column-width sets content width; column-gap fills the rest so column boxes = viewW.
        // We use translateX to move between columns without JS scrolling.
        var contentW = viewW - 56; // 28px padding each side
        var gapW     = 56;
        layoutCss =
          "html,body{margin:0;padding:0;width:" + viewW + "px;height:" + viewH + "px;" +
            "overflow:hidden;background:" + bgColor + ";}" +
          "#rdr-wrap{" +
            "position:absolute;top:0;left:0;" +
            "height:" + viewH + "px;" +
            "padding:20px 28px;" +
            "box-sizing:border-box;" +
            "column-width:" + contentW + "px;" +
            "column-gap:" + gapW + "px;" +
            "column-fill:auto;" +
            "-webkit-column-width:" + contentW + "px;" +
            "-webkit-column-fill:auto;" +
            "overflow:hidden;" +
            "line-height:1.75;" +
            "word-wrap:break-word;overflow-wrap:break-word;" +
            "will-change:transform;" +
          "}";
      }

      return "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
        "<style>" + (bookCss || "") + "</style>" +   // 1. book's own CSS
        "<style>" + overrides + "</style>" +           // 2. our theme/font overrides
        "<style>" + layoutCss + "</style>" +           // 3. pagination layout
        "</head><body>" +
        "<div id='rdr-wrap'>" + bodyContent + "</div>" +
        "</body></html>";
    }

    // FIX 1 — page count from the column container's scrollWidth
    function recalcPages(doc, viewW) {
      var rdrWrap = doc.getElementById("rdr-wrap");
      pageCount = rdrWrap
        ? Math.max(1, Math.round(rdrWrap.scrollWidth / viewW))
        : 1;
    }

    // FIX 1 — navigate by translating the column container
    function jumpToPage(doc, p, viewW) {
      var w       = viewW || iframe.clientWidth || window.innerWidth;
      var rdrWrap = doc && doc.getElementById("rdr-wrap");
      if (rdrWrap) rdrWrap.style.transform = "translateX(-" + (p * w) + "px)";
    }

    function getScrollFrac(doc) {
      var el  = doc ? doc.documentElement : null;
      if (!el) return 0;
      var max = Math.max(1, el.scrollHeight - el.clientHeight);
      return el.scrollTop / max;
    }

    function fireRelocated(doc) {
      var frac = scrollMode
        ? getScrollFrac(doc || iDoc())
        : page / Math.max(1, pageCount - 1);
      listeners.relocated.forEach(function (fn) {
        fn({ start: { cfi: encodeCfi(chIdx, frac), displayed: { page: page + 1, total: pageCount } } });
      });
    }

    // FIX 3 — re-apply highlights for a specific chapter after it renders
    function reapplyHighlights(idx, doc) {
      Object.keys(storedHighlights).forEach(function (cfi) {
        var h = storedHighlights[cfi];
        if (h.chIdx === idx) wrapTextInMark(doc, h.text);
      });
    }

    // ── build iframe and return the public rendition object ──

    buildIframe();
    window.addEventListener("beforeunload", revokeBlobUrls); // FIX 4

    return {

      flow: function (mode) {
        scrollMode = (mode === "scrolled-doc");
        if (book._chapters.length) loadChapter(chIdx, 0);
      },

      display: function (cfi) {
        return book.ready.then(function () {
          if (!cfi) return loadChapter(0, 0);
          var pos = decodeCfi(cfi);
          if (pos) return loadChapter(Math.min(pos.idx, book._chapters.length - 1), pos.frac);
          var i = book._chapters.findIndex(function (c) {
            return c.href === cfi || c.path.endsWith(cfi) || cfi.endsWith(c.href);
          });
          return loadChapter(i >= 0 ? i : 0, 0);
        });
      },

      next: function () {
        var doc   = iDoc();
        var viewW = iframe.clientWidth || window.innerWidth;
        if (!scrollMode && page < pageCount - 1) {
          page++;
          jumpToPage(doc, page, viewW);
          fireRelocated(doc);
        } else if (chIdx < book._chapters.length - 1) {
          loadChapter(chIdx + 1, 0);
        }
      },

      prev: function () {
        var doc   = iDoc();
        var viewW = iframe.clientWidth || window.innerWidth;
        if (!scrollMode && page > 0) {
          page--;
          jumpToPage(doc, page, viewW);
          fireRelocated(doc);
        } else if (chIdx > 0) {
          loadChapter(chIdx - 1, scrollMode ? 0 : 1);
        }
      },

      currentLocation: function () {
        var doc  = iDoc();
        var frac = scrollMode
          ? getScrollFrac(doc)
          : page / Math.max(1, pageCount - 1);
        return {
          start: {
            cfi:       encodeCfi(chIdx, frac),
            displayed: { page: page + 1, total: pageCount }
          }
        };
      },

      on: function (event, fn) {
        if (listeners[event]) listeners[event].push(fn);
        return this;
      },

      getContents: function () {
        var doc = iDoc();
        return doc ? [{ document: doc, window: iframe.contentWindow }] : [];
      },

      // ── themes ──
      themes: {
        register: function (name, theme) { registeredThemes[name] = theme; },

        select: function (name) {
          var t = registeredThemes[name];
          if (!t || !t.body) return;
          bgColor   = t.body.background || bgColor;
          textColor = t.body.color      || textColor;
          // reload the chapter so background fills and colors update fully
          var frac = page / Math.max(1, pageCount - 1);
          loadChapter(chIdx, frac);
        },

        fontSize: function (pct) {
          fontSize = parseInt(pct) || 100;
          var doc  = iDoc();
          var rw   = doc && doc.getElementById("rdr-wrap");
          if (rw) rw.style.fontSize = pct;
        },

        override: function (prop, val) {
          if (prop === "font-family") {
            fontFamily = val;
            var doc = iDoc();
            var rw  = doc && doc.getElementById("rdr-wrap");
            if (rw) rw.style.fontFamily = val;
          }
        }
      },

      // ── annotations (highlights) ──
      // FIX 3 — captures the selected text at highlight time and stores it
      // so it can be re-applied when the same chapter is loaded again

      annotations: {
        highlight: function (cfi) {
          var doc = iDoc();
          if (!doc) return;
          try {
            var sel  = iframe.contentWindow.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            var text = sel.toString().trim();
            if (!text) return;
            var range = sel.getRangeAt(0).cloneRange();
            var mark  = doc.createElement("mark");
            mark.setAttribute("data-cfi", cfi);
            range.surroundContents(mark);
            sel.removeAllRanges();
            storedHighlights[cfi] = { text: text, chIdx: chIdx }; // FIX 3 — persist
          } catch (e) {
            console.warn("Highlight apply failed:", e.message);
          }
        },

        remove: function (cfi) {
          var doc = iDoc();
          if (doc) {
            // CSS.escape handles any special chars in the CFI string
            var escaped = typeof CSS !== "undefined" && CSS.escape
              ? CSS.escape(cfi) : cfi.replace(/:/g, "\\:");
            var mark = doc.querySelector("mark[data-cfi='" + escaped + "']");
            if (mark && mark.parentNode) {
              var parent = mark.parentNode;
              while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
              parent.removeChild(mark);
            }
          }
          delete storedHighlights[cfi]; // FIX 3 — remove from persistence too
        }
      }

    }; // end rendition
  } // end Rendition()

})(window);