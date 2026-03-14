(function(global) {
  "use strict";

  function parseXml(str) {
    return new DOMParser().parseFromString(str, "application/xml");
  }

    //eeded this because epubs use relative paths everywhere and they kept breaking
  function resolvePath(base, rel) {
    if (!rel || rel.startsWith("http") || rel.startsWith("data:")) return rel;
    var parts = (base + rel).split("/");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "..") out.pop();
      else if (parts[i] !== ".") out.push(parts[i]);
    }
    return out.join("/")}

    //custom position format instead of real CFI strings because actual CFI
  //was way too complicated to implement. epos:chapterIndex:scrollFractio
  function encodeCfi(chIdx, frac) {
    return "epos:" + chIdx + ":" + frac.toFixed(5);
    }


  //decode it back - returns null if it's a real epubjs CFI (from old saved data)
  function decodeCfi(cfi) {
    if (!cfi) return null;
    var m = cfi.match(/^epos:(\d+):([\d.]+)$/);
    if (m) return { idx: parseInt(m[1]), frac: parseFloat(m[2]) };
    return null;
  }

  //finds a string in the iframe document and wraps it in a <mark>. used to re-apply highlights when a chapter reloads
  function highlightText(doc, text) {
    if (!text || !text.trim()) return null;

    ///https://developer.mozilla.org/en-US/docs/Web/API/TreeWalker
    var walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null, false);
    var node;
    var lower = text.toLowerCase();
    while ((node = walker.nextNode())) {
      var idx = node.textContent.toLowerCase().indexOf(lower);
      if (idx === -1) continue;
      try {
        var range = doc.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);
        var mark = doc.createElement("mark");
        mark.setAttribute("data-highlight", "true");
        range.surroundContents(mark);
        return mark;
      } catch(e) { /* text spans elements, skip */ } } 
    return null;
  } 

  global.ePub = function(arrayBuffer) {
    var book = {
      _zip: null,
      _dir: "",
      _chapters: [],
      _toc: [],
      ready: null,
      spine: { spineItems: [] }, locations: null, loaded: { navigation: null },

      load: function(href) {
        var ch = book._chapters.find(function(c) { return c.href === href || c.path === href; });
        if (!ch || !book._zip) return Promise.resolve("");
        var f = book._zip.file(ch.path);
        return f ? f.async("text") : Promise.resolve("");
      },

      renderTo: function(elementId, options) {
        return Rendition(book, elementId, options || {});
      }
     } ;

    book.locations = {
      _ready: false,
      generate: function() { this._ready = true; return Promise.resolve(); },
      length: function() { return this._ready ? 999 : 0; },
      percentageFromCfi: function(cfi) {
        var pos = decodeCfi(cfi);
        if (!pos) return 0;
        return (pos.idx + pos.frac) / Math.max(book._chapters.length, 1);
       }};

    //https://stuk.github.io/jszip/documentation/api_jszip/load_async.html
    book.ready = JSZip.loadAsync(arrayBuffer).then(async function(zip) {
      book._zip = zip;

      var containerXml = await zip.file("META-INF/container.xml").async("text");
      var opfPath = parseXml(containerXml).querySelector("[full-path]").getAttribute("full-path");
      book._dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

      var opfXml = await zip.file(opfPath).async("text");
      var opfDoc = parseXml(opfXml);
      var manifest = {};
      opfDoc.querySelectorAll("manifest item").forEach(function(el) {
        manifest[el.getAttribute("id")] = {
          href: el.getAttribute("href"),
          type: el.getAttribute("media-type") || ""
        };
      });
      opfDoc.querySelectorAll("spine itemref").forEach(function(ref) {
        var id = ref.getAttribute("idref");
        var item = manifest[id];
        if (item && item.type.includes("xhtml")) {
          book._chapters.push({ id: id, href: item.href, path: resolvePath(book._dir, item.href) });
        }
      });

      book.spine.spineItems = book._chapters.map(function(ch, i) {
        return {
          id: ch.id, idref: ch.id, href: ch.href, index: i,
          _html: null,
          load: function(loader) {
            var self = this;
            return loader(ch.href).then(function(html) { self._html = html; });
          },
          find: function(query) {
            if (!this._html) return [];
            var tmp = document.createElement("div");
            tmp.innerHTML = this._html;
            var fullText = tmp.textContent;
            var lower = query.toLowerCase();
            var hits = [], pos = fullText.toLowerCase().indexOf(lower);
            while (pos !== -1 && hits.length < 15) {
              hits.push({
                cfi: encodeCfi(i, 0),
                  excerpt: fullText.slice(Math.max(0, pos - 50), pos + query.length + 50).trim()
              });
              pos = fullText.toLowerCase().indexOf(lower, pos + 1);
            }
            return hits;
          },
          unload: function() { this._html = null; }
        };  });

      // try NCX first (epub2), then nav.xhtml (epub3)
      try {
        var ncxMeta = Object.values(manifest).find(function(m) { return m.type.includes("ncx"); });
        if (ncxMeta) {
          var ncxXml = await zip.file(resolvePath(book._dir, ncxMeta.href)).async("text");
          parseXml(ncxXml).querySelectorAll("navPoint").forEach(function(np) {
            var label = np.querySelector("navLabel text");
            var src = np.querySelector("content");
            if (label && src) book._toc.push({ label: label.textContent.trim(), href: src.getAttribute("src").split("#")[0] });
          });
        }
      } catch(e) {}


      if (!book._toc.length) {
        try {
          var navMeta = Object.values(manifest).find(function(m) {
            return m.type.includes("html") && m.href && m.href.includes("nav");
          });
      //https://developer.mozilla.org/en-US/docs/Web/API/DOMParser

          if (navMeta) {
            var navHtml = await zip.file(resolvePath(book._dir, navMeta.href)).async("text");
            new DOMParser().parseFromString(navHtml, "text/html")
              .querySelectorAll("nav a").forEach(function(a) {
                var href = a.getAttribute("href");
                if (href) book._toc.push({ label: a.textContent.trim(), href: href.split("#")[0] });
              });
        }
        } catch(e) {}
      }
    });

    book.loaded.navigation = book.ready.then(function() { return { toc: book._toc }; });
    return book;
  };


  function Rendition(book, elementId, options) {
    var wrap = typeof elementId === "string" ? document.getElementById(elementId) : elementId;

    var iframe = null;
    var chIdx = 0;
    var page = 0;
    var pageCount = 1;
    
    var scrollMode = options.flow === "scrolled-doc";
    var scrollPageCount = 1;

    var fontSize = 100;
    var fontFamily = null;
    var bgColor = "#ffffff";
    var textColor = "#1a1a1a";

    var listeners = { relocated: [], rendered: [], selected: [] };
    var registeredThemes = {};
    var savedHighlights = {};  // cfi → {text, chIdx}
    var blobUrls = [];         // cleaned up when chapter changes

    function clearImgs() {
      blobUrls.forEach(function(u) { URL.revokeObjectURL(u); });
      blobUrls = [];
    }

    function buildIframe() {
  if (iframe) iframe.remove();
  iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
  iframe.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:none;background:" + bgColor + ";z-index:0;";
  wrap.appendChild(iframe);
}

    function iDoc() {
      return iframe && (iframe.contentDocument || iframe.contentWindow.document);
    }

    // pull the book's own CSS out of the chapter file so styles are preserved
    async function getStyles(rawHtml, chDir) {
      var headMatch = rawHtml.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      if (!headMatch) return "";
      var headHtml = headMatch[1];
      var css = "";

      var styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
      var sm;
      while ((sm = styleRe.exec(headHtml)) !== null) css += sm[1] + "\n";

      var linkRe = /<link[^>]+href="([^"]+)"[^>]*>/gi;
      var lm;
      while ((lm = linkRe.exec(headHtml)) !== null) {
        if (!/stylesheet/i.test(lm[0])) continue;
        try {
          var f = book._zip.file(resolvePath(chDir, lm[1]));
          if (f) css += await f.async("text") + "\n";
        } catch(e) {}
      }
      return css;
    }

    //swap image src paths to blob URLs so they actually load inside the iframe
    //https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static
    async function prepBody(raw, chDir) {
      var imgRe = /src="([^"]+)"/gi;
      var im;
      while ((im = imgRe.exec(raw)) !== null) {
        var src = im[1];
        if (!src.startsWith("http") && !src.startsWith("data:")) {
          try {
          var zipImg = book._zip.file(resolvePath(chDir, src));
          if (zipImg) {
          var blobUrl = URL.createObjectURL(await zipImg.async("blob"));
            blobUrls.push(blobUrl);
            raw = raw.split('src="' + src + '"').join('src="' + blobUrl + '"'); }
          } catch(e) {}}  }


      var bodyMatch = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      return bodyMatch ? bodyMatch[1] : raw;
    }

    async function loadAll(startFrac) {
      await book.ready;
      if (!book._chapters.length) return;

      clearImgs();
      chIdx = 0; page = 0;

      var allCss = "";
      var sections = [];

      for (var i = 0; i < book._chapters.length; i++) {
        var ch = book._chapters[i];
           var raw = "";
        try { raw = await book._zip.file(ch.path).async("text"); }
        catch(e) { raw = "<p>Could not load chapter.</p>"; }

        var chDir = ch.path.includes("/") ? ch.path.slice(0, ch.path.lastIndexOf("/") + 1) : book._dir;
        if (i === 0) allCss = await getStyles(raw, chDir);

        var bodyHtml = await prepBody(raw, chDir);
        sections.push('<section id="ch-' + i + '" data-ch="' + i + '">' + bodyHtml + '</section>');
      }

      var viewW = window.innerWidth;
      var viewH = window.innerHeight;

      var doc = iDoc();
      doc.open();
      doc.write(makeHtml(sections.join("\n"), allCss, viewW, viewH));
      doc.close();

      //need this delay or scrollHeight isn't right yet
      await new Promise(function(r) { requestAnimationFrame(function() { setTimeout(r, 80); }); });

      var docEl = doc.documentElement;
      scrollPageCount = Math.max(1, Math.ceil(docEl.scrollHeight / viewH));

      if (startFrac > 0) {
        var el = doc.documentElement;
        el.scrollTop = startFrac * Math.max(1, el.scrollHeight - el.clientHeight);
      }

      Object.keys(savedHighlights).forEach(function(cfi) {
        highlightText(doc, savedHighlights[cfi].text);
      });

      var view = { document: doc, window: iframe.contentWindow };
      listeners.rendered.forEach(function(fn) { fn({ index: 0 }, view); });
      attachSelect(doc);
      trackScroll(doc);
      fireRelocated(doc); }

    function trackScroll(doc) {
  doc.addEventListener("scroll", function() {
    var el = doc.documentElement;
    var viewH = window.innerHeight;
    var scrollTop = el.scrollTop;
    var scrollHeight = el.scrollHeight;

    page = Math.floor(scrollTop / viewH);
    scrollPageCount = Math.max(1, Math.ceil(scrollHeight / viewH));
    pageCount = scrollPageCount;

    var sections = doc.querySelectorAll("section[data-ch]");
    var mid = scrollTop + viewH / 2;
    for (var i = sections.length - 1; i >= 0; i--) {
      if (sections[i].offsetTop <= mid) {
        chIdx = parseInt(sections[i].getAttribute("data-ch")) || 0;
        break;
      }
    }
    fireRelocated(doc);
  }, { passive: true });
}

    async function loadCh(idx, startFrac) {
      await book.ready;
      if (!book._chapters.length) return;

      clearImgs();
      idx = Math.max(0, Math.min(idx, book._chapters.length - 1));
      chIdx = idx; page = 0;

      var ch = book._chapters[idx];
      var raw = "";
      try { raw = await book._zip.file(ch.path).async("text"); }
      catch(e) { raw = "<html><body><p>Could not load this chapter.</p></body></html>"; }

      var chDir = ch.path.includes("/") ? ch.path.slice(0, ch.path.lastIndexOf("/") + 1) : book._dir;
      var bookCss = await getStyles(raw, chDir);
      var bodyContent = await prepBody(raw, chDir);

      var viewW = iframe.clientWidth || wrap.clientWidth || window.innerWidth;
      var viewH = iframe.clientHeight || wrap.clientHeight || window.innerHeight;

      var doc = iDoc();
      doc.open();
      doc.write(makeHtml(bodyContent, bookCss, viewW, viewH));
      doc.close();

      await new Promise(function(r) { requestAnimationFrame(function() { setTimeout(r, 80); }); });

      countPages(doc, viewW);
      if (startFrac > 0) page = Math.min(Math.round(startFrac * (pageCount - 1)), pageCount - 1);
      goToPage(doc, page, viewW);

      Object.keys(savedHighlights).forEach(function(cfi) {
        if (savedHighlights[cfi].chIdx === idx) highlightText(doc, savedHighlights[cfi].text);
      });

      var view = { document: doc, window: iframe.contentWindow };
      listeners.rendered.forEach(function(fn) { fn({ index: idx }, view); });
      attachSelect(doc);
      fireRelocated(doc);
     }

    function attachSelect(doc) {
      function onEnd() {
        var sel = doc.getSelection();
        var text = sel ? sel.toString().trim() : "";
        if (text.length > 1) {
          var cfi = encodeCfi(chIdx, getScrollFrac(doc));
          listeners.selected.forEach(function(fn) { fn(cfi, { window: iframe.contentWindow }); });
        }
      }
      doc.addEventListener("mouseup", onEnd);
      doc.addEventListener("touchend", onEnd, { passive: true });
    }

    // sing CSS columns for page by pageing - translating the container is the only
      // thing that worked reliably on safari, scrollLeft was broken
    function makeHtml(bodyContent, bookCss, viewW, viewH) {
      var overrides =
        "body{margin:0!important;padding:0!important;overflow:hidden!important;background:" + bgColor + "!important;}" +
        "img{max-width:100%!important;height:auto!important;display:block!important;}" +
        "mark{background:rgba(255,224,102,0.5)!important;border-radius:2px!important;}" +
        (fontFamily ? "body,p,span,div,li,h1,h2,h3,h4{font-family:" + fontFamily + "!important;}" : "") +
        "body{color:" + textColor + "!important;font-size:" + fontSize + "%!important;}";

      var layoutCss;
      if (scrollMode) {
        layoutCss =
          "html,body{margin:0;padding:0;height:auto;overflow-x:hidden;background:" + bgColor + ";}" +
          "#rdr-wrap{padding:20px 24px;box-sizing:border-box;line-height:1.75;background:" + bgColor + ";color:" + textColor + ";}";
      } else {

        
  // https://developer.mozilla.org/en-US/docs/Web/CSS/columns
  var contentW = viewW - 56;
        
        layoutCss =
          "html,body{margin:0;padding:0;width:" + viewW + "px;height:" + viewH + "px;overflow:hidden;background:" + bgColor + ";}" +
          "#rdr-wrap{" +
            "position:absolute;top:0;left:0;" +
            "height:" + viewH + "px;" +
            "padding:20px 28px;" +
            "box-sizing:border-box;" +
            "column-width:" + contentW + "px;" +
            "column-gap:56px;" +
            "column-fill:auto;" +
            "-webkit-column-width:" + contentW + "px;" +
            "-webkit-column-fill:auto;" +
            
            "line-height:1.75;" +
            "word-wrap:break-word;" +
            "will-change:transform;" +
          "}";
      }

      return "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
        "<style>" + (bookCss || "") + "</style>" +
        "<style>" + overrides + "</style>" +
        "<style>" + layoutCss + "</style>" +
        "</head><body><div id='rdr-wrap'>" + bodyContent + "</div></body></html>";
    }

    function countPages(doc, viewW) {
  var rw = doc.getElementById("rdr-wrap");
  var w = window.innerWidth;
  pageCount = rw ? Math.max(1, Math.round(rw.scrollWidth / w)) : 1;
}

    function goToPage(doc, p, viewW) {
  var w = window.innerWidth;
  var rw = doc && doc.getElementById("rdr-wrap");
  if (rw) rw.style.transform = "translateX(-" + (p * w) + "px)";
}

    function getScrollFrac(doc) {
      var el = doc ? doc.documentElement : null;
      if (!el) return 0;
      return el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);}

    function fireRelocated(doc) {
  var el = (doc || iDoc()) && (doc || iDoc()).documentElement;
  var viewH = window.innerHeight;
  var frac, displayPage, displayTotal;

  if (scrollMode) {
    var scrollTop = el ? el.scrollTop : 0;
    var scrollHeight = el ? el.scrollHeight : viewH;
    frac = scrollTop / Math.max(1, scrollHeight - viewH);
    displayPage = Math.max(1, Math.floor(scrollTop / viewH) + 1);
    displayTotal = Math.max(1, Math.ceil(scrollHeight / viewH));
  } else {
    frac = page / Math.max(1, pageCount - 1);
    displayPage = page + 1;
    displayTotal = pageCount;
  }

  listeners.relocated.forEach(function(fn) {
    fn({ start: { cfi: encodeCfi(chIdx, frac), displayed: { page: displayPage, total: displayTotal } } });
  });
}

    buildIframe();
    window.addEventListener("beforeunload", clearImgs);

    return {
      flow: function(mode) {
        scrollMode = (mode === "scrolled-doc");
        if (!book._chapters.length) return;
        if (scrollMode) loadAll(getScrollFrac(iDoc()));
        else loadCh(chIdx, 0);
      },

      display: function(cfi) {
        return book.ready.then(function() {
          if (scrollMode) {
            var pos = decodeCfi(cfi);
            var frac = pos ? pos.frac : 0;
            if (!pos && cfi) {
              var ti = book._chapters.findIndex(function(c) {
                return c.href === cfi || c.path.endsWith(cfi) || cfi.endsWith(c.href);
              });
              if (ti > 0) frac = ti / book._chapters.length;  }
            
            return loadAll(frac).then(function() {
              if (!pos && cfi) {
                var doc = iDoc();
                var si = book._chapters.findIndex(function(c) {
                  return c.href === cfi || c.path.endsWith(cfi) || cfi.endsWith(c.href);
                });
                if (si >= 0 && doc) {
                  var section = doc.getElementById("ch-" + si);
                  if (section) section.scrollIntoView();
                }
              }
            });
          }
          if (!cfi) return loadCh(0, 0);
          var pos = decodeCfi(cfi);
          if (pos) return loadCh(Math.min(pos.idx, book._chapters.length - 1), pos.frac);

          var i = book._chapters.findIndex(function(c) {
            return c.href === cfi || c.path.endsWith(cfi) || cfi.endsWith(c.href);
          });
          return loadCh(i >= 0 ? i : 0, 0);
        });
      },

      next: function() {
        var doc = iDoc();
        var viewW = iframe.clientWidth || window.innerWidth;
        var viewH = iframe.clientHeight || window.innerHeight;
        if (scrollMode) {
          doc.documentElement.scrollTop += viewH * 0.9;
          fireRelocated(doc);
        } else if (page < pageCount - 1) {
          page++;
          goToPage(doc, page, viewW);
          fireRelocated(doc);
        } else if (chIdx < book._chapters.length - 1) {
          loadCh(chIdx + 1, 0);
        } },

      prev: function() {
        var doc = iDoc();
        var viewW = iframe.clientWidth || window.innerWidth;
        var viewH = iframe.clientHeight || window.innerHeight;
        if (scrollMode) {
          doc.documentElement.scrollTop -= viewH * 0.9;
          fireRelocated(doc);
        } else if (page > 0) {
          page--;
          goToPage(doc, page, viewW);
          fireRelocated(doc);
        } else if (chIdx > 0) {
          loadCh(chIdx - 1, 1);
        }
      },

      currentLocation: function() {
        var doc = iDoc();
        var frac = scrollMode ? getScrollFrac(doc) : page / Math.max(1, pageCount - 1);
        return {
          start: { cfi: encodeCfi(chIdx, frac), displayed: { page: page + 1, total: pageCount } }
        };
      },

      on: function(event, fn) {
        if (listeners[event]) listeners[event].push(fn);
        return this;
      },

      getContents: function() {
        var doc = iDoc();
        return doc ? [{ document: doc, window: iframe.contentWindow }] : [];
      },

      themes: {
        register: function(name, theme) { registeredThemes[name] = theme; },
        select: function(name) {
          var t = registeredThemes[name];
          if (!t || !t.body) return;
          bgColor = t.body.background || bgColor;
          textColor = t.body.color || textColor;
          var frac = page / Math.max(1, pageCount - 1);
          loadCh(chIdx, frac);
        },

        fontSize: function(pct) {
          fontSize = parseInt(pct) || 100;
          var doc = iDoc();
          var rw = doc && doc.getElementById("rdr-wrap");
          if (rw) rw.style.fontSize = pct;
        },
        override: function(prop, val) {
          if (prop === "font-family") {
            fontFamily = val;
            var doc = iDoc();
            var rw = doc && doc.getElementById("rdr-wrap");
            if (rw) rw.style.fontFamily = val;
          } }},

      annotations: {
        highlight: function(cfi) {
        var doc = iDoc();
          if (!doc) return;
          try {
            var sel = iframe.contentWindow.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            var text = sel.toString().trim();
            if (!text) return;
            var range = sel.getRangeAt(0).cloneRange();
            var mark = doc.createElement("mark");
            mark.setAttribute("data-cfi", cfi);
            range.surroundContents(mark);
            sel.removeAllRanges();
            savedHighlights[cfi] = { text: text, chIdx: chIdx };
          } catch(e) {
            console.warn("highlight failed:", e.message);
            }
      },
        remove: function(cfi) {
          var doc = iDoc();
          if (doc) {
            var escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(cfi) : cfi.replace(/:/g, "\\:");
            var mark = doc.querySelector("mark[data-cfi='" + escaped + "']");
            if (mark && mark.parentNode) {
              var parent = mark.parentNode;
              while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
              parent.removeChild(mark);
            }

          }
          delete savedHighlights[cfi];
        }}}; }

})(window);