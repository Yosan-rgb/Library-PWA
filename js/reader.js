//import { openDatabase } from "./db.js";
import { getBookById } from "./library.js";
//dexie will laod via cdn with no improt needed


if (typeof ePub === 'undefined') {
  alert("Reader failed to load. Please refresh.");
  window.location.href = "index.html";
}


//get book id pre set on intial open or send back to library if not there. nothing here atp
const bookId = localStorage.getItem("lastOpenedBookId");
if (!bookId) window.location.href = "index.html";

function trackRecentBook(id) {
  var recent = JSON.parse(localStorage.getItem("recentBooks") || "[]");
  recent = [id].concat(recent.filter(function(r) { return r !== id; })).slice(0, 3);
  localStorage.setItem("recentBooks", JSON.stringify(recent));
}

const getStore = (key) => JSON.parse(localStorage.getItem(`${key}_${bookId}`) || "[]");
const saveStore = (key, val) => localStorage.setItem(`${key}_${bookId}`, JSON.stringify(val) )  ;
(async function(){


  function showToast(msg) {
    var toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    clearTimeout(toast._t);
    toast._t = setTimeout(function() { toast.style.opacity = "0"; }, 1800);
  }
  //keep these global so i don't have to keep querying the dom
  var headerEl = document.getElementById("reader-header");
  var footerEl = document.getElementById("reader-footer"); 
  var uiVisible = true;  
  var hideTimer = null;
    var lastTouchStart = 0;


function showUI() {
    uiVisible = true;
    headerEl.classList.remove("hidden");
     footerEl.classList.remove("hidden");
    resetHideTimer();


  }
  function hideUI() {
    uiVisible = false;
    headerEl.classList.add("hidden");
    footerEl.classList.add("hidden");
}
  function resetHideTimer() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideUI, 4000);
}

  resetHideTimer();

  function setTapOverlay(enabled) {
    ["tap-left", "tap-mid", "tap-right"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.pointerEvents = enabled ? "auto" : "none";
    }) ;
  }

  function updateBookmarkIcon() {

  
    if (!rendition) return;
     var loc = rendition.currentLocation();
    var cfi = loc && loc.start && loc.start.cfi;
    var exists = cfi && getStore("bookmarks").some(function(b) { return b.cfi === cfi; });
    document.getElementById("bookmark-btn").textContent = exists ? "🔖" : "🏷";
  }

//await openDatabase();
/// getBookById returns a promise, could use await but .then works fine here too
  var book = await getBookById(bookId);
  if (!book) { alert("Book not found."); window.location.href = "index.html"; return; }

  trackRecentBook(bookId);
  document.getElementById("book-title").textContent = book.title;

var arrayBuffer;
 if (book.data instanceof Blob) {
  arrayBuffer = await book.data.arrayBuffer();
} else if (book.data instanceof ArrayBuffer) {
  arrayBuffer = book.data;
} else {
  alert("Book format error."); return;
}   var epub = ePub(arrayBuffer);
console.log("epub created:", epub);


const isDark = localStorage.getItem("darkMode") === "enabled";
if (isDark) {
  document.body.classList.add("dark");
  document.getElementById("theme-color-meta").setAttribute("content", "#1c1c1e");
}
  var viewerEl = document.getElementById("viewer");

var savedMode = localStorage.getItem("readingMode_" + bookId);
var savedCfi = localStorage.getItem("cfi_" + bookId);
var isScroll = savedMode === "scroll";

var rendition = epub.renderTo("viewer", {
    width: viewerEl.offsetWidth,
    height: viewerEl.offsetHeight,
    flow: isScroll ? "scrolled-doc" : "paginated",
    spread: "none"
  });

      if (isScroll) {
  document.getElementById("mode-scroll").classList.add("active");
  document.getElementById("mode-pagebypage").classList.remove("active");
} else {
  document.getElementById("mode-pagebypage").classList.add("active");
  document.getElementById("mode-scroll").classList.remove("active");
}
setTapOverlay(false);

rendition.display(savedCfi || undefined);

