import type { FetchLike } from "../src/transport.js";

type Queued = Response | Error | ((url: string, init: RequestInit) => Response | Promise<Response>);

/** A JSON `Response` with the given status, body and extra headers. */
export function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fake fetch that records every call and replays the queued responses in order. */
export function makeFetch(...queued: Queued[]): {
  fetch: FetchLike;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = queued.shift();
    if (next === undefined) throw new Error("no more responses");
    if (next instanceof Response) return next;
    if (next instanceof Error) throw next;
    return await next(url, init);
  };
  return { fetch, calls };
}
