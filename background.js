importScripts("book.js");

const BUILTIN_BOOKS = [
  {id: "builtin:titans", name: "Titans", path: "books/titans.bin", size: 1938560},
  {id: "builtin:rodent", name: "Rodent", path: "books/rodent.bin", size: 2805680}
];

let cachedBooks = new Map();
let cachedBookSources = null;
let bookLookupCache = new Map();
const BOOK_LOOKUP_CACHE_MAX = 512;
let lastRandomBookId = "";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cmh-books", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("books", {keyPath: "id"});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Book database error"));
  });
}

async function readActiveBook() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("books", "readonly");
    const request = transaction.objectStore("books").get("active");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Book read error"));
  });
}

async function getBookSource(sourceId) {
  if (cachedBooks.has(sourceId)) return cachedBooks.get(sourceId);

  const builtin = BUILTIN_BOOKS.find(book => book.id === sourceId);
  if (builtin) {
    const response = await fetch(chrome.runtime.getURL(builtin.path));
    if (!response.ok) throw new Error("Failed to load " + builtin.name + " book");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 16 || buffer.byteLength % 16 !== 0) {
      throw new Error("Invalid " + builtin.name + " Polyglot book");
    }

    const source = {id: builtin.id, name: builtin.name, size: buffer.byteLength, buffer};
    cachedBooks.set(sourceId, source);
    return source;
  }

  if (sourceId === "custom") {
    const book = await readActiveBook();
    if (!book?.blob) return null;

    const buffer = await book.blob.arrayBuffer();
    if (buffer.byteLength < 16 || buffer.byteLength % 16 !== 0) {
      throw new Error("Invalid custom Polyglot book");
    }

    const source = {id: "custom", name: book.name || "opening book.bin", size: buffer.byteLength, buffer};
    cachedBooks.set(sourceId, source);
    return source;
  }

  return null;
}

async function getBookSources() {
  if (cachedBookSources) return cachedBookSources;

  const sources = BUILTIN_BOOKS.map(book => ({
    id: book.id,
    name: book.name,
    size: book.size,
    builtin: true
  }));

  const custom = await readActiveBook();
  if (custom?.blob) {
    sources.push({
      id: "custom",
      name: custom.name || "opening book.bin",
      size: custom.size || 0,
      builtin: false
    });
  }

  cachedBookSources = sources;
  return cachedBookSources;
}

function clearBookCaches() {
  cachedBooks.clear();
  cachedBookSources = null;
  bookLookupCache.clear();
}

function bookLookupCacheKey(sourceId, position, side, castlingRights, epFile) {
  const hash = CMH_BOOK.hash(position, side, castlingRights, epFile)
    .toString(16)
    .padStart(16, "0");
  return sourceId + "|" + hash + "|" + castlingRights + "|" + (epFile ?? -1) + "|" + side;
}

function getCachedBookMoves(key) {
  const entry = bookLookupCache.get(key);
  if (!entry) return null;
  bookLookupCache.delete(key);
  bookLookupCache.set(key, entry);
  return entry.map(move => ({...move}));
}

function cacheBookMoves(key, moves) {
  bookLookupCache.delete(key);
  bookLookupCache.set(key, moves.map(move => ({...move})));
  while (bookLookupCache.size > BOOK_LOOKUP_CACHE_MAX) {
    bookLookupCache.delete(bookLookupCache.keys().next().value);
  }
}

function chooseRandomBookOrder(sources) {
  const remaining = sources.slice();
  const order = [];

  while (remaining.length) {
    const candidates = order.length
      ? remaining
      : remaining.filter(source => source.id !== lastRandomBookId);
    const pool = candidates.length ? candidates : remaining;
    const index = Math.floor(Math.random() * pool.length);
    const selected = pool[index];
    order.push(selected);
    remaining.splice(remaining.indexOf(selected), 1);
  }

  lastRandomBookId = order[0]?.id || "";
  return order;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "engineTask") {
    const task = message.task;
    const payload = message.payload || {};

    if (task !== "maiaSearch") {
      sendResponse({ok: false, error: "Unknown Maia task."});
      return;
    }

    try {
      if (!globalThis.__CMH_MAIA__) importScripts("maia3/maia3-engine.js");
      globalThis.__CMH_MAIA__.search(
        payload.position,
        payload.side,
        payload.alternativeCount,
        payload.castlingRights,
        payload.epSquare,
        payload.selfElo,
        payload.oppoElo
      ).then(result => {
        sendResponse({ok: true, result});
      }).catch(error => {
        sendResponse({ok: false, error: error.message || "Maia engine service worker error."});
      });
    } catch (error) {
      sendResponse({ok: false, error: error.message || "Maia engine service worker error."});
    }
    return true;
  }

  if (message?.type === "clearBookCache") {
    clearBookCaches();
    sendResponse({ok: true});
    return;
  }

  if (message?.type === "bookInfo") {
    getBookSources()
      .then(books => sendResponse({
        ok: true,
        loaded: books.length > 0,
        name: books.find(book => book.id === "custom")?.name || "",
        size: books.find(book => book.id === "custom")?.size || 0,
        books
      }))
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }

  if (message?.type === "clearBook") {
    openDb()
      .then(db => new Promise((resolve, reject) => {
        const transaction = db.transaction("books", "readwrite");
        transaction.objectStore("books").delete("active");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Book delete error"));
      }))
      .then(() => {
        clearBookCaches();
        sendResponse({ok: true, loaded: false, name: "", size: 0});
      })
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }

  if (message?.type === "bookLookup") {
    getBookSources()
      .then(async sources => {
        if (!sources.length) {
          sendResponse({ok: true, found: false, moves: [], name: "", sourceId: ""});
          return;
        }

        const selected = sources.find(book => book.id === message.bookMode);
        const order = selected ? [selected] : chooseRandomBookOrder(sources);
        let lastError = null;

        for (const source of order) {
          try {
            const book = await getBookSource(source.id);
            if (!book) continue;

            const castlingRights = message.castlingRights || 0;
            const epFile = message.epFile ?? null;
            const cacheKey = bookLookupCacheKey(
              source.id,
              message.position,
              message.side,
              castlingRights,
              epFile
            );
            const cachedMoves = getCachedBookMoves(cacheKey);
            const moves = cachedMoves || CMH_BOOK.lookup(
              book.buffer,
              message.position,
              message.side,
              castlingRights,
              epFile,
              8
            );

            cacheBookMoves(cacheKey, moves);

            if (moves.length) {
              sendResponse({
                ok: true,
                found: true,
                moves,
                name: book.name,
                sourceId: book.id
              });
              return;
            }
          } catch (error) {
            lastError = error;
          }
        }

        if (lastError && !selected) throw lastError;
        sendResponse({ok: true, found: false, moves: [], name: "", sourceId: ""});
      })
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
});
