var myCache = "library-app-v2";

// complexity- array with all the file's paths so it works offline + other js files as an additional librariess


var appFiles = [
  "./",
  "./index.html",
  "./reader.html",
  "./css.css",
  "./manifest.json",
  "./js/app.js",
  "./js/reader.js",
  "./js/library.js",
  "./js/ui.js",
  "./js/db.js",
  // 
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://unpkg.com/epubjs/dist/epub.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://unpkg.com/dexie/dist/dexie.mjs"

];


self.addEventListener("install", function(event) {
  self.skipWaiting();

  event.waitUntil(
    caches.open(myCache). then(function(cache)  {
      
    var i = 0;
      // loop throught and cache them one by on
      //appFiles is basically a collection that is iterated over with map() - cretiron c
      // allSettled () - if one fails it doen't crash everything
      // source:  https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
    return Promise.allSettled(
  appFiles.map(function(url) {
    return caches.add(url).catch(function(err) {
      console.warn("Could not cache:", url, err);
    }); }));
      
    }).then(function() {
       return self.skipWaiting();
    })
  ); });

// this will loop through catches and delete noncurrents + and if else to check if names match and delete those who don't
self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(allCaches) {
      return Promise.all(
        allCaches.map(function(name) {
          if (name !== myCache) {
            return caches.delete(name);
          }    })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );});



//read/write operation 
// sources: https://techielearn.com/tutorials/javascript-programming/web-performance-optimization/using-service-workers-for-caching
// and https://stackoverflow.com/questions/46607030/service-worker-fetch

self.addEventListener("fetch", function(event) {
  if (event.request.method !== "GET") return;
   if (!event.request.url.startsWith("http")) return;

  event.respondWith(
    caches.match(event.request).then(function(cachedresult) {
      if (cachedresult) {
        return cachedresult;
      }

      return fetch(event.request.clone()).then(function(response) {
       
       if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }

        //need to clone the new response into the xache for next
        var response = response.clone();

        caches.open(myCache).then(function(cache) {
          cache.put(event.request, responsecopy);
      });

        return response;
      }).catch(function(err) {
        console.warn("fetch failed for: " + event.request.url, err);
      });
    })
  ); });