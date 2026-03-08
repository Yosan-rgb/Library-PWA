import { getDB, STORE_NAME } from "./db.js";

export function libraryHealthCheck() {
  console.log("library.js health check OK");
}

export async function saveBook(file) {
  const db = getDB();

  let coverUrl = null;
  let title = file.name.replace(/\.epub$/i, "").replace(/_/g, " ").trim();

  try {
    const ab = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(ab);

    /* i'll be going though a step by step process of how the epub (which is essentially a zip file) is parsed, (REFRENCE IMAAGE IN DESIGN HERE). to extract the cover and title.
    * sources for following code logic:
    *   - For EPUB 2 and 3 Metadata standards : W3C https://www.w3.org
    *   - Ba    
    */

    // step 1: find OPF path from container.xml
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("No container.xml");
    const containerXml = await containerFile.async("text");
    const opfMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!opfMatch) throw new Error("No OPF path");
    const opfPath = opfMatch[1];
    const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

    // Step 2: parse OPF
    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error("No OPF file");
    const opfXml = await opfFile.async("text");
    const parser = new DOMParser();
    const opfDoc = parser.parseFromString(opfXml, "application/xml");

    // Step 3: title
    const titleEl = opfDoc.querySelector("title") || opfDoc.querySelector("dc\\:title");
    if (titleEl && titleEl.textContent.trim()) title = titleEl.textContent.trim();

    // Step 4: find cover image. 
    let coverHref = null;

  
    // cover extraction try A:
    const coverMeta = opfDoc.querySelector("meta[name='cover']");
    if (coverMeta) {
      const coverId = coverMeta.getAttribute("content");
      const coverItem = opfDoc.querySelector("item[id='" + coverId + "']");
      if (coverItem) coverHref = coverItem.getAttribute("href");
    }

    //  B: item with properties="cover-image"
    if (!coverHref) {
      const propItem = opfDoc.querySelector("item[properties='cover-image']");
      if (propItem) coverHref = propItem.getAttribute("href");
    }

    // C: use item whose id contains "cover" and is an image
    if (!coverHref) {
      const items = opfDoc.querySelectorAll("item");
      for (let i = 0; i < items.length; i++) {
        const id = (items[i].getAttribute("id") || "").toLowerCase();
        const mt = (items[i].getAttribute("media-type") || "").toLowerCase();
        if (id.includes("cover") && mt.startsWith("image/")) {
          coverHref = items[i].getAttribute("href");
          break;
        }
      }
    }

    //*  D: just use first image in manifest
    if (!coverHref) {
      const firstImg = opfDoc.querySelector("item[media-type^='image/']");
      if (firstImg) coverHref = firstImg.getAttribute("href");
    }

    if (coverHref) {
      // resolve relative to OPF directory, handle 
      const resolvePath = function(base, rel) {
        if (rel.startsWith("/")) return rel.substring(1);
        const parts = (base + rel).split("/");
        const resolved = [];
        for (let i = 0; i < parts.length; i++) {
          if (parts[i] === "..") resolved.pop();
          else if (parts[i] !== ".") resolved.push(parts[i]);
        }
        return resolved.join("/");
      };

      const fullPath = resolvePath(opfDir, coverHref);

      // try exact path first, if not there are other variations
      const attempts = [fullPath, coverHref, opfDir + coverHref];
      let coverFile = null;
      for (let i = 0; i < attempts.length; i++) {
        coverFile = zip.file(attempts[i]);
        if (coverFile) break;
      }

      if (coverFile) {
        const blob = await coverFile.async("blob");
        coverUrl = await new Promise(function(resolve) {
          const reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.readAsDataURL(blob);
        });
      }
    }
  } catch (e) {
    console.warn("Cover/metadata extraction failed:", e.message);
  }

  const book = {
    id: crypto.randomUUID(),
    title: title,
    data: file.slice(0),
    coverUrl: coverUrl,
    addedAt: Date.now()
  };

  return new Promise(function(resolve, reject) {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(book);
    req.onsuccess = function() { resolve(book); };
    req.onerror = function() { reject(new Error("Failed to save book")); };
  });
}

export function getAllBooks() {
  return new Promise(function(resolve, reject) {
    const db = getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(new Error("Failed to load books")); };
  });
}

export function getBookById(id) {
  return new Promise(function(resolve, reject) {
    const db = getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(new Error("Failed to load book")); };
  });
}

export function deleteBook(id) {
  return new Promise(function(resolve, reject) {
    const db = getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = function() { resolve(); };
    req.onerror = function() { reject(new Error("Failed to delete book")); };
  });
}

export function updateBookTitle(id, newTitle) {
  return new Promise(function(resolve, reject) {
    const db = getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = function() {
      const book = getReq.result;
      if (!book) { reject(new Error("Book not found")); return; }
      book.title = newTitle;
      const putReq = store.put(book);
      putReq.onsuccess = function() { resolve(); };
      putReq.onerror = function() { reject(new Error("Failed to rename")); };
    };
    getReq.onerror = function() { reject(new Error("Failed to find book")); };
  });
}

export function updateBookCover(id, newCoverUrl) {
  return new Promise(function(resolve, reject) {
    const db = getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = function() {
      const book = getReq.result;
      if (!book) { reject(new Error("Book not found")); return; }
      book.coverUrl = newCoverUrl;
      const putReq = store.put(book);
      putReq.onsuccess = function() { resolve(); };
      putReq.onerror = function() { reject(new Error("Failed to update cover")); };
    };
    getReq.onerror = function() { reject(new Error("Failed to find book")); };
  });
}