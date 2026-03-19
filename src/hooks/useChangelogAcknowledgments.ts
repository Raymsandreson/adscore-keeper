import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/AuthContext";
import { changelog } from "@/components/updates/changelogData";

export function useChangelogAcknowledgments() {
  const { user } = useAuthContext();
  const [acknowledgedVersions, setAcknowledgedVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const allVersions = changelog.map(c => c.version);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    const fetchAcks = async () => {
      const { data } = await supabase
        .from("changelog_acknowledgments")
        .select("version")
        .eq("user_id", user.id);
      
      setAcknowledgedVersions((data || []).map(d => d.version));
      setLoading(false);
    };

    fetchAcks();
  }, [user]);

  const unseenVersions = allVersions.filter(v => !acknowledgedVersions.includes(v));
  const unseenCount = unseenVersions.length;

  const acknowledge = useCallback(async (version: string) => {
    if (!user || acknowledgedVersions.includes(version)) return;

    const { error } = await supabase
      .from("changelog_acknowledgments")
      .insert({ user_id: user.id, version });

    if (!error) {
      setAcknowledgedVersions(prev => [...prev, version]);
      // Also sync localStorage for backwards compat
      localStorage.setItem('app_last_seen_version', changelog[0]?.version || version);
    }
  }, [user, acknowledgedVersions]);

  const acknowledgeAll = useCallback(async () => {
    if (!user) return;

    const toInsert = unseenVersions.map(v => ({ user_id: user.id, version: v }));
    if (toInsert.length === 0) return;

    const { error } = await supabase
      .from("changelog_acknowledgments")
      .upsert(toInsert, { onConflict: "user_id,version" });

    if (!error) {
      setAcknowledgedVersions(allVersions);
      localStorage.setItem('app_last_seen_version', changelog[0]?.version || '');
    }
  }, [user, unseenVersions, allVersions]);

  return { acknowledgedVersions, unseenCount, unseenVersions, loading, acknowledge, acknowledgeAll };
}
