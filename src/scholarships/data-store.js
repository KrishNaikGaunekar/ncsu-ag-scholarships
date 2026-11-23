// Shared scholarship list + editor access.
//
// Two modes, picked at build time:
//
//  • Shared (Supabase) — when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are
//    set. Everyone reads the same list; editors sign in with an emailed magic
//    link and can add/update/delete. Write access is enforced in the database
//    by row-level security against the `scholarship_editors` table (see
//    supabase/schema.sql) — the UI check here is only for showing buttons.
//
//  • Local — no backend configured. Everyone sees the seed list. "Editor mode"
//    still works but saves to this browser only; editors use Export JSON and
//    commit it as src/scholarships/seed-data.js / import it once Supabase is on.

import { SEED_SCHOLARSHIPS } from './seed-data.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const SHARED_MODE = Boolean(SUPABASE_URL && SUPABASE_KEY);

const LOCAL_KEY = 'ncsuAgScholarships.localDraft.v1';
const LOCAL_EDITOR_KEY = 'ncsuAgScholarships.localEditor';

let client = null;
const listeners = new Set();

const state = {
  list: [],
  loading: true,
  error: null,
  remoteEmpty: false,
  user: null,        // { email } when signed in (shared mode)
  isEditor: false,
};

function emit() { listeners.forEach((fn) => fn()); }

async function getClient() {
  if (!SHARED_MODE) return null;
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return client;
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return structuredClone(SEED_SCHOLARSHIPS);
}

function saveLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state.list)); } catch { /* ignore */ }
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || `s-${Date.now()}`;
}

async function refreshEditor() {
  const sb = await getClient();
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user ? { email: session.user.email } : null;
  state.isEditor = false;
  if (state.user) {
    const { data } = await sb.from('scholarship_editors').select('email').ilike('email', state.user.email).maybeSingle();
    state.isEditor = Boolean(data);
  }
}

async function fetchRemote() {
  const sb = await getClient();
  const { data, error } = await sb.from('scholarships').select('id, data, updated_at, updated_by');
  if (error) throw error;
  state.remoteEmpty = data.length === 0;
  state.list = data.length
    ? data.map((r) => ({ ...r.data, id: r.id, updatedAt: r.updated_at, updatedBy: r.updated_by }))
    : structuredClone(SEED_SCHOLARSHIPS);
}

export const dataStore = {
  get state() { return state; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async init() {
    if (!SHARED_MODE) {
      state.list = loadLocal();
      state.isEditor = localStorage.getItem(LOCAL_EDITOR_KEY) === '1';
      state.loading = false;
      emit();
      return;
    }
    try {
      const sb = await getClient();
      await Promise.all([fetchRemote(), refreshEditor()]);
      sb.auth.onAuthStateChange(() => { refreshEditor().then(emit); });
      // Live updates when another editor changes something (needs the table in
      // the supabase_realtime publication — schema.sql does this).
      sb.channel('scholarships')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'scholarships' }, () => {
          fetchRemote().then(emit).catch(() => {});
        })
        .subscribe();
    } catch (e) {
      state.error = 'Could not reach the shared scholarship list — showing the built-in starter list.';
      state.list = structuredClone(SEED_SCHOLARSHIPS);
      console.error(e);
    }
    state.loading = false;
    emit();
  },

  // ---------- editor access ----------
  async signIn(email) {
    if (!SHARED_MODE) {
      localStorage.setItem(LOCAL_EDITOR_KEY, '1');
      state.isEditor = true;
      emit();
      return { ok: true, local: true };
    }
    const sb = await getClient();
    const redirect = window.location.href.split('#')[0];
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  },

  async signOut() {
    if (!SHARED_MODE) {
      localStorage.removeItem(LOCAL_EDITOR_KEY);
      state.isEditor = false;
      emit();
      return;
    }
    const sb = await getClient();
    await sb.auth.signOut();
    state.user = null;
    state.isEditor = false;
    emit();
  },

  // ---------- writes ----------
  async save(s) {
    const record = { ...s };
    delete record.updatedAt; delete record.updatedBy;
    if (!record.id) record.id = uniqueId(slugify(record.name));
    const now = new Date().toISOString();

    if (SHARED_MODE) {
      const sb = await getClient();
      const { error } = await sb.from('scholarships').upsert({
        id: record.id, data: record, updated_at: now, updated_by: state.user?.email || null,
      });
      if (error) throw new Error(error.message);
    }
    const next = { ...record, updatedAt: now, updatedBy: state.user?.email || 'local draft' };
    const i = state.list.findIndex((x) => x.id === record.id);
    if (i >= 0) state.list[i] = next; else state.list.push(next);
    if (!SHARED_MODE) saveLocal();
    emit();
    return next;
  },

  async remove(id) {
    if (SHARED_MODE) {
      const sb = await getClient();
      const { error } = await sb.from('scholarships').delete().eq('id', id);
      if (error) throw new Error(error.message);
    }
    state.list = state.list.filter((x) => x.id !== id);
    if (!SHARED_MODE) saveLocal();
    emit();
  },

  /** Push the whole list (e.g. the starter list or an imported JSON) to the shared DB. */
  async publishAll(list) {
    if (SHARED_MODE) {
      const sb = await getClient();
      const now = new Date().toISOString();
      const rows = list.map((s) => {
        const data = { ...s }; delete data.updatedAt; delete data.updatedBy;
        return { id: s.id || uniqueId(slugify(s.name)), data, updated_at: now, updated_by: state.user?.email || null };
      });
      const { error } = await sb.from('scholarships').upsert(rows);
      if (error) throw new Error(error.message);
      await fetchRemote();
    } else {
      state.list = structuredClone(list);
      saveLocal();
    }
    emit();
  },

  resetLocalDraft() {
    localStorage.removeItem(LOCAL_KEY);
    state.list = structuredClone(SEED_SCHOLARSHIPS);
    emit();
  },
};

function uniqueId(base) {
  let id = base;
  let n = 2;
  while (state.list.some((x) => x.id === id)) id = `${base}-${n++}`;
  return id;
}
