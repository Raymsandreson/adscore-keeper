import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/AuthContext";
import { changelog } from "@/components/updates/changelogData";

interface AckRecord {
  version: string;
  feature_title: string;
}

export function useChangelogAcknowledgments() {
  const { user } = useAuthContext();
  const [acknowledged, setAcknowledged] = useState<AckRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // All features across all versions
  const allFeatures: AckRecord[] = changelog.flatMap(entry =>
    entry.features.map(f => ({ version: entry.version, feature_title: f.title }))
  );

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    const fetchAcks = async () => {
      const { data } = await supabase
        .from("changelog_acknowledgments")
        .select("version, feature_title")
        .eq("user_id", user.id);

      setAcknowledged((data || []).map(d => ({ version: d.version, feature_title: d.feature_title })));
      setLoading(false);
    };

    fetchAcks();
  }, [user]);

  const isFeatureAcked = useCallback((version: string, featureTitle: string) => {
    return acknowledged.some(a => a.version === version && a.feature_title === featureTitle);
  }, [acknowledged]);

  const unseenCount = allFeatures.filter(f => !isFeatureAcked(f.version, f.feature_title)).length;

  const acknowledgeFeature = useCallback(async (version: string, featureTitle: string) => {
    if (!user || isFeatureAcked(version, featureTitle)) return;

    const { error } = await supabase
      .from("changelog_acknowledgments")
      .insert({ user_id: user.id, version, feature_title: featureTitle });

    if (!error) {
      setAcknowledged(prev => [...prev, { version, feature_title: featureTitle }]);
    }
  }, [user, isFeatureAcked]);

  const acknowledgeAll = useCallback(async () => {
    if (!user) return;

    const unseen = allFeatures.filter(f => !isFeatureAcked(f.version, f.feature_title));
    if (unseen.length === 0) return;

    const toInsert = unseen.map(f => ({ user_id: user.id, version: f.version, feature_title: f.feature_title }));

    const { error } = await supabase
      .from("changelog_acknowledgments")
      .upsert(toInsert, { onConflict: "user_id,version,feature_title" });

    if (!error) {
      setAcknowledged(allFeatures);
    }
  }, [user, allFeatures, isFeatureAcked]);

  return { acknowledged, unseenCount, loading, isFeatureAcked, acknowledgeFeature, acknowledgeAll };
}
