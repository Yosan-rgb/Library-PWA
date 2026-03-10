import { openDatabase } from "./db.js";
import { setupUI, refreshLibrary } from "./ui.js";
import { libraryHealthCheck, saveBook, getAllBooks } from "./library.js";

//to hide all the sections then just show one at a time as current tab
//based on https://stackoverflow.com/questions/26027787/simplify-this-javascript-for-show-one-hide-rest

function showTab(id) {
  document.querySelectorAll("main section").forEach(function(sec) {
    sec.style.display = "none";
    sec.classList.remove("fade-in");
  });
  var target = document.getElementById(id);
  if (target) {
    target.style.display = "block";
    void target.offsetWidth;
    target.classList.add("fade-in");
  }

  //higlight the right tab at the bottom (uses tapmap to match section IDs to tab button indexes)
  var tabMap = { "welcome-tab": 0, "library-tab": 1, "conversion-tab": 2, "help-tab": 3 };
  document.querySelectorAll(".app-tab-bar button").forEach(function(btn, i) {
    btn.classList.toggle("active", i === tabMap[id]);
  });
}
window.showTab = showTab;

//enter name prompt only called during first launch. backup loadHomepage()
function submitName() {
  var input = document.getElementById("usernameInput");
  var name = input ? input.value.trim() : "";
  if (!name) return;
  localStorage.setItem("userName", name);
  updateTitle();
  loadHomeDashboard();
}
window.submitName = submitName;

//then the header is upades to show uer's name - criterion b 
function updateTitle() {
  var name = localStorage.getItem("userName");
  var header = document.getElementById("app-title");
  if (name && header) header.textContent = name + "'s Library";
}

