import { openDatabase } from "./db.js";
import { getBookById } from "./library.js";

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

  //to Load book 
  await openDatabase();
  var book = await getBookById(bookId);
  if (!book) { alert("Book not found."); window.location.href = "index.html"; return; }

  trackRecentBook(bookId);
  document.getElementById("book-title").textContent = book.title;


  var epub = ePub(book.data);
  var viewerEl = document.getElementById("viewer");
  var rendition = epub.renderTo("viewer", {
    width: viewerEl.offsetWidth,
    height: viewerEl.offsetHeight,
    flow: "paginated",
    spread: "none",
    allowScriptedContent: true
});

  var savedCfi = localStorage.getItem("cfi_" + bookId);
  if (savedCfi) rendition.display(savedCfi);
  else rendition.display();

  // 
  var locationsReady = false;

function updateProgress(cfi) {
  if (!locationsReady || !cfi) return;
  var raw = epub.locations.percentageFromCfi(cfi);
  if (raw === null || raw === undefined) return;
  var pct = Math.round(Math.max(0, Math.min(1, raw)) * 100);
  document.getElementById("progress-pct").textContent = pct + "%";
  document.getElementById("progress-fill").style.width = pct + "%";
  localStorage.setItem("progress_" + bookId, pct / 100);
  if (window.autoMarkDone) window.autoMarkDone(bookId, pct);
}

epub.locations.generate(1024).then(function() {
  locationsReady = true;
  var cfi = localStorage.getItem("cfi_" + bookId);
  if (cfi) updateProgress(cfi);
});

  rendition.on("relocated", function(location) {
    var cfi = location.start.cfi;
    localStorage.setItem("cfi_" + bookId, cfi);
    updateProgress(cfi);
    updateBookmarkIcon();
  });

 
  rendition.on("rendered", function() {
    var iframe = document.querySelector("#viewer iframe");
    if (!iframe || !iframe.contentDocument) return;

    var doc = iframe.contentDocument;
    var startX = 0;
    var startY = 0;
    var startTime = 0;

    doc.addEventListener("touchstart", function(e) {
      startX = e.changedTouches[0].clientX;
      startY = e.changedTouches[0].clientY;
      startTime = Date.now();
    }, { passive: true });

    doc.addEventListener("touchend", function(e) {
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      var dt = Date.now() - startTime;
      var absDx = Math.abs(dx);
      var absDy = Math.abs(dy);

      // swipe left/right
      if (absDx > 40 && absDx > absDy) {
        if (dx < 0) rendition.next();
        else rendition.prev();
        showUI();
        return;
      }

      // tap
      if (dt < 300 && absDx < 10 && absDy < 10) {
        var third = iframe.offsetWidth / 3;
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

  document.getElementById("prev-btn").addEventListener("click", function() {
    rendition.prev(); showUI();
  });
  document.getElementById("next-btn").addEventListener("click", function() {
    rendition.next(); showUI();
  });

  document.addEventListener("keydown", function(e) {
    if (e.key === "ArrowRight") { rendition.next(); showUI(); }
    if (e.key === "ArrowLeft") { rendition.prev(); showUI(); }
  });