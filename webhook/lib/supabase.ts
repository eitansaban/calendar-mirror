import { createClient } from "@supabase/supabase-js";
import { config } from "./config";

const TABLE = "calendar_mirror_state";
const ROW_ID = 1;

export type MirrorState = {
  sync_token: string | null;
  channel_id: string | null;
  resource_id: string | null;
  channel_expiration: string | null;
  last_event_at: string | null;
};

function client() {
  return createClient(config.supabaseUrl(), config.supabaseKey(), {
    auth: { persistSession: false },
  });
}

export async function getState(): Promise<MirrorState> {
  const { data, error } = await client()
    .from(TABLE)
    .select("sync_token, channel_id, resource_id, channel_expiration, last_event_at")
    .eq("id", ROW_ID)
    .single();
  if (error) throw error;
  return data as MirrorState;
}

export async function patchState(patch: Partial<MirrorState>): Promise<void> {
  const { error } = await client()
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", ROW_ID);
  if (error) throw error;
}
