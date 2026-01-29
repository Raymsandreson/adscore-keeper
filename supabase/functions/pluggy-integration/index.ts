import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PLUGGY_API_URL = 'https://api.pluggy.ai';

interface PluggyAuthResponse {
  apiKey: string;
}

interface PluggyAccount {
  id: string;
  name: string;
  type: string;
  number: string;
  balance: number;
  creditData?: {
    brand: string;
    creditLimit: number;
    availableCreditLimit: number;
    balanceCloseDate: string;
    balanceDueDate: string;
  };
}

interface PluggyTransaction {
  id: string;
  description: string;
  amount: number;
  date: string;
  category?: string;
  paymentData?: {
    paymentMethod?: string;
  };
  creditCardMetadata?: {
    cardNumber?: string;
    purchaseDate?: string;
    totalInstallments?: number;
    installmentNumber?: number;
  };
  merchant?: {
    name?: string;
  };
}

async function getPluggyApiKey(): Promise<string> {
  const clientId = Deno.env.get('PLUGGY_CLIENT_ID');
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('Pluggy credentials not configured');
  }

  const response = await fetch(`${PLUGGY_API_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Pluggy auth failed: ${error}`);
  }

  const data: PluggyAuthResponse = await response.json();
  return data.apiKey;
}

async function createConnectToken(apiKey: string, itemId?: string): Promise<string> {
  const body: Record<string, string | undefined> = {};
  if (itemId) {
    body.itemId = itemId;
  }

  const response = await fetch(`${PLUGGY_API_URL}/connect_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create connect token: ${error}`);
  }

  const data = await response.json();
  return data.accessToken;
}

async function getAccounts(apiKey: string, itemId: string): Promise<PluggyAccount[]> {
  const response = await fetch(`${PLUGGY_API_URL}/accounts?itemId=${itemId}`, {
    headers: { 'X-API-KEY': apiKey },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get accounts: ${error}`);
  }

  const data = await response.json();
  return data.results || [];
}

async function getTransactions(
  apiKey: string,
  accountId: string,
  from?: string,
  to?: string
): Promise<PluggyTransaction[]> {
  let url = `${PLUGGY_API_URL}/transactions?accountId=${accountId}&pageSize=500`;
  if (from) url += `&from=${from}`;
  if (to) url += `&to=${to}`;

  const response = await fetch(url, {
    headers: { 'X-API-KEY': apiKey },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get transactions: ${error}`);
  }

  const data = await response.json();
  return data.results || [];
}

async function getItem(apiKey: string, itemId: string) {
  const response = await fetch(`${PLUGGY_API_URL}/items/${itemId}`, {
    headers: { 'X-API-KEY': apiKey },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get item: ${error}`);
  }

  return await response.json();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, itemId, from, to } = await req.json();
    const apiKey = await getPluggyApiKey();

    switch (action) {
      case 'create_connect_token': {
        const connectToken = await createConnectToken(apiKey, itemId);
        return new Response(JSON.stringify({ connectToken }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save_connection': {
        console.log('save_connection called with itemId:', itemId);
        
        if (!itemId) {
          return new Response(JSON.stringify({ error: 'itemId is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const item = await getItem(apiKey, itemId);
        console.log('Pluggy item fetched:', JSON.stringify(item));
        
        const connectionData = {
          user_id: user.id,
          pluggy_item_id: itemId,
          connector_name: item.connector?.name || 'Unknown',
          connector_type: item.connector?.type || 'Unknown',
          status: item.status || 'UPDATING',
          last_sync_at: new Date().toISOString(),
        };
        console.log('Saving connection:', JSON.stringify(connectionData));
        
        const { data: upsertData, error: insertError } = await supabase
          .from('pluggy_connections')
          .upsert(connectionData, { onConflict: 'pluggy_item_id' })
          .select();

        if (insertError) {
          console.error('Error saving connection:', insertError);
          throw new Error(`Failed to save connection: ${insertError.message}`);
        }
        
        console.log('Connection saved successfully:', upsertData);

        return new Response(JSON.stringify({ success: true, connection: upsertData }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'sync_transactions': {
        console.log('sync_transactions called for user:', user.id);
        
        // Get all connections, not just UPDATED ones (status can vary)
        const { data: connections, error: connError } = await supabase
          .from('pluggy_connections')
          .select('*')
          .eq('user_id', user.id);

        console.log('Found connections:', connections?.length, 'Error:', connError);
        
        if (!connections || connections.length === 0) {
          return new Response(JSON.stringify({ transactions: [], message: 'No active connections' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        let allTransactions: any[] = [];

        for (const connection of connections) {
          const accounts = await getAccounts(apiKey, connection.pluggy_item_id);
          const creditAccounts = accounts.filter(a => a.type === 'CREDIT');

          for (const account of creditAccounts) {
            const transactions = await getTransactions(apiKey, account.id, from, to);
            
            const formattedTransactions = transactions.map(t => ({
              user_id: user.id,
              pluggy_account_id: account.id,
              pluggy_transaction_id: t.id,
              description: t.description,
              amount: t.amount,
              currency_code: 'BRL',
              transaction_date: t.date.split('T')[0],
              category: t.category || 'Outros',
              payment_data: t.paymentData || {},
              card_last_digits: t.creditCardMetadata?.cardNumber?.slice(-4) || account.number?.slice(-4),
              merchant_name: t.merchant?.name,
            }));

            if (formattedTransactions.length > 0) {
              const { error: upsertError } = await supabase
                .from('credit_card_transactions')
                .upsert(formattedTransactions, { onConflict: 'pluggy_transaction_id' });

              if (upsertError) {
                console.error('Error upserting transactions:', upsertError);
              }
            }

            allTransactions = [...allTransactions, ...formattedTransactions];
          }

          // Update last sync
          await supabase
            .from('pluggy_connections')
            .update({ last_sync_at: new Date().toISOString() })
            .eq('id', connection.id);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          count: allTransactions.length 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get_connections': {
        const { data: connections } = await supabase
          .from('pluggy_connections')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        return new Response(JSON.stringify({ connections: connections || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete_connection': {
        if (!itemId) {
          return new Response(JSON.stringify({ error: 'itemId is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Delete from Pluggy
        try {
          await fetch(`${PLUGGY_API_URL}/items/${itemId}`, {
            method: 'DELETE',
            headers: { 'X-API-KEY': apiKey },
          });
        } catch (e) {
          console.error('Error deleting from Pluggy:', e);
        }

        // Delete local data
        const { data: connection } = await supabase
          .from('pluggy_connections')
          .select('id')
          .eq('pluggy_item_id', itemId)
          .single();

        if (connection) {
          await supabase
            .from('credit_card_transactions')
            .delete()
            .eq('user_id', user.id);

          await supabase
            .from('pluggy_connections')
            .delete()
            .eq('id', connection.id);
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error: unknown) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
