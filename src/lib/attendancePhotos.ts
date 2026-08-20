import { supabase } from '@/lib/supabase';

const BUCKET = 'attendance-photos';

export async function getAttendancePhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  return error ? null : data.signedUrl;
}
