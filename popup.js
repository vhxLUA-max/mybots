(() => {
  const statusEl = document.querySelector("#cmh-status");
  const detailEl = document.querySelector("#cmh-detail");
  const dotEl = document.querySelector("#cmh-dot");
  const scanButton = document.querySelector("#cmh-scan");
  const alternativesButton = document.querySelector("#cmh-alternatives");
  const hiddenButton = document.querySelector("#cmh-hidden");

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

  async function connect() {
    try {
      const tab = await getActiveTab();
      if (!tab || !tab.id || !tab.url || !tab.url.startsWith("https://www.chess.com/")) {
        setStatus("Open Chess.com", "The popup controls a board on the active Chess.com tab.", false);
        scanButton.disabled = true;
        return;
      }

      tabId = tab.id;
      const response = await sendMessage({ type: "getState" });
      if (!response?.ok) throw new Error("Chess Move Helper is not loaded yet.");

      setToggle(alternativesButton, response.showAlternatives);
      setToggle(hiddenButton, response.hidden);
      setStatus(response.status, response.detail, true);
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
      const response = await sendMessage({ type: "scan" });
      if (!response?.ok) throw new Error(response?.error || "Analysis failed.");
      setStatus(response.status, response.detail, true);
      setToggle(alternativesButton, response.showAlternatives);
      setToggle(hiddenButton, response.hidden);
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

  hiddenButton.addEventListener("click", async () => {
    if (tabId === null) return;
    try {
      const response = await sendMessage({
        type: "setHidden",
        value: !hiddenButton.classList.contains("cmh-on")
      });
      if (!response?.ok) throw new Error(response?.error || "Update failed.");
      setToggle(hiddenButton, response.hidden);
      setStatus(response.status, response.detail, true);
    } catch {
      setStatus("Connection lost", "Refresh the Chess.com tab, then reopen the popup.", false);
    }
  });

  connect();
})();
