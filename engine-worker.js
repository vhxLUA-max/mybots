let nextTaskId = 1;

self.onmessage = async event => {
  const message = event.data || {};
  const taskId = message.taskId || nextTaskId++;

  try {
    if (message.type === "maiaSearch") {
      if (!self.__CMH_MAIA__) importScripts("maia3/maia3-engine.js");
      const result = await self.__CMH_MAIA__.search(
        message.position,
        message.side,
        message.alternativeCount,
        message.castlingRights,
        message.epSquare,
        message.selfElo,
        message.oppoElo
      );
      self.postMessage({taskId, ok: true, result});
      return;
    }

    self.postMessage({taskId, ok: false, error: "Unknown Maia task."});
  } catch (error) {
    self.postMessage({taskId, ok: false, error: error.message || "Maia worker error."});
  }
};
