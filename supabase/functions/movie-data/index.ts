import { createHandler } from "./handler.js";
Deno.serve(createHandler({ env: (name) => Deno.env.get(name), fetch: globalThis.fetch }));
