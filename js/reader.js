//import { openDatabase } from "./db.js";
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
  clearTimeout(hideTimer); }

document.addEventListener('touchstart', function() { showUI() }, {passive:true});
  resetHideTimer();


//await openDatabase();
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
}  var epub = ePub(arrayBuffer);
   console.log("epub created:", epub);
  var viewerEl = document.getElementById("viewer");

var rendition = epub.renderTo("viewer", {
    width: viewerEl.offsetWidth,
    height: viewerEl.offsetHeight,
    flow: "paginated",
    spread: "none"
  });

//remember last reading position, theme, font size, and mode for next opening
var savedMode = localStorage.getItem("readingMode_" + bookId);
if (savedMode === "scroll") {
  rendition.flow("scrolled-doc");
  document.getElementById("mode-scroll").classList.add("active");
  document.getElementById("mode-pagebypage").classList.remove("active");
} else  {
  rendition.flow("paginated");
  document.getElementById("mode-pagebypage").classList.add("active");
  document.getElementById("mode-scroll").classList.remove("active");}

var savedCfi = localStorage.getItem("cfi_" + bookId);
if (savedCfi) rendition.display(savedCfi);
else rendition.display( );

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

    rendition.on("rendered", function() {
    console.log("rendered");
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
if (cfiLoc && epub.locations.length()) {
  var pctAccurate = epub.locations.percentageFromCfi(cfiLoc.start.cfi);
  localStorage.setItem("progress_" + bookId, pctAccurate);
} else {
  localStorage.setItem("progress_" + bookId, pageNum / totalPages);
}
    if (window.autoMarkDone) window.autoMarkDone(bookId, Math.round((pageNum / totalPages) * 100));

  var overallPct = parseFloat(localStorage.getItem("progress_" + bookId) || "0") * 100;
if (pageNum === totalPages && overallPct >= 88 && localStorage.getItem("finished_" + bookId) !== "true" && !localStorage.getItem("donePrompt_" + bookId)) {      localStorage.setItem("donePrompt_" + bookId, "true");
      setTimeout(function() {
        var doneToast = document.createElement("div");
        doneToast.innerHTML = '📖 Mark as done? <button onclick="localStorage.setItem(\'finished_\' + \'' + bookId + '\', \'true\'); this.parentElement.remove();" style="margin-left:10px;background:var(--accent);border:none;border-radius:8px;padding:4px 10px;font-weight:600;cursor:pointer;">Yes</button>';
        doneToast.style.cssText = "position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.82);color:#fff;padding:10px 16px;border-radius:16px;font-size:14px;z-index:9999;white-space:nowrap;";
        document.body.appendChild(doneToast);
        setTimeout(function() { if (doneToast.parentElement) doneToast.remove(); }, 6000);
      }, 1000);
    }
    return;
  }

  // fallback to spine position
  var spineItems = epub.spine.spineItems;
    var pos = spineItems.findIndex(function(item) { return cfi.indexOf(item.idref) !== -1; });
    if (pos !== -1) {
      pageEl.textContent = (pos + 1) + " / " + spineItems.length;
      localStorage.setItem("progress_" + bookId, (pos + 1) / spineItems.length);
    }
  }

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

  //https://developer.mozilla.org/en-US/docs/Web/API/Selection/toString
  iframeDoc.addEventListener("touchend", function(e) {
     if (iframeDoc.defaultView.getSelection().toString().trim()) return; 

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
var loc = rendition.currentLocation();
var pageNum = loc && loc.start && loc.start.displayed && loc.start.displayed.page;
bms.push({ cfi: cfi, savedAt: Date.now(), pct: pct, page: pageNum || pct + "%" });
      saveBookmarks(bms);
      document.getElementById("bookmark-btn").textContent = "🔖";
      showToast("Bookmarked ✓");}
    showUI();  });

