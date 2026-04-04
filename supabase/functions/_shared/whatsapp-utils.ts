/**
 * WhatsApp messaging utilities: send text, media, split messages.
 */

// ============================================================
// SEND TEXT MESSAGE
// ============================================================

export async function sendWhatsApp(
  supabase: any,
  inst: any,
  phone: string,
  instanceName: string,
  text: string,
  contactId?: string,
  leadId?: string,
  msgIdPrefix = "wjia",
  options?: {
    splitMessages?: boolean;
    splitDelaySeconds?: number;
    cloudClient?: any;
  },
) {
  if (!inst?.instance_token) return;
  const baseUrl = inst.base_url || "https://abraci.uazapi.com";

  const shouldSplit = options?.splitMessages === true;
  const splitDelay = (options?.splitDelaySeconds || 3) * 1000;

  // Split message into parts at double-newline boundaries
  let parts: string[] = [text];
  if (shouldSplit && text.includes("\n\n")) {
    const rawParts = text.split(/\n\n+/).filter((p) => p.trim());
    if (rawParts.length > 1) {
      parts = [];
      let buf = "";
      for (const p of rawParts) {
        if (buf && (buf.length + p.length) > 300) {
          parts.push(buf.trim());
          buf = p;
        } else {
          buf = buf ? buf + "\n\n" + p : p;
        }
      }
      if (buf.trim()) parts.push(buf.trim());
    }
  }

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, splitDelay));
    await fetch(`${baseUrl}/send/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: inst.instance_token,
      },
      body: JSON.stringify({ number: phone, text: parts[i] }),
    }).catch((e) => console.error("Send error:", e));
    const msgRow = {
      phone,
      instance_name: instanceName,
      message_text: parts[i],
      message_type: "text",
      direction: "outbound",
      contact_id: contactId || null,
      lead_id: leadId || null,
      external_message_id: `${msgIdPrefix}_${Date.now()}_${i}`,
      action_source: "system",
      action_source_detail: "WJIA Agent (comando)",
    };
    await supabase.from("whatsapp_messages").insert(msgRow);
    if (options?.cloudClient) {
      await options.cloudClient.from("whatsapp_messages").insert(msgRow).catch((
        e: any,
      ) => console.error("Cloud mirror error:", e));
    }
  }
}
