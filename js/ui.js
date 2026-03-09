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

    
    const cover = document.createElement("div");
    cover.style.cssText = "width:100%;aspect-ratio:2/3;border-radius:8px;overflow:hidden;box-shadow:2px 4px 12px rgba(0,0,0,0.18);margin-bottom:6px;flex-shrink:0;position:relative;background:linear-gradient(145deg,#3a3530,#2a2520);";

    if (book.coverUrl) {
      const img = document.createElement("img");
      img.src = book.coverUrl;
      img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;" + (finished ? "opacity:0.35;filter:grayscale(40%);" : "");
      cover.appendChild(img);
    } else {
      cover.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:500;padding:8px;text-align:center;opacity:0.5;">No Cover</div>';
      if (finished) cover.style.opacity = "0.4";
    }

    //a 'Done' watermark over the cover
    if (finished) {
      const doneMark = document.createElement("div");
      doneMark.textContent = "Done";
      doneMark.style.cssText = "position:absolute;bottom:6px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.45);color:rgba(255,255,255,0.85);font-size:9px;font-weight:600;letter-spacing:0.5px;padding:2px 8px;border-radius:4px;pointer-events:none;";
      cover.appendChild(doneMark);
    }

    //3 dots menu button at top right of cover, like on apple books app
    const dotsBtn = document.createElement("button");
    dotsBtn.textContent = "⋯";
    dotsBtn.style.cssText = "position:absolute;top:4px;right:4px;z-index:10;background:rgba(0,0,0,0.45);color:#fff;border:none;border-radius:6px;width:24px;height:20px;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;backdrop-filter:blur(4px);";
    dotsBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      showBookMenu(book, li, dotsBtn);
    });

    //book title element 
    const titleEl = document.createElement("div");
    titleEl.textContent = book.title;
    titleEl.style.cssText = "font-size:11px;font-weight:500;text-align:center;line-height:1.3;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:var(--text-color);" + (finished ? "opacity:0.45;" : "");

    li.appendChild(cover);
    li.appendChild(dotsBtn);
    li.appendChild(titleEl);

    li.addEventListener("click", function() {
      localStorage.setItem("lastOpenedBookId", book.id);
      window.location.href = "reader.html";
    });

    list.appendChild(li);
  }
}

//floating dots menu 
function showBookMenu(book, li, anchor) {
  // Remove any existing menu
  const existing = document.getElementById("book-menu-popup");
  if (existing) existing.remove();

  const finished = localStorage.getItem("finished_" + book.id) === "true";

  const menu = document.createElement("div");
  menu.id = "book-menu-popup";
  menu.style.cssText = "position:fixed;z-index:9000;background:var(--card-bg);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.22);min-width:160px;overflow:hidden;border:0.5px solid var(--border-color);";

  const rect = anchor.getBoundingClientRect();
  menu.style.top = (rect.bottom + 4) + "px";
  menu.style.right = (window.innerWidth - rect.right) + "px";

  const items = [
    {
      label: finished ? "✓ Mark unread" : "Mark as done",
      action: function() {
        localStorage.setItem("finished_" + book.id, (!finished).toString());
        refreshLibrary();
      }
    },
    {
      label: "Rename",
      action: async function() {
        const newName = prompt("Rename book:", book.title);
        if (newName && newName.trim() && newName.trim() !== book.title) {
          const { updateBookTitle } = await import("./library.js");
          await updateBookTitle(book.id, newName.trim());
          refreshLibrary();
        }
      }
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
        ["cfi_","progress_","bookmarks_","highlights_","finished_","fontSize_"].forEach(function(p) {
          localStorage.removeItem(p + book.id);
        });
        let recent = JSON.parse(localStorage.getItem("recentBooks") || "[]");
        recent = recent.filter(function(id) { return id !== book.id; });
        localStorage.setItem("recentBooks", JSON.stringify(recent));
        refreshLibrary();
      }
    }
  ];

  items.forEach(function(item, i) {
    const row = document.createElement("div");
    row.textContent = item.label;
    row.style.cssText = "padding:13px 16px;font-size:15px;cursor:pointer;color:" + (item.danger ? "#ff453a" : "var(--text-color)") + ";" + (i < items.length - 1 ? "border-bottom:0.5px solid var(--border-color);" : "");
    row.addEventListener("click", function(e) {
      e.stopPropagation();
      menu.remove();
      item.action();
    });
    menu.appendChild(row);
  });

  document.body.appendChild(menu);

  //close app on outside tap
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