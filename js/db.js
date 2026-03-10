console.log("db.js loaded"); //confirsm the moule loded during test
const DB_NAME = 'epubLibraryDB';
const DB_VERSION = 1; //extensibility for future. schema changes possible.
const STORE_NAME = 'books';

let db = null;
//let dbReady= False;

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject("Failed to open IndexedDB");

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

  //runs then db first created + crates books store when not there.
    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, {
          keyPath: "id"
      });}
    };
  });
}

export function getDB() {
  if (!db) throw new Error("your database not initialized. Call openDatabase() first.");   
  return db;
}

export { STORE_NAME };