import { CommandFailureError, failureFromResponse } from "./command-failure";

export interface ParsedSseEvent { event: string; data: unknown }

export async function* readSse(response: Response, signal?: AbortSignal): AsyncGenerator<ParsedSseEvent> {
  if (!response.ok) {
    const failure = await failureFromResponse(response, `HTTP ${response.status}`);
    throw new CommandFailureError(failure.message, failure);
  }
  if (!response.body) throw new Error("Streaming response has no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        let event = "message";
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
        }
        if (data.length) {
          const joined = data.join("\n");
          let parsed: unknown = joined;
          try { parsed = JSON.parse(joined); } catch { /* retain text payload */ }
          yield { event, data: parsed };
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
