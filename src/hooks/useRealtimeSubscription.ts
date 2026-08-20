import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Subscribes to realtime changes on the given tables and calls `onUpdate`
 * whenever any of them change. Automatically cleans up on unmount.
 */
export function useRealtimeSubscription(
  channelName: string,
  tables: string[],
  onUpdate: () => void,
) {
  const callbackRef = useRef(onUpdate);
  callbackRef.current = onUpdate;

  useEffect(() => {
    let channel = supabase.channel(channelName);
    for (const table of tables) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        callbackRef.current();
      });
    }
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, tables.join(',')]);
}
