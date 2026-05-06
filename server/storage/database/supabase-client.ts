// Supabase client singleton
interface SupabaseClient {
  auth: {
    signUp: (options: { email: string; password: string }) => Promise<{ data: { user?: { id: string; email?: string }; session?: { access_token: string } }; error?: { message: string } }>;
    signInWithPassword: (options: { email: string; password: string }) => Promise<{ data: { user?: { id: string; email?: string }; session?: { access_token: string } }; error?: { message: string } }>;
    signOut: () => Promise<{ error?: { message: string } }>;
    getSession: () => Promise<{ data: { session: { access_token: string; user: { id: string; email?: string } } | null }; error?: { message: string } }>;
  };
  from: (table: string) => {
    select: (columns?: string) => { eq: (col: string, val: unknown) => Promise<{ data: unknown; error?: { message: string } }>; data?: unknown };
    insert: (data: unknown) => Promise<{ error?: { message: string } }>;
    upsert: (data: unknown) => Promise<{ error?: { message: string } }>;
    delete: () => { eq: (col: string, val: unknown) => Promise<{ error?: { message: string } }> };
    update: (data: unknown) => { eq: (col: string, val: unknown) => Promise<{ error?: { message: string } }> };
  };
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!client) {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || 'placeholder-key';
    
    // 使用全局 fetch API
    client = createSupabaseClient(supabaseUrl, supabaseKey);
  }
  return client;
}

function createSupabaseClient(url: string, key: string): SupabaseClient {
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json'
  };

  return {
    auth: {
      signUp: async ({ email, password }) => {
        const res = await fetch(`${url}/auth/v1/signup`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        return { data, error: data.error };
      },
      signInWithPassword: async ({ email, password }) => {
        const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.error) return { data: {}, error: data.error };
        return {
          data: {
            user: { id: data.user_id, email },
            session: { access_token: data.access_token }
          }
        };
      },
      signOut: async () => {
        const res = await fetch(`${url}/auth/v1/logout`, {
          method: 'POST',
          headers
        });
        const data = await res.json();
        return { error: data.error };
      },
      getSession: async () => {
        const res = await fetch(`${url}/auth/v1/session`, { headers });
        const data = await res.json();
        if (data.error) return { data: { session: null }, error: data.error };
        return { data: { session: data } };
      }
    },
    from: (table: string) => ({
      select: (columns = '*') => ({
        eq: async (col: string, val: unknown) => {
          const res = await fetch(`${url}/rest/v1/${table}?${col}=eq.${val}&select=${columns}`, { headers });
          const data = await res.json();
          return { data, error: data.error };
        },
        data: undefined as unknown
      }),
      insert: async (data: unknown) => {
        const res = await fetch(`${url}/rest/v1/${table}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(data)
        });
        const result = await res.json();
        return { error: result.error };
      },
      upsert: async (data: unknown) => {
        const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        return { error: result.error };
      },
      delete: () => ({
        eq: async (col: string, val: unknown) => {
          const res = await fetch(`${url}/rest/v1/${table}?${col}=eq.${val}`, {
            method: 'DELETE',
            headers
          });
          const result = await res.json();
          return { error: result.error };
        }
      }),
      update: (data: unknown) => ({
        eq: async (col: string, val: unknown) => {
          const res = await fetch(`${url}/rest/v1/${table}?${col}=eq.${val}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify(data)
          });
          const result = await res.json();
          return { error: result.error };
        }
      })
    })
  };
}
