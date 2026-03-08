if (!Cache.prototype.add) {
  Cache.prototype.add = function add(request) {
    return this.addAll([request]);
  };
}

if (!Cache.prototype.addAll) {
  Cache.prototype.addAll = function addAll(requests) {
    var cache = this;

    function CacheError(message) {
      this.name = 'CacheError';
      this.code = 19;
      this.message = message;
    }


    CacheError.prototype = Object.create(Error.prototype);

    return Promise.resolve().then(function() {
      if (arguments.length < 1) throw new TypeError();

      requests = requests.map(function(request) {
        if (request instanceof Request) {
          return request;
        } else {
          return String(request);
        }
      });

      return Promise.all(
        requests.map(function(request) {
          if (typeof request === 'string') {
            request = new Request(request);
          }

          var scheme = new URL(request.url).protocol;

          if (scheme !== 'http:' && scheme !== 'https:') {
            throw new CacheError("Invalid scheme");
          }

          return fetch(request.clone());
        })
      );
    }).then(function(responses) {
      // test if respones overwrite each other here
      // not sure this is fully fixable with opaque responses but ;eaving it for now 
      return Promise.all(
        responses.map(function(response, i) {
          return cache.put(requests[i], response);
        })
      );
    }).then(function() {
      return undefined;
    });
  };
}

if (!CacheStorage.prototype.match) {
  CacheStorage.prototype.match = function match(request, opts) {
    var caches = this;

    return this.keys().then(function(myCaches) {
      var match;

      return myCaches.reduce(function(chain, myCache) {
        return chain.then(function() {
          return match || caches.open(myCache).then(function(cache) {
            return cache.match(request, opts);
          }).then(function(response) {
            match = response;
            return match;
          });
        });
      }, Promise.resolve());
    });
  };
}

var myCache = "library-app-cache";
var cacheReady = false; //to track if caching os finished (still working on)

// complexity - array with all the file's paths so it works offline + other js files as an additional libraries
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
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://unpkg.com/epubjs/dist/epub.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(myCache).then(function(cache) {
      
      var i = 0;
      // loop throught and cache them one by on
      // appFiles is basically a collection that is iterated over with map() - cretiron c
      // allSettled --> if one fails it doen't break the rest
      return Promise.allSettled(
        appFiles.map(function(url) {
          i++;
          return cache.add(url).catch(function(err) {
            console.warn("couldnt cache file " + i + ": " + url, err);
          });
        })
      );
      
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// this will loop through catches and delete noncurrents + and if else to check if names match and delete those who don't
self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(allCaches) {
      return Promise.all(
        allCaches.map(function(name) {
          if (name !== myCache) {
            return caches.delete(name);
          }
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// read/write operation 
// sources: https://techielearn.com/tutorials/javascript-programming/web-performance-optimization/using-service-workers-for-caching
// and https://stackoverflow.com/questions/46607030/service-worker-fetch

self.addEventListener("fetch", function(event) {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith("http")) return;

  event.respondWith(
    caches.match(event.request).then(function(cachedresult) {
      if (cached) {
        return cacheresult;
      }

      return fetch(event.request.clone()).then(function(response) {
        // todo filter out non-successful responses before caching
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }

        // need to clone the new response into the xache for next
        var responsecopy = response.clone();

        caches.open(myCache).then(function(cache) {
          cache.put(event.request, responsecopy);
        });

        return response;
      }).catch(function(err) {
        console.warn("fetch failed for: " + event.request.url, err);
      });
    })
  );
});