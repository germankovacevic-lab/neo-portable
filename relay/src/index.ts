// Entry del Worker de Cloudflare. Thin wire: delega todo al handler puro.
// The real D1Database satisfies the handler's D1Like interface (prepare/bind/run/first/all).
import { handle, type Env } from "./handler.js";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
