

## Diagnose

I found the root cause. The current `sendMessage` logic requires **both** conditions to be true:
1. The instance's `auto_identify_sender` setting (from database)
2. The conversation's switch `identifySender` (from the UI)

But the database shows **all instances have `auto_identify_sender = false`**, including "Atendimento Processual". So even with the conversation switch ON, the sender identification never executes because `autoIdentify` is always `false`.

The user confirmed: **the conversation switch should be the only thing that matters** -- if it's ON, identify the sender regardless of the instance setting.

Additionally, the user's `treatment_title` is currently `null` in the database, so we need to ensure the Profile page has a field to set it.

## Plan

### 1. Fix `sendMessage` in `src/hooks/useWhatsAppMessages.ts`

Remove the dependency on `autoIdentify` from the instance. The logic should be:
- If `identifySender` parameter is `true` (from the chat switch), fetch profile and prepend the sender name
- Remove all the `autoIdentify` variable and related instance queries for this purpose
- Keep the instance resolution logic only for determining `targetInstanceId`

Simplified flow:
```
if (user && identifySender) {
  // fetch profile → prepend *Name:* to message
}
```

### 2. Verify Profile page has `treatment_title` field

Check `src/pages/ProfilePage.tsx` to confirm the treatment title selector exists. If not, add it so users can configure their title (Dr., Dra., Sr., Sra., etc.).

### Technical Details

**File: `src/hooks/useWhatsAppMessages.ts`** (lines 224-272)
- Remove the 3 blocks that query `auto_identify_sender` from the database
- Keep only the instance ID resolution for sending
- Change line 260 from `if (user && autoIdentify && identifySender)` to `if (user && identifySender)`

**File: `src/pages/ProfilePage.tsx`**
- Verify treatment_title field exists; add if missing

