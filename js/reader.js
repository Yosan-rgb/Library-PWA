import { openDatabase } from "./db.js";
import { getBookById } from "./library.js";



//get book id pre set on intial open or send back to library if not there
const bookId = localStorage.getItem("lastOpenedBookId");
if (!bookId) window.location.href = "index.html";

function trackRecentBook(id) {
  var recent = JSON.parse(localStorage.getItem("recentBooks") || "[]");
  recent = [id].concat(recent.filter(function(r) { return r !== id; })).slice(0, 3);
  localStorage.setItem("recentBooks", JSON.stringify(recent));
}
function getBookmarks() { return JSON.parse(localStorage.getItem("bookmarks_" + bookId) || "[]"); }
function saveBookmarks(bms) { localStorage.setItem("bookmarks_" + bookId, JSON.stringify(bms)); }
function getHighlights() { return JSON.parse(localStorage.getItem("highlights_" + bookId) || "[]"); }
function saveHighlights(hl) { localStorage.setItem("highlights_" + bookId, JSON.stringify(hl)); }

(async function() {

  //  Grab UI elements after DOM is ready 
  var headerEl = document.getElementById("reader-header");
  var footerEl = document.getElementById("reader-footer");
  var uiVisible = true;
  var hideTimer = null;


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
  }

  document.addEventListener("touchstart", function() { showUI(); }, { passive: true });
  resetHideTimer();

  //Load book 
  await openDatabase();
  var book = await getBookById(bookId);
  if (!book) { alert("Book not found."); window.location.href = "index.html"; return; }

  trackRecentBook(bookId);
  document.getElementById("book-title").textContent = book.title;

  var arrayBuffer = await book.data.arrayBuffer();
  var epub = ePub(arrayBuffer);
  console.log("epub created:", epub);
  var viewerEl = document.getElementById("viewer");

var rendition = epub.renderTo("viewer", {
  width: viewerEl.offsetWidth,
height: viewerEl.offsetHeight,
  flow: "pagebypage",
  spread: "none",
  allowScriptedContent: true,
  allowPopups: true 
});

//remember last reading position, theme, font size, and mode for next opening
var savedMode = localStorage.getItem("readingMode_" + bookId);
if (savedMode === "scroll") {
  rendition.flow("scrolled-doc");
  document.getElementById("mode-scroll").classList.add("active");
  document.getElementById("mode-pagebypage").classList.remove("active");
} else {
  rendition.flow("pagebypage");
  document.getElementById("mode-pagebypage").classList.add("active");
  document.getElementById("mode-scroll").classList.remove("active");
}

var savedCfi = localStorage.getItem("cfi_" + bookId);
if (savedCfi) rendition.display(savedCfi);
else rendition.display();

setTimeout(function() {
showToast("tip: select any text to highlight it");
    localStorage.setItem("highlightHintSeen", "true");
  }, 2000);
if (!localStorage.getItem("highlightHintSeen")) {
  
}

rendition.on("relocated", function(location) {
  var cfi = location.start.cfi;

  //saves position for next  book opening
  localStorage.setItem("cfi_" + bookId, cfi);

  updateProgress(cfi);
  updateBookmarkIcon();
});

  rendition.on("rendered", function() {
  console.log("Chapter rendered");
});

  // 
  var locationsReady = false; 
  //true once epublocations isready. 



//page numbers beacasue progress bar isn't functioning 
function updateProgress(cfi) {
  if (!cfi) return;
  var pageEl = document.getElementById("page-info");
  if (!pageEl) return;

  //first it'll try to get actual page number from epub 
  var loc = rendition.currentLocation();
  var pageNum = loc && loc.start && loc.start.displayed && loc.start.displayed.page;
  var totalPages = loc && loc.start && loc.start.displayed && loc.start.displayed.total;

  if (pageNum && totalPages && pageNum > 0) {
    
    pageEl.textContent = "p. " + pageNum + " of " + totalPages;
    localStorage.setItem("progress_" + bookId, pageNum / totalPages);
    if (window.autoMarkDone) window.autoMarkDone(bookId, Math.round((pageNum / totalPages) * 100));
    return;
  }

  //fall back
  var spineItems = epub.spine.spineItems;
  var spinePos = spineItems.findIndex(function(item) {
    return cfi.indexOf(item.idref) !== -1;
  });

  if (spinePos !== -1) {
    pageEl.textContent = (spinePos + 1) + " / " + spineItems.length;
    localStorage.setItem("progress_" + bookId, (spinePos + 1) / spineItems.length);
    if (window.autoMarkDone) window.autoMarkDone(bookId, Math.round(((spinePos + 1) / spineItems.length) * 100));
  }
}

  var touchStartX = 0;
  var touchStartY = 0;
  var touchStartTime = 0;

  rendition.on("rendered", function(section, view) {
  var iframeDoc = view.document;
  if (!iframeDoc) return;

  var startX = 0, startY = 0, startTime = 0;

  //touch gesture handling for both swipe and tap.
  //sources: https://developer.mozilla.org/en-US/docs/Web/API/Touch_events

  iframeDoc.addEventListener("touchstart", function(e) {
    startX = e.changedTouches[0].clientX;
    startY = e.changedTouches[0].clientY;
    startTime = Date.now();
  }, { passive: true });

  iframeDoc.addEventListener("touchend", function(e) {
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    var dt = Date.now() - startTime;
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);

    // swipe
    if (absDx > 40 && absDx > absDy) {
      if (dx < 0) rendition.next();
      else rendition.prev();
      showUI();
      return;
    }

    // tap
    if (dt < 300 && absDx < 10 && absDy < 10) {
      var third = document.getElementById("viewer").offsetWidth / 3;
      if (startX < third) {
        rendition.prev(); showUI();
      } else if (startX > third * 2) {
        rendition.next(); showUI();
      } else {
        if (uiVisible) hideUI();
        else showUI();
      }
    }
  }, { passive: true });
});

   
  document.addEventListener("keydown", function(e) {
    if (e.key === "ArrowRight") { rendition.next(); showUI(); }
    if (e.key === "ArrowLeft") { rendition.prev(); showUI(); }
  });

  document.getElementById("prev-btn").addEventListener("click", function() { rendition.prev(); showUI(); });
  document.getElementById("next-btn").addEventListener("click", function() { rendition.next(); showUI(); });
  // Bookmark 
  function updateBookmarkIcon() {
    var loc = rendition.currentLocation();
    var cfi = loc && loc.start && loc.start.cfi;
    var exists = cfi && getBookmarks().some(function(b) { return b.cfi === cfi; });
    document.getElementById("bookmark-btn").textContent = exists ? "🔖" : "🏷";
  }

  document.getElementById("bookmark-btn").addEventListener("click", function() {
    var loc = rendition.currentLocation();
    var cfi = loc && loc.start && loc.start.cfi;
    if (!cfi) return;
    var bms = getBookmarks();
    var idx = bms.findIndex(function(b) { return b.cfi === cfi; });
    if (idx !== -1) {
      bms.splice(idx, 1);
      saveBookmarks(bms);
      document.getElementById("bookmark-btn").textContent = "🏷";
      showToast("Bookmark removed");
    } else {
      var pct = epub.locations.length() ? Math.round((epub.locations.percentageFromCfi(cfi) || 0) * 100) : 0;
      bms.push({ cfi: cfi, savedAt: Date.now(), pct: pct });
      saveBookmarks(bms);
      document.getElementById("bookmark-btn").textContent = "🔖";
      showToast("Bookmarked ✓");
    }
    showUI();
  });

  // ─ Highlights 
  rendition.on("selected", function(cfiRange, contents) {
    var text = contents.window.getSelection().toString().trim();
    if (!text) return;
    rendition.annotations.highlight(cfiRange, {}, function() {}, "highlight", {
      "fill": "#ffe066", "fill-opacity": "0.4", "mix-blend-mode": "multiply"
    });
    var hl = getHighlights();
    hl.push({ cfi: cfiRange, text: text, savedAt: Date.now() });
    saveHighlights(hl);
    showToast("Highlighted ✓");
  });

  //  Settings 
  var settingsPanel = document.getElementById("settings-panel");
  document.getElementById("settings-btn").addEventListener("click", function() {
    settingsPanel.style.display = "block";
    clearTimeout(hideTimer);
  });
  document.getElementById("settings-overlay").addEventListener("click", function() {
    settingsPanel.style.display = "none";
    resetHideTimer();
  });

  // Reading mode
  document.getElementById("mode-pagebypage").classList.add("active");
  document.getElementById("mode-scroll").classList.remove("active");

