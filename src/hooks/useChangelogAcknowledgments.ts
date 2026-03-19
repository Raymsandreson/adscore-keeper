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

  const latestVersion = changelog[0]?.version;

  // All features across all versions (used for display helpers)
  const allFeatures: AckRecord[] = changelog.flatMap((entry) =>
    entry.features.map((f) => ({ version: entry.version, feature_title: f.title })),
  );

  // Only latest-version features should block the update indicator
  const latestFeatures: AckRecord[] = changelog[0]
    ? changelog[0].features.map((f) => ({ version: changelog[0].version, feature_title: f.title }))
    : [];

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchAcks = async () => {
      const { data } = await supabase
        .from("changelog_acknowledgments")
        .select("version, feature_title")
        .eq("user_id", user.id);

      setAcknowledged((data || []).map((d) => ({ version: d.version, feature_title: d.feature_title })));
      setLoading(false);
    };

    fetchAcks();
  }, [user]);

  const isFeatureAcked = useCallback(
    (version: string, featureTitle: string) => {
      // Legacy versions are considered acknowledged to avoid old backlog blocking the badge
      if (latestVersion && version !== latestVersion) return true;
      return acknowledged.some((a) => a.version === version && a.feature_title === featureTitle);
    },
    [acknowledged, latestVersion],
  );

  const unseenCount = latestFeatures.filter((f) => !isFeatureAcked(f.version, f.feature_title)).length;

  const acknowledgeFeature = useCallback(
    async (version: string, featureTitle: string) => {
      if (!user || isFeatureAcked(version, featureTitle)) return;

      const { error } = await supabase
        .from("changelog_acknowledgments")
        .insert({ user_id: user.id, version, feature_title: featureTitle });

      if (!error) {
        setAcknowledged((prev) => [...prev, { version, feature_title: featureTitle }]);
      }
    },
    [user, isFeatureAcked],
  );

  const acknowledgeAll = useCallback(async () => {
    if (!user) return;

    const unseen = latestFeatures.filter((f) => !isFeatureAcked(f.version, f.feature_title));
    if (unseen.length === 0) return;

    const toInsert = unseen.map((f) => ({ user_id: user.id, version: f.version, feature_title: f.feature_title }));

    const { error } = await supabase
      .from("changelog_acknowledgments")
      .upsert(toInsert, { onConflict: "user_id,version,feature_title" });

    if (!error) {
      setAcknowledged((prev) => {
        const merged = [...prev];
        unseen.forEach((item) => {
          if (!merged.some((m) => m.version === item.version && m.feature_title === item.feature_title)) {
            merged.push(item);
          }
        });
        return merged;
      });
    }
  }, [user, latestFeatures, isFeatureAcked]);

  return { acknowledged, unseenCount, loading, isFeatureAcked, acknowledgeFeature, acknowledgeAll, allFeatures };
}
