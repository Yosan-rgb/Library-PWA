import { db } from "./db.js";

export function libraryHealthCheck() {
  console.log("library.js health check OK");}


export async function saveBook(file) {
  let coverUrl = null;
   let title = file.name.replace(/\.epub$/i, "").replace(/_/g, " ").trim();

  try {
    const ab = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(ab);

    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("No container.xml");
    const containerXml = await containerFile.async("text");
     const opfMatch = containerXml.match(/full-path="([^"]+)"/);
    if (!opfMatch) throw new Error("No OPF path");
    const opfPath = opfMatch[1];
     const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

    const opfFile = zip.file(opfPath);
    if (!opfFile) throw new Error("No OPF file");
    const opfXml = await opfFile.async("text");
    const parser = new DOMParser();
    const opfDoc = parser.parseFromString(opfXml, "application/xml");

    const titleEl = opfDoc.querySelector("title") || opfDoc.querySelector("dc\\:title");
    if (titleEl && titleEl.textContent.trim()) title = titleEl.textContent.trim();

    let coverHref = null;

    const coverMeta = opfDoc.querySelector("meta[name='cover']");
    if (coverMeta) {
      const coverId = coverMeta.getAttribute("content");
       const coverItem = opfDoc.querySelector("item[id='" + coverId + "']");
      if (coverItem) coverHref = coverItem.getAttribute("href"); 
     }

    if (!coverHref) {
      const propItem = opfDoc.querySelector("item[properties='cover-image']");
      if (propItem) coverHref = propItem.getAttribute("href");
    }

    if (!coverHref) {
      const items = opfDoc.querySelectorAll("item");
      for (let i = 0; i < items.length; i++) {
        const id = (items[i].getAttribute("id") || "").toLowerCase();
        const mt = (items[i].getAttribute("media-type") || "").toLowerCase();
        if (id.includes("cover") && mt.startsWith("image/")) {
          coverHref = items[i].getAttribute("href");
          break;}
  }}

    if (!coverHref) {
      const firstImg = opfDoc.querySelector("item[media-type^='image/']");
      if (firstImg) coverHref = firstImg.getAttribute("href");}

    if (coverHref) {
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
      const attempts = [fullPath, coverHref, opfDir + coverHref ];
      let coverFile = null;
      for (let i = 0; i < attempts.length; i++) {
        coverFile = zip.file(attempts[i]);
        if (coverFile) break;}

      if (coverFile) {
        const blob = await coverFile.async("blob");
        coverUrl = await new Promise(function(resolve) {
          const reader = new FileReader();
          reader.onload = function() { resolve(reader.result); };
          reader.readAsDataURL(blob);
        }); }
    }
  } catch (e) {
    console.warn("Cover/metadata extraction failed:", e.message);
  }

  const book = {
    id: crypto.randomUUID( ),
    title,
    data: file.slice(0),
    coverUrl,
    addedAt: Date.now()  };

  await db.books.add(book);   
  return book;
}

export const getAllBooks = () => db.books.toArray( ); 
 export const getBookById = id => db.books.get(id);
export const deleteBook = id => db.books.delete(id);

export async function updateBookTitle(id, newTitle) { 
  await db.books.update(id, { title: newTitle });
}

export async function updateBookCover(id, newCoverUrl) {  
  await db.books.update(id, { coverUrl: newCoverUrl });}