//
  rendition.on("selected", function(cfiRange, contents) {
    var text = contents.window.getSelection().toString().trim();
    if (!text) return;

    

   
 var hl = getHighlights();
var existingIdx = hl.findIndex(function(h) { return h.cfi === cfiRange; });
if (existingIdx !== -1) {
  rendition.annotations.remove(cfiRange, "highlight");
  hl.splice(existingIdx, 1);
  saveHighlights(hl);
  showToast("Highlight removed");
  return;
}
rendition.annotations.highlight(cfiRange, {}, function() {}, "highlight", {
  "fill": "#ffe066","fill-opacity": "0.4", "mix-blend-mode": "multiply"
});
hl.push({ cfi: cfiRange, text: text, savedAt: Date.now() });
saveHighlights(hl);
showToast("Highlighted ✓");
});

  

  var settingsPanel = document.getElementById("settings-panel");
  document.getElementById("settings-btn").addEventListener("click", function() {
    settingsPanel.style.display = "block";
    clearTimeout(hideTimer);
  });
  document.getElementById("settings-overlay").addEventListener("click", function() {
    settingsPanel.style.display = "none";
    resetHideTimer();
  });


   document.getElementById("mode-pagebypage").classList.add("active");
  document.getElementById("mode-scroll").classList.remove("active");