document.getElementById("mode-pagebypage").addEventListener("click", function() {
  rendition.flow("pagebypage");
  localStorage.setItem("readingMode_" + bookId, "pagebypage");
  document.getElementById("mode-pagebypage").classList.add("active");
  document.getElementById("mode-scroll").classList.remove("active");
  settingsPanel.style.display = "none";
  resetHideTimer();
});
document.getElementById("mode-scroll").addEventListener("click", function() {
  rendition.flow("scrolled-doc");
  localStorage.setItem("readingMode_" + bookId, "scroll");
  document.getElementById("mode-scroll").classList.add("active");
  document.getElementById("mode-pagebypage").classList.remove("active");
  settingsPanel.style.display = "none";
  resetHideTimer();
});


  //  Themes 
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
  Object.keys(themes).forEach(function(name) { rendition.themes.register(name, themes[name]); });
  rendition.themes.select("light");

  ["light", "sepia", "dark"].forEach(function(name) {
    var btn = document.getElementById("theme-" + name);
    if (!btn) return;
    btn.addEventListener("click", function() {
      rendition.themes.select(name);
      localStorage.setItem("readerTheme_" + bookId, name);
      var s = themeStyles[name];
      document.body.style.background = s.bg;
      document.getElementById("reader-header").style.background = s.headerBg;
      document.querySelectorAll("[id^='theme-']").forEach(function(b) {
        b.classList.toggle("active", b.id === "theme-" + name);
      });
    });
  });

  var savedTheme = localStorage.getItem("readerTheme_" + bookId) || "light";
