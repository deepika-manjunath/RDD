import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

export const requireSupabaseAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      throw new Response('Missing Supabase environment variables.', { status: 500 });
    }

    const request = getRequest();
    if (!request?.headers) {
      throw new Response('Unauthorized: No request headers available', { status: 401 });
    }

    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new Response('Unauthorized', { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');

    // Validate token and get user
    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      throw new Response('Unauthorized: Invalid token', { status: 401 });
    }

    // Create a new client with the token in global headers so RLS works
    const authedSupabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    return next({
      context: { supabase: authedSupabase, userId: user.id, claims: user },
    });
  }
);