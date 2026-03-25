import { db } from "./db.js"

function resolveRelativePath(base, rel) {
  if (!rel) return "";
  if (rel.startsWith("/")) return rel.substring(1);
  if (rel.startsWith("http") || rel.startsWith("data:")) return rel;
  const parts = (base + rel).split("/").filter(p => p !== ".");
  const resolved = [];
  for (const p of parts) {
    p === ".." ? resolved.pop() : resolved.push(p);
  }
  return resolved.join("/");
} ;

//cant see if model is being imported. emporary for console check to confirm load order
export function libraryHealthCheck() {
   console.log("library.js health check OK");}


export async function saveBook(file) {
  if (!file.name.toLowerCase().endsWith(".epub")) {
    throw new Error(`Invalid file type: ${file.name}`);
   }
  let coverUrl = null;

  //ai supported
   let title = file.name.replace(/\.epub$/i, "").replace(/_/g, " ").trim();

  try {
    const ab = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(ab);

    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) throw new Error("No container.xml");
    const containerXml = await containerFile.async("text");

    //
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
//cover extraction try 1 for EPUB2s. will look for metatag with <meta[name='cover']> tag
//https://www.w3.org/TR/epub-33/#sec-opf-dcmes-optional-def
    const coverMeta = opfDoc.querySelector("meta[name='cover']");
    if (coverMeta) {
      const coverId = coverMeta.getAttribute("content");
       const coverItem = opfDoc.querySelector("item[id='" + coverId + "']");
      if (coverItem) coverHref = coverItem.getAttribute("href"); 
    }

    // 2 looks for items with properties="cover-image" 
    if (!coverHref) {
      const propItem = opfDoc.querySelector("item[properties='cover-image']");
      if (propItem) coverHref = propItem.getAttribute("href");
     }


  //just use the first image if still nothing
if (!coverHref) {
  const items = opfDoc.querySelectorAll("item");
  for (let i = 0; i < items.length; i++) {
    const id = (items[i].getAttribute("id") || "").toLowerCase();
    const mt = (items[i].getAttribute("media-type") || "").toLowerCase();
    if (id.includes("cover") && mt.startsWith("image/")) {
      coverHref = items[i].getAttribute("href");
      break;
    } }}

      //final fallback
      if (!coverHref) {
  const anyImg = opfDoc.querySelector("item[media-type^='image/']");
  if (anyImg) coverHref = anyImg.getAttribute("href");}


    if (coverHref)  {

      const fullPath = resolveRelativePath(opfDir, coverHref);
      const coverFile = zip.file(fullPath) 
        || zip.file(coverHref)
        || zip.file(opfDir + coverHref)
        || zip.file(coverHref.replace(/^\//, ""));

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


//https://developer.mozilla.org/en-US/docs/Web/API/Blob/slice
  const book = {
    id: crypto.randomUUID(),
    title,
    data: file,
    coverUrl,
    addedAt: Date.now()
      } ;

  await db.books.add(book);   
  return book;  }

export const getAllBooks = () => db.books.toArray( ); 
  export const getBookById = id => db.books.get(id);
export const deleteBook = id => db.books.delete(id);

export async function updateBookTitle(id, newTitle) { 
   await db.books.update(id, { title: newTitle });}

export async function updateBookCover(id, newCoverUrl) {  
await db.books.update(id, { coverUrl: newCoverUrl });
}