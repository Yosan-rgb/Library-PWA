import { getAllBooks, deleteBook, updateBookTitle } from "./library.js";

export function setupUI() {
  refreshLibrary();
 }

export async function refreshLibrary() {
  const list = document.getElementById("libraryList");
  if (!list) return;
  list.innerHTML = "";
  const books = await getAllBooks();

  if (books.length === 0) {
    list.innerHTML = '<li style="grid-column:1/-1;text-align:center;color:var(--text-secondary);font-size:15px;padding:32px 16px;background:var(--card-bg);border-radius:12px;list-style:none;">No books yet — add an EPUB below.</li>';
    return;
  }

  for (const book of books) {
    const finished = localStorage.getItem("finished_" + book.id) === "true";

    const li = document.createElement("li");
    li.style.cssText = "cursor:pointer;display:flex;flex-direction:column;position:relative;";

   //https://developer.mozilla.org/en-US/docs/Web/CSS/aspect-ratio 
    const cover = document.createElement("div");
    cover.className = "book-cover" + (finished && !book.coverUrl ? " no-cover" : "") + (finished ? " finished" : "");

    if (book.coverUrl) {
      const img = document.createElement("img");
      img.src = book.coverUrl;
      cover.appendChild(img);
    } else {
      const nocover = document.createElement("div");
      nocover.className = "book-no-cover-label";
      nocover.textContent = "No Cover";
      cover.appendChild(nocover);
      }

    //a 'Done' watermark over the cover
    if (finished) {
      const badge = document.createElement("div");
      badge.className = "book-done-badge";
      badge.textContent = "Done";
      cover.appendChild(badge);
      }

    const dotsBtn = document.createElement("button");
    dotsBtn.className = "book-dots-btn";
    dotsBtn.textContent = "⋯";
    dotsBtn.addEventListener("click", function(e) {
  e.stopPropagation();
  showBookMenu(book, li, dotsBtn);
});


    const titleEl = document.createElement("div");
    titleEl.className = "book-title-label" + (finished ? " finished" : "");
    titleEl.textContent = book.title;

    li.appendChild(cover);
    li.appendChild(dotsBtn);
    li.appendChild(titleEl);

    li.addEventListener("click", function() {
      localStorage.setItem("lastOpenedBookId", book.id);
      window.location.href = "reader.html";
    });

    list.appendChild(li);
  }}

//floating dots menu 
function showBookMenu(book, li, anchor) {
  //remove any existing menu
  const existing = document.getElementById("book-menu-popup");
  if (existing) existing.remove();

  const finished = localStorage.getItem("finished_" + book.id) === "true";

  const menu = document.createElement("div");
  menu.id = "book-menu-popup";
  menu.className = "book-menu-popup";

// https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect
  const rect = anchor.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.right = (window.innerWidth - rect.right) + "px";

  const items = [
    {
      label: finished ? "✓ Mark unread" : "Mark as done",
      action: function() {
        localStorage.setItem("finished_" + book.id, (!finished).toString());
        refreshLibrary();
      }},
    
    {
    
      label: "Rename",
      action: async function() {
        const newName = prompt("Rename book:", book.title);
        if (newName && newName.trim() && newName.trim() !== book.title) {
          const { updateBookTitle } = await import("./library.js");
          await updateBookTitle(book.id, newName.trim());
          refreshLibrary();
        } }
    },
    {
      label: "Replace Cover",
      action: function() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", async function() {
          const file = input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = async function() {
            const { updateBookCover } = await import("./library.js");
            await updateBookCover(book.id, reader.result);
            refreshLibrary();
          };
          reader.readAsDataURL(file);
        });
        input.click();
      }
    },
    {
      label: "Delete",
      danger: true,
      action: async function() {
        if (!confirm("Delete \"" + book.title + "\"?")) return;
        const { deleteBook } = await import("./library.js");
        await deleteBook(book.id);
        ["cfi_","progress_","bookmarks_","highlights_","finished_","fontSize_","readingMode_","readerTheme_"].forEach(function(p) {
          localStorage.removeItem(p + book.id);
        });
        let recent = JSON.parse(localStorage.getItem("recentBooks") || "[]");
        recent = recent.filter(function(id) { return id !== book.id; });
        localStorage.setItem("recentBooks", JSON.stringify(recent));
        refreshLibrary();
      }
    }
  ];

  //https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation
  items.forEach(function(item, i) {
    const row = document.createElement("div");
    row.textContent = item.label;
    row.className = "book-menu-row" + (item.danger ? " danger" : "");

    row.addEventListener("click", function(e) {
      e.stopPropagation();
      menu.remove();
      item.action();
    });
    menu.appendChild(row);
  });

  document.body.appendChild(menu);

  //https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener#once
  setTimeout(function() {
    document.addEventListener("click", function closeMenu() {
      menu.remove();
      document.removeEventListener("click", closeMenu);
    }, { once: true });
  }, 0);
}

//call this from reader.js when near the end of book (last 5% to account for extra pages)
window.autoMarkDone = function(bookId, pct) {
  if (pct >= 95) {
    const already = localStorage.getItem("finished_" + bookId) === "true";
    if (!already) {
      localStorage.setItem("finished_" + bookId, "true");
    }
  }
};