epub.ready.then(function() {
  epub.locations.generate(1000).then(function() {
    console.log("Locations generated");
  });}) ;

//only shows tip once per book to avoid annoying dunja
if (!localStorage.getItem("highlightHintSeen")) {
    setTimeout(function() {
      showToast("tip: select any text to highlight it");
      localStorage.setItem("highlightHintSeen", "true");
    }, 2000);
   }

rendition.on("relocated", function(location) {
  var cfi = location.start.cfi;

  //saves position for next  book opening
  localStorage.setItem("cfi_" + bookId, cfi);

  updateProgress(cfi);
  updateBookmarkIcon();});


  rendition.on("selected", function(cfiRange, contents) {
    var win = contents.window;
    var sel = win.getSelection ? win.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return;
    var text = sel.toString().trim();
    if (!text) return;

    var hl = getStore("highlights");
    var existingIdx = hl.findIndex(function(h) { return h.cfi === cfiRange; });
    if (existingIdx !== -1) {
      rendition.annotations.remove(cfiRange);
      hl.splice(existingIdx, 1);
      saveStore("highlights", hl);
      showToast("Highlight removed");
      return;
    }
    rendition.annotations.highlight(cfiRange);
    hl.push({ cfi: cfiRange, text: text, savedAt: Date.now() });
    saveStore("highlights", hl);
    showToast("Highlighted ✓");
  });



