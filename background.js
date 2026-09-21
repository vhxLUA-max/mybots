importScripts("book.js");

const BUILTIN_BOOKS = [
  {id: "builtin:titans", name: "Titans", path: "books/titans.bin", size: 1938560},
  {id: "builtin:rodent", name: "Rodent", path: "books/rodent.bin", size: 2805680}
];

let cachedBooks = new Map();
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

  return sources;
}

function chooseRandomBook(sources) {
  if (sources.length === 1) {
    lastRandomBookId = sources[0].id;
    return sources[0];
  }

  const candidates = sources.filter(source => source.id !== lastRandomBookId);
  const selected = candidates[Math.floor(Math.random() * candidates.length)] || sources[0];
  lastRandomBookId = selected.id;
  return selected;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "clearBookCache") {
    cachedBooks.delete("custom");
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
        cachedBooks.delete("custom");
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

        let source = sources.find(book => book.id === message.bookMode);
        if (!source) source = chooseRandomBook(sources);

        const book = await getBookSource(source.id);
        if (!book) {
          sendResponse({ok: true, found: false, moves: [], name: "", sourceId: source.id});
          return;
        }

        const moves = CMH_BOOK.lookup(
          book.buffer,
          message.position,
          message.side,
          message.castlingRights || 0,
          null,
          8
        );

        sendResponse({
          ok: true,
          found: moves.length > 0,
          moves,
          name: book.name,
          sourceId: book.id
        });
      })
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
});