//enter name again or use already saved name (if else conditional statemnt) - criterion c
async function loadHomePage() {
  var name = localStorage.getItem("userName");
  var nameEntry = document.getElementById("name-entry");
  var homeDashboard = document.getElementById("home-dashboard");
  if (!name) {
    if (nameEntry) nameEntry.style.display = "block";
    if (homeDashboard) homeDashboard.style.display = "none";
    return;
  }
  if (nameEntry) nameEntry.style.display = "none";
  if (homeDashboard) homeDashboard.style.display = "block";

  ///diffrent greeting based on time of day :)
  var hour = new Date().getHours();
  var time = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  var greeting = document.getElementById("greeting");
  if (greeting) greeting.textContent = "Good " + time + ", " + name + "."; 


  var container = document.getElementById("recent-books");
  var noRecent = document.getElementById("no-recent");
  var recentIds = JSON.parse(localStorage.getItem("recentBooks") || "[]");
  if (recentIds.length === 0) {
    if (noRecent) noRecent.style.display = "block";
    return;
  }
  try {
    var books = await getAllBooks();

    //filter to only recent books that are not finished through mathicng IDs to book objects
    var recent = recentIds
      .map(function(id) { return books.find(function(b) { return b.id === id; }); })
      .filter(Boolean)
      .filter(function(b) { return localStorage.getItem("finished_" + b.id) !== "true"; })
      .slice(0, 3);
    if (!recent.length) {
      if (noRecent) noRecent.style.display = "block";
      return;
    }
    if (noRecent) noRecent.style.display = "none";
    if (container) container.innerHTML = "";
  
    recent.forEach(function(book) {
      var pct = Math.round((parseFloat(localStorage.getItem("progress_" + book.id)) || 0) * 100);
      
      //manually written card with a lot of innerhtml so that i can control layout
      //aided by gpt but manually edited
      var card = document.createElement("div");
      card.style.cssText = "background:var(--card-bg);border-radius:14px;padding:14px 16px;margin-bottom:12px;cursor:pointer;display:flex;align-items:center;gap:14px;box-shadow:0 0 0 0.5px var(--border-color);";
      card.innerHTML =
        '<div style="width:42px;height:58px;border-radius:5px;flex-shrink:0;background:' +
        (book.coverUrl ? "none" : "linear-gradient(145deg,#3a3530,#2a2520)") +
        ';box-shadow:2px 2px 6px rgba(0,0,0,0.14);overflow:hidden;">' +
        (book.coverUrl ? '<img src="' + book.coverUrl + '" style="width:100%;height:100%;object-fit:cover;">' : "") +
        '</div><div style="flex:1;min-width:0;">' +
        '<div style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + book.title + "</div>" +
        '<div style="font-size:12px;color:var(--text-secondary);margin:3px 0 10px;">' + pct + "% complete</div>" +
        '<div style="height:3px;background:var(--border-color);border-radius:99px;">' +
        '<div style="width:' + pct + '%;height:100%;background:var(--accent);border-radius:99px;"></div>' +
        "</div></div>" +
        '<div style="color:var(--text-secondary);font-size:20px;flex-shrink:0;">›</div>';

        card.addEventListener("click", function() {
        localStorage.setItem("lastOpenedBookId", book.id);
        window.location.href = "reader.html";
      });
      if (container) container.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to load recent books:", err);
    if (noRecent) noRecent.style.display = "block";
}}
window.loadHomeDashboard = loadHomePage;

function trackRecentBook(bookId) {
  var recent = JSON.parse(localStorage.getItem("recentBooks") || "[]");
  recent = [bookId].concat(recent.filter(function(id) { return id !== bookId; })).slice(0, 3);
  localStorage.setItem("recentBooks", JSON.stringify(recent));
}
window.trackRecentBook = trackRecentBook;

// FLGD
window.addToLibrary = async function() {
  var fileInput = document.getElementById("epubUpload");
  var file = fileInput ? fileInput.files[0] : null;
  if (!file) { alert("Please select an EPUB file."); return; }
  try {
    showLoading();
    await saveBook(file);
    hideLoading();
    fileInput.value = "";
    await refreshLibrary();
    showTab("library-tab");
  } catch (err) {
    hideLoading();
    alert("Failed to add EPUB: " + err.message);
  }
};

async function convertPDF() {
  var fileInput = document.getElementById("pdfFileInput");
  var file = fileInput ? fileInput.files[0] : null;
  if (!file) { alert("Please select a PDF file."); return; }

  document.getElementById("conversion-idle").style.display = "none";
  document.getElementById("conversion-progress").style.display = "block";
  document.getElementById("conversion-done").style.display = "none";

function setStatus(msg, detail, pct) {

    // should update progress bar. not working. might remoce and just keep menue
      document.getElementById("conversion-status").textContent = msg;
    document.getElementById("conversion-detail").textContent = detail || "";
    document.getElementById("conversion-bar").style.width = (pct || 0) + "%";
  }

  try {
    if (!window.pdfjsLib) throw new Error("PDF.js not loaded.");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    setStatus("Reading PDF…", file.name, 5);
    var arrayBuffer = await file.arrayBuffer();
    var pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    var totalPages = pdf.numPages;

    setStatus("Extracting text…", totalPages + " pages found", 10);

    // extract all the pages
    var pages = [];
    for (var i = 1; i <= totalPages; i++) {
      var page = await pdf.getPage(i);
      var content = await page.getTextContent();


      //extract x and y coordnated from PDF
      //Pattern from PDF.js
      // https://mozilla.github.io/pdf.js/examples/ used
      var items = content.items
        .filter(function(item) { return item.str && item.str.trim(); })
        .map(function(item) {
          return {
            str: item.str
              .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
              .replace(/\uFFFD/g, ""),
            x: item.transform[4],
            y: item.transform[5],
            height: item.height || 12
          };
        })
        .filter(function(item) { return item.str.trim().length > 0; });

      // descending Y (top of page first), then ascending X (left to right)
      items.sort(function(a, b) {
        var yDiff = b.y - a.y;
        //if items are on the same line sort by X
        if (Math.abs(yDiff) < (a.height * 0.5)) return a.x - b.x;
        return yDiff;
      });

      //group into lines by proximity
      var lines = [];
      var currentLine = [];
      var lastY = null;
      var lastHeight = 12;

      items.forEach(function(item) {

        //will group text fragments into line using half hte item's height
        if (lastY === null || Math.abs(item.y - lastY) < lastHeight * 0.5) {
          currentLine.push(item.str);
        } else {
          if (currentLine.length) lines.push(currentLine.join(" ").trim());
          currentLine = [item.str];
        }
        lastY = item.y;
        lastHeight = item.height || lastHeight;
      });
      if (currentLine.length) lines.push(currentLine.join(" ").trim());

      pages.push(lines.filter(function(l) { return l.length > 0; }));

      var pct = 10 + Math.round((i / totalPages) * 50);
      if (i % 10 === 0) setStatus("Extracting text…", "Page " + i + " of " + totalPages, pct);
    }

    setStatus("Detecting chapters…", "", 62);

    // find chapter 
    var chapters = findChapters(pages, totalPages);

    setStatus("Building EPUB…", chapters.length + " chapters found", 75);

    var title = file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " ").trim();
    var epubBlob = await makeEpub(title, chapters);

    setStatus("Adding to library…", "", 90);

    //should add to library as a real EPUB file. unsuccessful. need to extract blob more accurately
    var epubFile = new File([epubBlob], title + ".epub", { type: "application/epub+zip" });
    await saveBook(epubFile);
    await refreshLibrary();

    //will give option do donwload directly to files. Dunja will want to check
    //dissapears when page is left
    var oldUrl = document.getElementById("download-link").href;
    if (oldUrl && oldUrl.startsWith("blob:")) URL.revokeObjectURL(oldUrl);
    var url = URL.createObjectURL(epubBlob);
    var dl = document.getElementById("download-link");
    dl.href = url;

    
    document.getElementById("conversion-progress").style.display = "none";
    document.getElementById("conversion-done").style.display = "block";
    document.getElementById("conversion-book-title").textContent = title;
    document.getElementById("conversion-book-meta").textContent = chapters.length + " chapters · " + totalPages + " pages · added to your library";

  } catch (err) {
    document.getElementById("conversion-progress").style.display = "none";
    document.getElementById("conversion-idle").style.display = "block";
    console.error("Conversion failed:", err);
    alert("Conversion failed: " + err.message);
  }
}
window.convertPDF = convertPDF;

/*source chatgpt*/
function checkIFPageNum(line) {
  return /^\d+$/.test(line.trim()) || /^-\s*\d+\s*-$/.test(line.trim());
}

function findChapters(pages, totalPages) {
  
  pages = pages.map(function(pageLines) {
    return pageLines
      .map(function(l) {
        return l.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") .replace(/\uFFFD/g, "").trim();
      })
      .filter(function(l) { return l.length > 0; });
  });


  //first flatten all lines of whole file int one stream
  //keep track of page breaks as make paragraph breaks
  var allLines = [];
  pages.forEach(function(pageLines, pageIdx) {
  if (pageIdx > 0) allLines.push(null); // null = page break
    
    pageLines.forEach(function(line) { allLines.push(line); });
  });

 
var chapterPatterns = [
  /^chapter\s+[\divxlcIVXLC]+/i,
  /^chapter\s+\w+/i,
  /^part\s+[\divxlcIVXLC]+/i,
  /^prologue$/i,
  /^epilogue$/i,
  /^introduction$/i,
  /^afterword$/i,
  /^interlude$/i,
  /^episode\s+\d+/i,          
  /^\[chapter\s+\d+/i,
  /^\[episode\s+\d+/i,
  /^\[ep\.?\s+\d+/i,
];


function isHeading(line) {
  if (!line || line.length < 2 || line.length > 60) return false;

  // Must match known chapter/section keywords
  for (var i = 0; i < chapterPatterns.length; i++) {
    if (chapterPatterns[i].test(line.trim())) return true;
  }

  //much stricter now to avoid random slip ins. all caps. must be 3+ real words, no digits, no symbls, no dots
  var trimmed = line.trim();
  if (
    trimmed === trimmed.toUpperCase() &&
    trimmed.length >= 6 &&
    trimmed.length <= 40 &&
    /^[A-Z][A-Z\s]+$/.test(trimmed) &&  
    trimmed.split(" ").filter(Boolean).length >= 2 
  ) return true;

  return false;
}

  var chapters = [];
  var currentChapter = { title: "Beginning", paragraphs: [] };
  var currentPara = [];

  function savePara() {
    if (currentPara.length) {
      currentChapter.paragraphs.push(currentPara.join(" "));
      currentPara = [];
    }
  }
  function saveChapter() {
    savePara();
    if (currentChapter.paragraphs.length > 0) {
      chapters.push(currentChapter); }
}

  allLines.forEach(function(line) {
    //
    if (line === null) {
      savePara();
      return;}

     if (isPageNumber(line)) return;    
  
    if (isHeading(line)) {
      saveChapter();
    currentChapter = { title: line.trim(), paragraphs: [] };
      return;}

    if (line.trim() === "") {
      savePara();
      return; }

    //if lLine endsw no period/quote always continue as paragraph
    currentPara.push(line.trim());

    // if line ends with sentence-ending punct AND next behaviour suggests
    // paragraph end, flush. For now flush on lines that end with period
    // followed by what looks like a new paragraph start.
    var endsCleanly = /[.!?'"»]\s*$/.test(line);
    if (endsCleanly && currentPara.length > 2) {
}});


  saveChapter();

//check if arithmetic criteron in complexity
  //if no chapters found, make one per N paragraphs
  if (chapters.length <= 1 && chapters[0] && chapters[0].paragraphs.length > 30) {
    var allParas = chapters[0].paragraphs;
    chapters = [];
    var groupSize = 20;
    for (var i = 0; i < allParas.length; i += groupSize) {
      chapters.push({
        title: "Part " + (Math.floor(i / groupSize) + 1),
        paragraphs: allParas.slice(i, i + groupSize)
   });
}}

  //to htmll
  //section assited by ai when opened EPUB's kept watermarks and random characters
  return chapters.map(function(ch) {
    return {
      title: ch.title,
      content: ch.paragraphs
        .filter(function(p) { return p.trim().length > 0; })
        .map(function(p) {
          return "<p>" +
            p.replace(/&/g,"&amp;")
             .replace(/</g,"&lt;")
             .replace(/>/g,"&gt;")
             .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,"") +
          "</p>";
        }).join("\n")
  };});}

async function makeEpub(title, chapters) {
  var zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF").file("container.xml",
  '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
);

  var oebps = zip.folder("OEBPS");

  chapters.forEach(function(ch, i) {
    oebps.file("chapter" + (i + 1) + ".xhtml",
      '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml">' +
      '<head><title>' + ch.title + '</title><style>' +
      'body{font-family:Georgia,serif;font-size:1em;line-height:1.8;margin:2em 1.5em;color:#1a1a1a;}' +
      'h2{font-size:1.3em;font-weight:700;margin:0 0 1.5em;line-height:1.3;}' +
      'p{margin:0 0 1em;text-indent:1.5em;}p:first-of-type{text-indent:0;}' +
      '</style></head>' +
      '<body><h2>' + ch.title + '</h2>' + ch.content + '</body></html>'
    );
  });

  var manifest = chapters.map(function(c, i) {
    return '<item id="c' + (i+1) + '" href="chapter' + (i+1) + '.xhtml" media-type="application/xhtml+xml"/>';
  }).join("");
  var spine = chapters.map(function(c, i) {
    return '<itemref idref="c' + (i+1) + '"/>';
  }).join("");

  oebps.file("content.opf",
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title>' + title + '</dc:title>' +
    '<dc:creator>Unknown</dc:creator>' +
    '<dc:identifier id="uid">urn:uuid:' + crypto.randomUUID() + '</dc:identifier>' +
    '<dc:language>en</dc:language></metadata>' +
    '<manifest>' + manifest + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>' +
    '<spine toc="ncx">' + spine + '</spine></package>'
  );

  var nav = chapters.map(function(ch, i) {
    return '<navPoint id="n' + (i+1) + '" playOrder="' + (i+1) + '">' +
      '<navLabel><text>' + ch.title + '</text></navLabel>' +
      '<content src="chapter' + (i+1) + '.xhtml"/></navPoint>';
  }).join("");
  oebps.file("toc.ncx",
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">' +
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
    '<head><meta name="dtb:uid" content="uid"/></head>' +
    '<docTitle><text>' + title + '</text></docTitle>' +
    '<navMap>' + nav + '</navMap></ncx>'
  );

  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

function resetConversion() {
  document.getElementById("conversion-done").style.display = "none";
  document.getElementById("conversion-idle").style.display = "block";
  var inp = document.getElementById("pdfFileInput");
  if (inp) inp.value = "";
}
window.resetConversion = resetConversion;
function showLoading() {
  var overlay = document.getElementById("loading-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loading-overlay";
    overlay.innerHTML = '<div class="spinner"></div>';
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:2000;";
    document.body.appendChild(overlay);
  }
  overlay.style.display = "flex";}

function hideLoading() {
  var overlay = document.getElementById("loading-overlay");
  if (overlay) overlay.style.display = "none";} 

/*will wait for page toload before anything else */
document.addEventListener("DOMContentLoaded", async function() {

  try {
    await openDatabase();
    console.log("IndexedDB ready");
    libraryHealthCheck();
  } catch (err) {
    console.error("DB failed:", err);
  }

//
  var darkMode = localStorage.getItem("darkMode");

  if (darkMode === "enabled") document.body.classList.add("dark-theme");
  var toggleBtn = document.getElementById("dark-mode-toggle");
  if (toggleBtn) {
    toggleBtn.textContent = darkMode === "enabled" ? "Light Mode" : "Dark Mode";
    toggleBtn.addEventListener("click", function() {
    var isDark = document.body.classList.toggle("dark-theme"); localStorage.setItem("darkMode", isDark ? "enabled" : "disabled");
  toggleBtn.textContent = isDark ? "Light Mode" : "Dark Mode";
    });
  }
  document.getElementById("pdfFileInput").addEventListener("change", function() {
  if (this.files[0]) convertPDF();});  

document.getElementById("epubUpload").addEventListener("change", function() {
  if (this.files[0]) addToLibrary();
  });
window.loadHomePage = loadHomePage;
loadHomePage(); } ) ;