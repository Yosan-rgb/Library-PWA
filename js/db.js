//here i'll be using Dexie instead of writing the whole IndexedDB beause i got really confused and overwheled w doing it manually

import Dexie from "https://unpkg.com/dexie/dist/dexie.mjs";

export const db = new Dexie("epubLibraryDB");

//schema version 1 - can be extensed - crretirion e
// books store keeps basic info about each saved book. in dexie's fromat 
 db.version(1).stores({
  books: "id, title, addedAt"
} );
