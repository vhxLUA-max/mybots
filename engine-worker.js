importScripts("engine.js");

let nextTaskId = 1;

self.onmessage = event => {
  const message = event.data || {};
  const taskId = message.taskId || nextTaskId++;

  try {
    if (message.type === "search") {
      const result = self.__CMH_ENGINE__.search(
        message.position,
        message.side,
        message.maxDepth,
        message.nodeLimit,
        message.alternativeCount,
        message.castlingRights,
        message.epSquare
      );
      self.postMessage({taskId, ok: true, result});
      return;
    }

    if (message.type === "gameState") {
      const result = self.__CMH_ENGINE__.getGameState(
        message.position,
        message.side,
        message.castlingRights,
        message.epSquare
      );
      self.postMessage({taskId, ok: true, result});
      return;
    }

    self.postMessage({taskId, ok: false, error: "Unknown engine task."});
  } catch (error) {
    self.postMessage({taskId, ok: false, error: error.message || "Engine worker error."});
  }
};
