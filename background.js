importScripts("book.js");

let cachedBookBuffer = null;
let cachedBookName = "";

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

async function getBookBuffer() {
  if (cachedBookBuffer) {
    return {buffer: cachedBookBuffer, name: cachedBookName};
  }

  const book = await readActiveBook();
  if (!book?.blob) return null;

  cachedBookBuffer = await book.blob.arrayBuffer();
  cachedBookName = book.name || "opening book.bin";
  return {buffer: cachedBookBuffer, name: cachedBookName};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "bookInfo") {
    readActiveBook()
      .then(book => sendResponse({
        ok: true,
        loaded: Boolean(book?.blob),
        name: book?.name || "",
        size: book?.size || 0
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
        cachedBookBuffer = null;
        cachedBookName = "";
        sendResponse({ok: true, loaded: false, name: "", size: 0});
      })
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }

  if (message?.type === "bookLookup") {
    getBookBuffer()
      .then(book => {
        if (!book) {
          sendResponse({ok: true, found: false, moves: [], name: ""});
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
          name: book.name
        });
      })
      .catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
});