rendition.themes.select(savedTheme);
var savedStyle = themeStyles[savedTheme];
document.body.style.background = savedStyle.bg;
document.getElementById("reader-header").style.background = savedStyle.headerBg;
document.querySelectorAll("[id^='theme-']").forEach(function(b) {
  b.classList.toggle("active", b.id === "theme-" + savedTheme);
});

  //  Font size 
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

  //  Font family 
  var fonts = {
    sans: "-apple-system, 'Helvetica Neue', sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "'Courier New', Courier, monospace"
  };
  ["sans", "serif", "mono"].forEach(function(name) {
    var btn = document.getElementById("font-" + name);
    if (!btn) return;
    btn.addEventListener("click", function() {
      rendition.themes.override("font-family", fonts[name]);
      localStorage.setItem("readerTheme_" + bookId, name);
      document.querySelectorAll("[id^='font-']").forEach(function(b) {
        b.classList.toggle("active", b.id === "font-" + name);
      });
    });
  });

  //  Bookmarks panel 
  function openBookmarksPanel() {
    settingsPanel.style.display = "none";
    var panel = document.getElementById("bookmarks-panel");
    var list = document.getElementById("bookmarks-list");
    var bms = getBookmarks().sort(function(a, b) { return a.pct - b.pct; });
    list.innerHTML = "";
    if (!bms.length) {
      list.innerHTML = "<p style='padding:20px;color:#8e8e93;font-size:14px;text-align:center;'>No bookmarks yet.<br>Tap 🏷 to add one.</p>";
    } else {
      bms.forEach(function(bm, i) {
        var item = document.createElement("div");
        item.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:0.5px solid rgba(0,0,0,0.08);";
        var left = document.createElement("div");
        left.style.cursor = "pointer";
        left.innerHTML = '<div style="font-size:15px;font-weight:500;">' + bm.pct + '% through</div><div style="font-size:12px;color:#8e8e93;">' + new Date(bm.savedAt).toLocaleDateString(undefined, { month:"short", day:"numeric", year:"numeric" }) + "</div>";
        left.addEventListener("click", function() { rendition.display(bm.cfi); panel.style.display = "none"; });
        var removeBtn = document.createElement("button");
        removeBtn.textContent = "Remove";
        removeBtn.style.cssText = "background:none;border:none;color:#ff453a;font-size:13px;cursor:pointer;padding:4px 8px;width:auto;";
        removeBtn.addEventListener("click", function() {
          var bms2 = getBookmarks(); bms2.splice(i, 1); saveBookmarks(bms2); item.remove(); updateBookmarkIcon();
        });
        item.appendChild(left); item.appendChild(removeBtn); list.appendChild(item);
      });
    }
    panel.style.display = "block";
  }
  document.getElementById("open-bookmarks-btn").addEventListener("click", openBookmarksPanel);
  document.getElementById("bookmarks-overlay").addEventListener("click", function() {
    document.getElementById("bookmarks-panel").style.display = "none";
  });

  //  Highlights panel 
  function openHighlightsPanel() {
    settingsPanel.style.display = "none";
    var panel = document.getElementById("highlights-panel");
    var list = document.getElementById("highlights-list");
    var hls = getHighlights();
    list.innerHTML = "";
    if (!hls.length) {
      list.innerHTML = "<p style='padding:20px;color:#8e8e93;font-size:14px;text-align:center;'>No highlights yet.<br>Select text while reading to highlight.</p>";
    } else {
      hls.forEach(function(hl, i) {
        var item = document.createElement("div");
        item.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;padding:14px 20px;border-bottom:0.5px solid rgba(0,0,0,0.08);gap:12px;";
        var left = document.createElement("div");
        left.style.cursor = "pointer";
        left.innerHTML = '<div style="font-size:14px;line-height:1.5;background:#ffe066;padding:4px 8px;border-radius:4px;margin-bottom:4px;">' + hl.text + '</div><div style="font-size:12px;color:#8e8e93;">' + new Date(hl.savedAt).toLocaleDateString(undefined, { month:"short", day:"numeric" }) + "</div>";
        left.addEventListener("click", function() { rendition.display(hl.cfi); panel.style.display = "none"; });
        var removeBtn = document.createElement("button");
        removeBtn.textContent = "✕";
        removeBtn.style.cssText = "background:none;border:none;color:#ff453a;font-size:16px;cursor:pointer;padding:0;width:auto;flex-shrink:0;";
        removeBtn.addEventListener("click", function() {
          var hls2 = getHighlights();
          rendition.annotations.remove(hl.cfi, "highlight");
          hls2.splice(i, 1); saveHighlights(hls2); item.remove();
        });
        item.appendChild(left); item.appendChild(removeBtn); list.appendChild(item);
      });
    }
    panel.style.display = "block";
  }
  document.getElementById("open-highlights-btn").addEventListener("click", openHighlightsPanel);
  document.getElementById("highlights-overlay").addEventListener("click", function() {
    document.getElementById("highlights-panel").style.display = "none";
  });

  //  Table of contents 
  document.getElementById("open-toc-btn").addEventListener("click", async function() {
    settingsPanel.style.display = "none";
    var nav = await epub.loaded.navigation;
    var toc = nav.toc;
    if (!toc || !toc.length) { showToast("No table of contents found."); return; }
    var panel = document.createElement("div");
    panel.style.cssText = "position:fixed;inset:0;z-index:400;";
    var overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;inset:0;background:rgba(0,0,0,0.4);";
    var drawer = document.createElement("div");
    drawer.style.cssText = "position:absolute;bottom:0;left:0;right:0;background:#f2f2f7;border-radius:20px 20px 0 0;max-height:75vh;overflow-y:auto;";
    var hdr = document.createElement("div");
    hdr.style.cssText = "padding:20px;border-bottom:0.5px solid rgba(0,0,0,0.08);font-size:17px;font-weight:600;position:sticky;top:0;background:#f2f2f7;";
    hdr.textContent = "Contents";
    drawer.appendChild(hdr);
    toc.forEach(function(item) {
      var row = document.createElement("div");
      row.style.cssText = "padding:14px 20px;border-bottom:0.5px solid rgba(0,0,0,0.08);font-size:15px;cursor:pointer;color:#1a1a1a;";
      row.textContent = item.label.trim();
      row.addEventListener("click", function() { rendition.display(item.href); document.body.removeChild(panel); });
      drawer.appendChild(row);
    });
    overlay.addEventListener("click", function() { document.body.removeChild(panel); });
    panel.appendChild(overlay); panel.appendChild(drawer);
    document.body.appendChild(panel);
  });

  // Search 
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
          rendition.display(result.cfi);
          searchBar.style.display = "none";
          searchOpen = false;
          resetHideTimer();
        });
        searchResults.appendChild(div);
      });
    } catch (err) {
      searchResults.innerHTML = "<div style='padding:10px;font-size:13px;color:#ff453a;'>Search failed.</div>";
    }
  });

  //  Toast 
  function showToast(msg) {
    var toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      toast.style.cssText = "position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.72);color:#fff;padding:8px 18px;border-radius:20px;font-size:14px;z-index:9999;transition:opacity 0.3s ease;pointer-events:none;white-space:nowrap;";
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = "1";
    clearTimeout(toast._t);
    toast._t = setTimeout(function() { toast.style.opacity = "0"; }, 1800);
  }

})();