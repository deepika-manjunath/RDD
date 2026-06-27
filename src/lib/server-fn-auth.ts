// Patches the global fetch on the client to attach the current Supabase
// access token as a Bearer Authorization header for all TanStack Start
// server function requests (paths starting with /_serverFn/).
//
// This makes server functions guarded by `requireSupabaseAuth` work
// transparently from the browser without each call site needing to wire
// up auth headers manually.

import { supabase } from "@/integrations/supabase/client";

let installed = false;

export function installServerFnAuth() {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const isServerFn = url.includes("/_serverFn/");

      if (isServerFn) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has("authorization")) {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (token) headers.set("authorization", `Bearer ${token}`);
        }
        return originalFetch(input as RequestInfo, { ...init, headers });
      }
    } catch {
      // fall through to original fetch
    }
    return originalFetch(input as RequestInfo, init);
  };
}
