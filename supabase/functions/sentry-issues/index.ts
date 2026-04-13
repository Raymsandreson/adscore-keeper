import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SENTRY_ORG = "prudencio-advogados";
const SENTRY_PROJECT = "javascript-react";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SENTRY_AUTH_TOKEN = Deno.env.get("SENTRY_AUTH_TOKEN");
    if (!SENTRY_AUTH_TOKEN) {
      return new Response(JSON.stringify({ error: "SENTRY_AUTH_TOKEN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint") || "issues";
    const query = url.searchParams.get("query") || "is:unresolved";
    const cursor = url.searchParams.get("cursor") || "";
    const statsPeriod = url.searchParams.get("statsPeriod") || "24h";

    let sentryUrl = "";

    if (endpoint === "issues") {
      sentryUrl = `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=${encodeURIComponent(query)}&statsPeriod=${statsPeriod}&sort=date${cursor ? `&cursor=${cursor}` : ""}`;
    } else if (endpoint === "events") {
      const issueId = url.searchParams.get("issueId");
      if (!issueId) {
        return new Response(JSON.stringify({ error: "issueId required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      sentryUrl = `https://sentry.io/api/0/issues/${issueId}/events/`;
    } else if (endpoint === "stats") {
      sentryUrl = `https://sentry.io/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/stats/?stat=received&resolution=1h&statsPeriod=${statsPeriod}`;
    }

    const response = await fetch(sentryUrl, {
      headers: {
        Authorization: `Bearer ${SENTRY_AUTH_TOKEN}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Sentry API error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Sentry API error", status: response.status, details: errorText }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sentry-issues error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