document.getElementById("mode-pagebypage").addEventListener("click", function() {
  rendition.flow("paginated");
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



var themeStyles = {
    light: { bg: "#ffffff", headerBg: "rgba(255,255,255,0.85)" },
    sepia: { bg: "#f4ecd8", headerBg: "rgba(244,236,216,0.85)" },
    dark:  { bg: "#1c1c1e", headerBg: "rgba(28,28,30,0.85)" }
  };
  var themes = {
    light: { body: { background: "#ffffff", color: "#1a1a1a" } },
     sepia: { body: { background: "#f4ecd8", color: "#3b2f1e" } },
    dark:  { body: { background:  "#1c1c1e", color: "#e5e5e7" } }
  };


   var fonts = {
    sans: "-apple-system, 'Helvetica Neue', sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "'Courier New', Courier, monospace"};



  Object.keys(themes).forEach(function(name) { rendition.themes.register(name, themes[name]); });
  rendition.themes.select("light"); 

  ["light", "sepia", "dark"].forEach(function(name) {
    var btn = document.getElementById("theme-" + name);
    if (!btn) return;
    btn.addEventListener("click", function() {
      rendition.themes.select(name);
rendition.getContents().forEach(function(c) {  
  c.document.body.style.fontFamily = fonts[name];});
localStorage.setItem("readerTheme_" + bookId, name);     var s = themeStyles[name];
     document.body.style.background = s.bg;
document.getElementById("reader-header").style.background = s.headerBg;
var tcMeta = document.getElementById("theme-color-meta");
if (tcMeta) tcMeta.setAttribute("content", s.bg);
      document.querySelectorAll("[id^='theme-']").forEach(function(b) {
        b.classList.toggle("active", b.id === "theme-" + name);
      });
    });   });

  //https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
  var savedTheme = localStorage.getItem("readerTheme_" + bookId) || "light";
rendition.themes.select(savedTheme);
var tcMeta = document.getElementById("theme-color-meta");
if (tcMeta) tcMeta.setAttribute("content", themeStyles[savedTheme].bg);
document.querySelectorAll("[id^='theme-']").forEach(function(b) {
  b.classList.toggle("active", b.id === "theme-" + savedTheme);
} );

var savedFont = localStorage.getItem("fontFamily_" + bookId);
if (savedFont && fonts[savedFont]) {
  rendition.themes.override("font-family", fonts[savedFont]);
  rendition.getContents().forEach(function(c) {
    c.document.body.style.fontFamily = fonts[savedFont];
  });
  document.querySelectorAll("[id^='font-']").forEach(function(b) {
    b.classList.toggle("active", b.id === "font-" + savedFont);
  });
}

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
  }) ;


  function openBookmarksPanel(){
    settingsPanel.style.display = "none";
    var panel = document.getElementById("bookmarks-panel");
    var list = document.getElementById("bookmarks-list");
    var bms = getBookmarks().sort(function(a, b) { return a.pct - b.pct; });
    list.innerHTML = "";
    if (!bms.length) {
      list.innerHTML = "<p style='padding:20px;color:#8e8e93;font-size:14px;text-align:center;'>No bookmarks yet.<br>Tap 🏷 to add one.</p>";
    } else {
      bms.forEach(function(bm, i)  {
        
        var item = document.createElement("div");
        item.className = "bookmark-item";

        var left = document.createElement("div");
        left.className = "bookmark-page";
        left.innerHTML = 'p. ' + (bm.page || bm.pct + "%");

        var del = document.createElement("button");
        del.className = "bookmark-remove";
        del.textContent = "Remove";
        
        del.addEventListener("click", function() {
          var bms2 = getBookmarks(); bms2.splice(i, 1); saveBookmarks(bms2); item.remove(); updateBookmarkIcon();
        });
        item.appendChild(left); item.appendChild(del); list.appendChild(item);
      } );
    }
    panel.style.display = "block";
  }
  document.getElementById("open-bookmarks-btn").addEventListener("click", openBookmarksPanel);
  document.getElementById("bookmarks-overlay").addEventListener("click", function() {
    document.getElementById("bookmarks-panel").style.display = "none";
  });

  function openHighlightsPanel()  {
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
        item.className = "highlight-item";

        var left = document.createElement("div");
        left.innerHTML = '<div class="highlight-text-block">' + hl.text + '</div>' +
          '<div class="highlight-date">' + new Date(hl.savedAt).toLocaleDateString(undefined, { month:"short", day:"numeric" }) + '</div>';
        left.addEventListener("click", function() { rendition.display(hl.cfi); panel.style.display = "none"; });

        var del = document.createElement("button");
        del.className = "highlight-remove";
        del.textContent = "✕";

        del.addEventListener("click", function() {
          var hls2 = getHighlights();
          rendition.annotations.remove(hl.cfi, "highlight");
          hls2.splice(i, 1); saveHighlights(hls2); item.remove();
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
    settingsPanel.style.display = "none" ;
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
    document.body.appendChild(panel); });


  var searchBar = document.getElementById("search-bar");
  var searchInput = document.getElementById("search-input");
   var searchResults = document.getElementById("search-results");
  var searchOpen = false;
  document.getElementById("search-btn").addEventListener("click", function() {
    searchOpen = !searchOpen;
     searchBar.style.display = searchOpen ? "block" : "none";
    if (searchOpen) { searchInput.focus(); clearTimeout(hideTimer); }
    else resetHideTimer();});

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
        }).catch(function() {});})) ;
      searchResults.innerHTML = ""; 
      if (!results.length) {
        searchResults.innerHTML = "<div style='padding:10px;font-size:13px;color:#8e8e93;'>No results.</div>";
        return;
      }
      results.slice(0, 20).forEach(function(result) {
        var div = document.createElement("div") ;
        div.className = "search-result-item";
        div.textContent = result.excerpt;
        div.addEventListener("click", function() {
          rendition.display(result.cfi).then(function() {

          
            //higlights searched word for a few secs after search - change made after final feedback
            //https://developer.mozilla.org/en-US/docs/Web/API/Document/createTreeWalker
            rendition.getContents().forEach(function(c) {
              var body = c.document.body;
              var walker = c.document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
              var node;
              var ranges = [];
              while ((node = walker.nextNode())) {
                var idx = node.textContent.toLowerCase().indexOf(query.toLowerCase());
                if (idx === -1) continue;
                var range = c.document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + query.length);
                ranges.push(range);
              }
              ranges.forEach(function(range) {
                var mark = c.document.createElement("mark");
                mark.style.cssText = "background:#ff9f0a;color:inherit;border-radius:3px;transition:background 0.4s;";
                range.surroundContents(mark);
                setTimeout(function() {
                  mark.style.background = "transparent";
                  setTimeout(function() {
                    var parent = mark.parentNode;
                    if (parent) { parent.replaceChild(c.document.createTextNode(mark.textContent), mark); parent.normalize(); }
                  }, 600);
                }, 2000);
              });}); });


            
          searchBar.style.display = "none";
          searchOpen = false;
          resetHideTimer();
        });
        searchResults.appendChild(div);
      });
    } catch (err) {
       searchResults.innerHTML = "<div style='padding:10px;font-size:13px;color:#ff453a;'>Search failed.</div>";
    }});

   
  function showToast(msg) {  
     var toast = document.getElementById("toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "toast";
      document.body.appendChild(toast);}


    toast.textContent = msg;
    toast.style.opacity = "1";
     clearTimeout(toast._t);
    toast._t = setTimeout(function() { toast.style.opacity = "0"; }, 1800);
  } })();