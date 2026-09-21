(() => {
  const statusEl = document.querySelector("#cmh-status");
  const detailEl = document.querySelector("#cmh-detail");
  const dotEl = document.querySelector("#cmh-dot");
  const scanButton = document.querySelector("#cmh-scan");
  const alternativesButton = document.querySelector("#cmh-alternatives");
  const bookEnabledButton = document.querySelector("#cmh-book-enabled");
  const bookModeSelect = document.querySelector("#cmh-book-mode");
  const bookStatusEl = document.querySelector("#cmh-book-status");
  const bookFileInput = document.querySelector("#cmh-book-file");
  const bookClearButton = document.querySelector("#cmh-book-clear");

  let tabId = null;

  function setConnectionState(state) {
    dotEl.classList.toggle("cmh-ready", state === "ready");
    dotEl.classList.toggle("cmh-error", state === "error");
  }

  function setToggle(button, enabled) {
    button.classList.toggle("cmh-on", enabled);
    button.setAttribute("aria-pressed", String(enabled));
  }

  function setStatus(status, detail, connected = true) {
    statusEl.textContent = status;
    detailEl.textContent = detail;
    setConnectionState(connected ? "ready" : "error");
  }

  function formatBookSize(size) {
    if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + " KB";
    return (size / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function openBookDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("cmh-books", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("books", {keyPath: "id"});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Book database error"));
    });
  }

  async function saveBook(file) {
    const db = await openBookDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("books", "readwrite");
      transaction.objectStore("books").put({
        id: "active",
        name: file.name,
        size: file.size,
        blob: file
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Book save error"));
    });
  }

  async function loadBookInfo() {
    const response = await sendRuntimeMessage({type: "bookInfo"});
    if (!response?.ok) throw new Error(response?.error || "Book information failed.");

    bookModeSelect.replaceChildren();
    const randomOption = document.createElement("option");
    randomOption.value = "random";
    randomOption.textContent = response.books?.length > 1 ? "Random each analysis" : "Available book";
    bookModeSelect.appendChild(randomOption);

    for (const book of response.books || []) {
      const option = document.createElement("option");
      option.value = book.id;
      option.textContent = book.name + (book.builtin ? "" : " (uploaded)");
      bookModeSelect.appendChild(option);
    }

    if (response.loaded) {
      bookStatusEl.textContent = response.books.length + " available • " + response.name + " uploaded";
      bookClearButton.disabled = false;
    } else {
      bookStatusEl.textContent = response.books?.length
        ? response.books.length + " built-in books available"
        : "No Polyglot book loaded";
      bookClearButton.disabled = true;
    }
  }

  async function refreshState() {
    const response = await sendMessage({type: "getState"});
    if (!response?.ok) throw new Error("Chess Move Helper is not loaded yet.");

    setToggle(alternativesButton, response.showAlternatives);
    setToggle(bookEnabledButton, response.bookEnabled);
    setStatus(response.status, response.detail, true);
    bookModeSelect.value = response.bookMode || "random";
  }

  async function connect() {
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.id || !tab.url || !tab.url.startsWith("https://www.chess.com/")) {
        setStatus("Open Chess.com", "The popup controls a board on the active Chess.com tab.", false);
        scanButton.disabled = true;
        return;
      }

      tabId = tab.id;
      await loadBookInfo();
      await refreshState();
    } catch (error) {
      setStatus("Connect failed", "Refresh the Chess.com tab, then open the popup again.", false);
      detailEl.title = error.message;
    }
  }

  scanButton.addEventListener("click", async () => {
    if (tabId === null) return;
    scanButton.disabled = true;
    scanButton.textContent = "Analyzing...";

    try {
      const response = await sendMessage({type: "scan"});
      if (!response?.ok) throw new Error(response?.error || "Analysis failed.");
      setStatus(response.status, response.detail, true);
      setToggle(alternativesButton, response.showAlternatives);
      setToggle(bookEnabledButton, response.bookEnabled);
      await loadBookInfo();
    } catch (error) {
      setStatus("Scan failed", "Refresh the Chess.com tab and try again.", false);
      detailEl.title = error.message;
    } finally {
      scanButton.disabled = false;
      scanButton.textContent = "Analyze Position";
    }
  });

  alternativesButton.addEventListener("click", async () => {
    if (tabId === null) return;
    try {
      const response = await sendMessage({
        type: "setAlternatives",
        value: !alternativesButton.classList.contains("cmh-on")
      });
      if (!response?.ok) throw new Error(response?.error || "Update failed.");
      setToggle(alternativesButton, response.showAlternatives);
      setStatus(response.status, response.detail, true);
    } catch {
      setStatus("Connection lost", "Refresh the Chess.com tab, then reopen the popup.", false);
    }
  });

  bookModeSelect.addEventListener("change", async () => {
    if (tabId === null) return;
    try {
      const response = await sendMessage({
        type: "setBookMode",
        value: bookModeSelect.value
      });
      if (!response?.ok) throw new Error(response?.error || "Book selection failed.");
      setToggle(bookEnabledButton, response.bookEnabled);
      bookModeSelect.value = response.bookMode || "random";
      setStatus(response.status, response.detail, true);
    } catch {
      setStatus("Connection lost", "Refresh the Chess.com tab, then reopen the popup.", false);
    }
  });

  bookEnabledButton.addEventListener("click", async () => {
    if (tabId === null) return;
    try {
      const response = await sendMessage({
        type: "setBookEnabled",
        value: !bookEnabledButton.classList.contains("cmh-on")
      });
      if (!response?.ok) throw new Error(response?.error || "Update failed.");
      setToggle(bookEnabledButton, response.bookEnabled);
      setStatus(response.status, response.detail, true);
    } catch {
      setStatus("Connection lost", "Refresh the Chess.com tab, then reopen the popup.", false);
    }
  });

  bookFileInput.addEventListener("change", async () => {
    const file = bookFileInput.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".bin")) {
      bookFileInput.value = "";
      setStatus("Invalid book", "Choose a Polyglot .bin opening book.", false);
      return;
    }

    bookClearButton.disabled = true;
    bookStatusEl.textContent = "Loading " + file.name + "...";

    try {
      await saveBook(file);
      await sendRuntimeMessage({type: "clearBookCache"});
      if (tabId !== null) {
        await sendMessage({type: "bookChanged"});
      }
      await loadBookInfo();
      await refreshState();
      setStatus("Book loaded", file.name + " is now available for random or manual selection.", true);
    } catch (error) {
      bookStatusEl.textContent = "Book load failed";
      setStatus("Book load failed", error.message, false);
    } finally {
      bookFileInput.value = "";
    }
  });

  bookClearButton.addEventListener("click", async () => {
    bookClearButton.disabled = true;
    try {
      const response = await sendRuntimeMessage({type: "clearBook"});
      if (!response?.ok) throw new Error(response?.error || "Book clear failed.");
      if (tabId !== null) {
        await sendMessage({type: "bookChanged"});
      }
      await loadBookInfo();
      await refreshState();
      setStatus("Book cleared", "Built-in books remain available for opening positions.", true);
    } catch (error) {
      setStatus("Clear failed", error.message, false);
      bookClearButton.disabled = false;
    }
  });

  connect();
})();
