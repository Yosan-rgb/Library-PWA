//source:https://dexie.org/docs/API-Reference
import Dexie from "https://unpkg.com/dexie/dist/dexie.mjs";
//here i'll be using Dexie instead of writing the whole IndexedDB beause i got really confused and overwheled w doing it manually

export const db = new Dexie("epubLibraryDB");

db.version(1).stores({
  books: "id, title, addedAt"
}) ;