//page numbers beacasue progress bar isn't functioning 
function updateProgress(cfi) {
  if (!cfi) return;
  var pageEl = document.getElementById("page-info");
  if (!pageEl) return;

  var loc = rendition.currentLocation();
  var pageNum = loc && loc.start && loc.start.displayed && loc.start.displayed.page;
  var totalPages = loc && loc.start && loc.start.displayed && loc.start.displayed.total;

  if (pageNum && totalPages && pageNum > 0) {
    pageEl.textContent = "p. " + pageNum + " of " + totalPages;
    var cfiLoc = rendition.currentLocation();
var pctAccurate = cfiLoc && epub.locations.length() ? epub.locations.percentageFromCfi(cfiLoc.start.cfi) : pageNum / totalPages;
localStorage.setItem("progress_" + bookId, pctAccurate);

  
    var overallPct = parseFloat(localStorage.getItem("progress_" + bookId) || "0") * 100;
    //95% feels low. noticed many books have a lot of extra pages at back. maybe bring down to 5%
    if (overallPct >= 95 && localStorage.getItem("finished_" + bookId) !== "true" && !localStorage.getItem("donePrompted_" + bookId)) {
      localStorage.setItem("donePrompted_" + bookId, "true");
      setTimeout(function() {
        if (confirm("You're nearly done! Mark this book as finished?")) {
          localStorage.setItem("finished_" + bookId, "true");
          showToast("Marked as done ✓");
        }
      }, 800); }
    return;
  }

  //fallback to spine position
  var spineItems = epub.spine.spineItems;
    var pos = spineItems.findIndex(function(item) { return cfi.indexOf(item.idref) !== -1; });
    if (pos !== -1) {
      pageEl.textContent = (pos + 1) + " / " + spineItems.length;
      localStorage.setItem("progress_" + bookId, (pos + 1) / spineItems.length);
    }  }

  
  
  
  rendition.on("rendered", function(section, view) {
    var iframeDoc = view.document;
    if (!iframeDoc) return;

    var startX = 0, startY = 0, startTime = 0;

    iframeDoc.addEventListener("touchstart", function(e) {
      startX = e.changedTouches[0].clientX;
      startY = e.changedTouches[0].clientY;
      startTime = Date.now();
      lastTouchStart = Date.now();
    }, { passive: true });

    iframeDoc.addEventListener("touchend", function(e) {
      var dt = Date.now() - startTime;
      if (dt > 400) return;
      try {
        if (iframeDoc.defaultView.getSelection().toString().trim()) return;
      } catch(err) {}
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      var absDx = Math.abs(dx);
      var absDy = Math.abs(dy);

      var savedMode = localStorage.getItem("readingMode_" + bookId);
      var isScroll = savedMode === "scroll";
      if (!isScroll && absDx > 40 && absDx > absDy) {
        if (dx < 0) rendition.next();
        else rendition.prev();
        showUI();
        return;
      }
      if (isScroll && absDx > 40 && absDx > absDy * 1.5) {
        return;
      }
      if (absDx < 10 && absDy < 10) {
        if (isScroll) {
          if (uiVisible) hideUI(); else showUI();
        } else {
          var third = document.getElementById("viewer").offsetWidth / 3;
          if (startX < third) { rendition.prev(); showUI(); }
          else if (startX > third * 2) { rendition.next(); showUI(); }
          else { if (uiVisible) hideUI(); else showUI(); }
        }
      }
    }, { passive: true });
  } );


  document.addEventListener("click", function(e) {
    if (Date.now() - lastTouchStart > 300) return;
    var sel = window.getSelection ? window.getSelection().toString().trim() : "";
    if (sel) return;
    try {
      var iSel = document.querySelector("iframe") &&
        document.querySelector("iframe").contentWindow.getSelection().toString().trim();
      if (iSel) return;
    } catch(err) {}
    if (e.target.closest("button, input, a, #settings-panel, #bookmarks-panel, #highlights-panel, #search-bar, .toc-panel")) return;
    var third = window.innerWidth / 3;
    if (e.clientX < third) { rendition.prev(); showUI(); }
    else if (e.clientX > third * 2) { rendition.next(); showUI(); }
    else { if (uiVisible) hideUI(); else showUI(); }
  });

  document.getElementById("prev-btn").addEventListener("click", function() { rendition.prev(); showUI(); });
  document.getElementById("next-btn").addEventListener("click", function() { rendition.next(); showUI(); });
  document.getElementById("tap-left").addEventListener("click", function() { rendition.prev(); showUI(); });
  document.getElementById("tap-right").addEventListener("click", function() { rendition.next(); showUI(); });
  document.getElementById("tap-mid").addEventListener("click", function() {
    if (uiVisible) hideUI(); else showUI();
  } );

  var settingsPanel = document.getElementById("settings-panel");
  document.getElementById("settings-btn").addEventListener("click", function() {
    settingsPanel.style.display = "block";
    clearTimeout(hideTimer);
  });
  document.getElementById("settings-overlay").addEventListener("click", function() {
    settingsPanel.style.display = "none";
    resetHideTimer();
  }
)
;
  
  

  document.getElementById("mode-pagebypage").addEventListener("click", function() {
    rendition.flow("paginated");
    localStorage.setItem("readingMode_" + bookId, "pagebypage");
    document.getElementById("mode-pagebypage").classList.add("active");
    document.getElementById("mode-scroll").classList.remove("active");
    setTapOverlay(false);
    settingsPanel.style.display = "none";
    resetHideTimer();
    } ) ;
  document.getElementById("mode-scroll").addEventListener("click", function() {
    rendition.flow("scrolled-doc");
    localStorage.setItem("readingMode_" + bookId, "scroll");
    document.getElementById("mode-scroll").classList.add("active");
    document.getElementById("mode-pagebypage").classList.remove("active");
    setTapOverlay(false);
    settingsPanel.style.display = "none";
    resetHideTimer();
  }
);

  var themeStyles = {
    light: { bg: "#ffffff", headerBg: "rgba(255,255,255,0.85)" },
     sepia: { bg: "#f4ecd8", headerBg: "rgba(244,236,216,0.85)" },
    dark:  { bg: "#1c1c1e", headerBg: "rgba(28,28,30,0.85)" }
  };
  var themes = {
    light: { body: { background: "#ffffff", color: "#1a1a1a" } },
    sepia: { body: { background: "#f4ecd8", color: "#3b2f1e" } },
    dark:  { body: { background: "#1c1c1e", color: "#e5e5e7" } }
  };
  var fonts = {
    sans: "-apple-system, 'Helvetica Neue', sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "'Courier New', Courier, monospace"
  };

  Object.keys(themes).forEach(function(name) { rendition.themes.register(name, themes[name]); });

  ["light", "sepia", "dark"].forEach(function(name) {
    var btn = document.getElementById("theme-" + name);
    if (!btn) return;
    btn.addEventListener("click", function() {
      rendition.themes.select(name);
      localStorage.setItem("readerTheme_" + bookId, name);
      var s = themeStyles[name];
      document.body.style.background = s.bg;
      document.getElementById("reader-header").style.background = s.headerBg;
      var tcMeta = document.getElementById("theme-color-meta");
      if (tcMeta) tcMeta.setAttribute("content", s.bg);
      document.querySelectorAll("[id^='theme-']").forEach(function(b) {
        b.classList.toggle("active", b.id === "theme-" + name);
      });
    });
  });

  var savedTheme = localStorage.getItem("readerTheme_" + bookId) || "light";
  rendition.themes.select(savedTheme);
  var tcMeta = document.getElementById("theme-color-meta");
  if (tcMeta) tcMeta.setAttribute("content", themeStyles[savedTheme].bg);
  document.querySelectorAll("[id^='theme-']").forEach(function(b) {
    b.classList.toggle("active", b.id === "theme-" + savedTheme);
  });

  var savedFont = localStorage.getItem("fontFamily_" + bookId);
  if (savedFont && fonts[savedFont]) {
    rendition.themes.override("font-family", fonts[savedFont]);
    document.querySelectorAll("[id^='font-']").forEach(function(b) {
      b.classList.toggle("active", b.id === "font-" + savedFont);
    });
  }

  var fontSize = parseInt(localStorage.getItem("fontSize_" + bookId) || "100");
  rendition.themes.fontSize(fontSize + "%");
  document.getElementById("font-size-label").textContent = fontSize + "%";
  document.getElementById("font-increase").addEventListener("click", function() {
    fontSize = Math.min(fontSize + 10, 200);
    rendition.themes.fontSize(fontSize + "%");
    document.getElementById("font-size-label").textContent = fontSize + "%";
    localStorage.setItem("fontSize_" + bookId, fontSize);
  });
  document.getElementById("font-decrease").addEventListener("click", function() {
    fontSize = Math.max(fontSize - 10, 60);
    rendition.themes.fontSize(fontSize + "%");
    document.getElementById("font-size-label").textContent = fontSize + "%";
    localStorage.setItem("fontSize_" + bookId, fontSize);
  });

  ["sans", "serif", "mono"].forEach(function(name) {
    var btn = document.getElementById("font-" + name);
    if (!btn) return;
    btn.addEventListener("click", function() {
      rendition.themes.override("font-family", fonts[name]);
      localStorage.setItem("fontFamily_" + bookId, name);
      document.querySelectorAll("[id^='font-']").forEach(function(b) {
        b.classList.toggle("active", b.id === "font-" + name);
      });
    });
  });

  document.getElementById("bookmark-btn").addEventListener("click", function() {
    var loc = rendition.currentLocation();
    var cfi = loc && loc.start && loc.start.cfi;
    if (!cfi) return;
    var bms = getStore("bookmarks");
    var idx = bms.findIndex(function(b) { return b.cfi === cfi; });
    if (idx !== -1) {
      bms.splice(idx, 1);
      saveStore("bookmarks", bms);
      document.getElementById("bookmark-btn").textContent = "🏷";
      showToast("Bookmark removed");
    } else {
      var pct = epub.locations.length() ? Math.round((epub.locations.percentageFromCfi(cfi) || 0) * 100) : 0;
      var pageNum = loc && loc.start && loc.start.displayed && loc.start.displayed.page;
      bms.push({ cfi: cfi, savedAt: Date.now(), pct: pct, page: pageNum || pct + "%" });
      saveStore("bookmarks", bms);
      document.getElementById("bookmark-btn").textContent = "🔖";
      showToast("Bookmarked ✓");
    }
    showUI();
  });

  var markDoneBtn = document.getElementById("mark-done-btn");
  if (markDoneBtn) {
    var isFinished = localStorage.getItem("finished_" + bookId) === "true";
    markDoneBtn.textContent = isFinished ? "✓ Mark unread" : "Mark as read";
    markDoneBtn.addEventListener("click", function() {
      var nowFinished = localStorage.getItem("finished_" + bookId) === "true";
      localStorage.setItem("finished_" + bookId, String(!nowFinished));
      markDoneBtn.textContent = !nowFinished ? "✓ Mark unread" : "Mark as read";
      showToast(!nowFinished ? "Marked as done ✓" : "Marked as unread");
      settingsPanel.style.display = "none";
    });
  }

  function openBookmarksPanel() {
    settingsPanel.style.display = "none";
    var panel = document.getElementById("bookmarks-panel");
    var list = document.getElementById("bookmarks-list");
    var bms = getStore("bookmarks").sort(function(a, b) { return a.pct - b.pct; });
    list.innerHTML = "";
    if (!bms.length) {
      list.innerHTML = "<p style='padding:20px;color:#8e8e93;font-size:14px;text-align:center;'>No bookmarks yet.<br>Tap 🏷 to add one.</p>";
    } else {
      bms.forEach(function(bm, i) {
        var item = document.createElement("div");
        item.className = "bookmark-item";
        item.style.cursor = "pointer";
        item.addEventListener("click", function(e) {
          if (e.target.classList.contains("bookmark-remove")) return;
          rendition.display(bm.cfi);
          document.getElementById("bookmarks-panel").style.display = "none";
        });

        var left = document.createElement("div");
        left.className = "bookmark-page";
        left.innerHTML = 'p. ' + (bm.page || bm.pct + "%");

        var del = document.createElement("button");
        del.className = "bookmark-remove";
        del.textContent = "Remove";
        del.addEventListener("click", function(e) {
          e.stopPropagation();
          var bms2 = getStore("bookmarks"); bms2.splice(i, 1); saveStore("bookmarks", bms2); item.remove(); updateBookmarkIcon();
        });
        item.appendChild(left); item.appendChild(del); list.appendChild(item);
      });
    }
    panel.style.display = "block";
  }
  document.getElementById("open-bookmarks-btn").addEventListener("click", openBookmarksPanel);
  document.getElementById("bookmarks-overlay").addEventListener("click", function() {
    document.getElementById("bookmarks-panel").style.display = "none";
  });

  function openHighlightsPanel() {
    settingsPanel.style.display = "none";
    var panel = document.getElementById("highlights-panel");
    var list = document.getElementById("highlights-list");
    var hls = getStore("highlights");
    list.innerHTML = "";
    if (!hls.length) {
      list.innerHTML = "<p style='padding:20px;color:#8e8e93;font-size:14px;text-align:center;'>No highlights yet.<br>Select text while reading to highlight.</p>";
    } else {
      hls.forEach(function(hl, i) {
        var item = document.createElement("div");
        item.className = "highlight-item";
        var left = document.createElement("div");
        left.innerHTML = '<div class="highlight-text-block">' + hl.text + '</div>' +
          '<div class="highlight-date">' + new Date(hl.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + '</div>';
        left.addEventListener("click", function() { rendition.display(hl.cfi); panel.style.display = "none"; });
        var del = document.createElement("button");
        del.className = "highlight-remove";
        del.textContent = "✕";
        del.addEventListener("click", function() {
          var hls2 = getStore("highlights");
          rendition.annotations.remove(hl.cfi, "highlight");
          hls2.splice(i, 1); saveStore("highlights", hls2); item.remove();
        });
        item.appendChild(left); item.appendChild(del); list.appendChild(item);
      });
    }
    panel.style.display = "block";
  }
  document.getElementById("open-highlights-btn").addEventListener("click", openHighlightsPanel);
  document.getElementById("highlights-overlay").addEventListener("click", function() {
    document.getElementById("highlights-panel").style.display = "none";
  });

  document.getElementById("open-toc-btn").addEventListener("click", async function() {
    settingsPanel.style.display = "none";
    var nav = await epub.loaded.navigation;
    var toc = nav.toc;
    if (!toc || !toc.length) { showToast("No table of contents found."); return; }
    var panel = document.createElement("div");
    panel.className = "toc-panel";
    var overlay = document.createElement("div");
    overlay.className = "toc-overlay";
    var drawer = document.createElement("div");
    drawer.className = "toc-drawer";
    var hdr = document.createElement("div");
    hdr.className = "toc-header";
    hdr.textContent = "Contents";
    drawer.appendChild(hdr);
    toc.forEach(function(item) {
      var row = document.createElement("div");
      row.className = "toc-row";
      row.textContent = item.label.trim();
      row.addEventListener("click", function() { rendition.display(item.href); document.body.removeChild(panel); });
      drawer.appendChild(row);
    });
    overlay.addEventListener("click", function() { document.body.removeChild(panel); });
    panel.appendChild(overlay); panel.appendChild(drawer);
    document.body.appendChild(panel);
  });

  var searchBar = document.getElementById("search-bar");
  var searchInput = document.getElementById("search-input");
  var searchResults = document.getElementById("search-results");
  var searchOpen = false;

  document.getElementById("search-btn").addEventListener("click", function() {
    searchOpen = !searchOpen;
    searchBar.style.display = searchOpen ? "block" : "none";
    if (searchOpen) { searchInput.focus(); clearTimeout(hideTimer); }
    else resetHideTimer();
  });

  searchInput.addEventListener("keydown", async function(e) {
    if (e.key !== "Enter") return;
    var query = searchInput.value.trim();
    if (!query) return;
    searchResults.innerHTML = "<div style='padding:10px;font-size:13px;color:#8e8e93;'>Searching…</div>";
    try {
      var results = [];
      await Promise.all(epub.spine.spineItems.map(function(item) {
        return item.load(epub.load.bind(epub)).then(function() {
          item.find(query).forEach(function(hit) { results.push(hit); });
          item.unload();
        }).catch(function() {});
      }));
      searchResults.innerHTML = "";
      if (!results.length) {
        searchResults.innerHTML = "<div style='padding:10px;font-size:13px;color:#8e8e93;'>No results.</div>";
        return;
      }
      results.slice(0, 20).forEach(function(result) {
        var div = document.createElement("div");
        div.className = "search-result-item";
        div.textContent = result.excerpt;
        div.addEventListener("click", function() {
          rendition.display(result.cfi).then(function() {
            setTimeout(function() {
              rendition.getContents().forEach(function(c) {
                var body = c.document.body;
                var walker = c.document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
                var node, ranges = [];
                while ((node = walker.nextNode())) {
                  var idx = node.textContent.toLowerCase().indexOf(query.toLowerCase());
                  if (idx === -1) continue;
                  try {
                    var range = c.document.createRange();
                    range.setStart(node, idx);
                    range.setEnd(node, idx + query.length);
                    ranges.push(range);
                  } catch(e) {}
                }
                ranges.forEach(function(range) {
                  try {
                    var mark = c.document.createElement("mark");
                    mark.style.cssText = "background:#ff9f0a;color:inherit;border-radius:3px;";
                    range.surroundContents(mark);
                    setTimeout(function() {
                      mark.style.transition = "background 0.6s";
                      mark.style.background = "transparent";
                      setTimeout(function() {
                        var p = mark.parentNode;
                        if (p) { p.replaceChild(c.document.createTextNode(mark.textContent), mark); p.normalize(); }
                      }, 700);
                    }, 2500);
                  } catch(e) {}
                });
              });
            }, 150);
            searchBar.style.display = "none";
            searchOpen = false;
            resetHideTimer();
          });
        });
        searchResults.appendChild(div);
      });
    } catch(err) {
      searchResults.innerHTML = "<div style='padding:10px;font-size:13px;color:#ff453a;'>Search failed.</div>";
    }
  });

})();