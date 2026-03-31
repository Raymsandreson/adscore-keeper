import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


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
    cnpj?: string;
    city?: string;
    state?: string;
    businessName?: string;
  };
}

// Lookup CNPJ to get city and state from BrasilAPI
async function lookupCNPJLocation(cnpj: string): Promise<{ city: string | null; state: string | null }> {
  try {
    const cleanCnpj = cnpj.replace(/\D/g, '');
    if (cleanCnpj.length !== 14) return { city: null, state: null };
    
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`, {
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      console.log(`CNPJ lookup failed for ${cleanCnpj}: ${response.status}`);
      return { city: null, state: null };
    }
    
    const data = await response.json();
    return {
      city: data.municipio || null,
      state: data.uf || null,
    };
  } catch (error) {
    console.error(`Error looking up CNPJ ${cnpj}:`, error);
    return { city: null, state: null };
  }
}

async function getPluggyApiKey(): Promise<string> {
  const clientId = Deno.env.get('PLUGGY_CLIENT_ID');
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');

  console.log('Pluggy auth - clientId present:', !!clientId);
  console.log('Pluggy auth - clientSecret present:', !!clientSecret);

  if (!clientId || !clientSecret) {
    throw new Error('Pluggy credentials not configured');
  }

  const response = await fetch(`${PLUGGY_API_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  const responseText = await response.text();
  console.log('Pluggy auth response status:', response.status);
  console.log('Pluggy auth response:', responseText.substring(0, 200));

  if (!response.ok) {
    throw new Error(`Pluggy auth failed: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  // Pluggy API returns 'apiKey' field
  const apiKey = data.apiKey || data.accessToken || data.access_token;
  
  if (!apiKey) {
    console.log('Full response data:', JSON.stringify(data));
    throw new Error('No API key found in Pluggy auth response');
  }
  
  console.log('Got API key, length:', apiKey.length);
  return apiKey;
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
  const allTransactions: PluggyTransaction[] = [];
  let page = 1;
  let hasMore = true;
  const pageSize = 500;

  while (hasMore) {
    let url = `${PLUGGY_API_URL}/transactions?accountId=${accountId}&pageSize=${pageSize}&page=${page}`;
    if (from) url += `&from=${from}`;
    if (to) url += `&to=${to}`;

    console.log(`Fetching transactions page ${page} for account ${accountId}...`);

    const response = await fetch(url, {
      headers: { 'X-API-KEY': apiKey },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get transactions: ${error}`);
    }

    const data = await response.json();
    const results = data.results || [];
    allTransactions.push(...results);

    console.log(`Page ${page}: fetched ${results.length} transactions (total: ${allTransactions.length})`);

    // Check if there are more pages
    // Pluggy returns total and totalPages in the response
    const totalPages = data.totalPages || 1;
    hasMore = page < totalPages;
    page++;

    // Safety limit to prevent infinite loops
    if (page > 100) {
      console.warn('Reached page limit (100), stopping pagination');
      break;
    }
  }

  console.log(`Total transactions fetched for account ${accountId}: ${allTransactions.length}`);
  return allTransactions;
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

async function updateItem(apiKey: string, itemId: string): Promise<void> {
  console.log(`Triggering Pluggy item update for ${itemId}...`);
  try {
    const response = await fetch(`${PLUGGY_API_URL}/items/${itemId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': apiKey,
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const error = await response.text();
      console.warn(`Item update request failed for ${itemId}: ${error}`);
      // Don't throw - we still want to sync cached data even if update fails
      return;
    }

    const item = await response.json();
    console.log(`Item ${itemId} update triggered, status: ${item.status}, executionStatus: ${item.executionStatus}`);

    // Wait for the item to finish updating (poll with timeout)
    const maxWaitMs = 60000; // 60 seconds max
    const pollIntervalMs = 3000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const checkResponse = await fetch(`${PLUGGY_API_URL}/items/${itemId}`, {
        headers: { 'X-API-KEY': apiKey },
      });

      if (checkResponse.ok) {
        const checkItem = await checkResponse.json();
        const execStatus = checkItem.executionStatus;
        console.log(`Item ${itemId} poll - executionStatus: ${execStatus}`);

        if (execStatus === 'SUCCESS' || execStatus === 'PARTIAL_SUCCESS') {
          console.log(`Item ${itemId} updated successfully`);
          return;
        }
        if (execStatus === 'ERROR') {
          console.warn(`Item ${itemId} update finished with error`);
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    console.warn(`Item ${itemId} update timed out after ${maxWaitMs}ms, proceeding with existing data`);
  } catch (err) {
    console.warn(`Error updating item ${itemId}:`, err);
    // Don't throw - proceed with sync using cached data
  }
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
      RESOLVED_SUPABASE_URL,
      RESOLVED_ANON_KEY,
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

        let totalCount = 0;
        const BATCH_SIZE = 100; // Process in smaller batches to avoid CPU timeout

        for (const connection of connections) {
          // Trigger Pluggy to refresh data from the bank before fetching
          await updateItem(apiKey, connection.pluggy_item_id);
          const accounts = await getAccounts(apiKey, connection.pluggy_item_id);
          
          // === CREDIT CARD TRANSACTIONS ===
          const creditAccounts = accounts.filter(a => a.type === 'CREDIT');
          for (const account of creditAccounts) {
            const transactions = await getTransactions(apiKey, account.id, from, to);
            console.log(`Credit Account ${account.id}: ${transactions.length} transactions to process`);

            for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
              const batch = transactions.slice(i, i + BATCH_SIZE);
              const formattedBatch = batch.map(t => {
                const city = t.merchant?.city || null;
                const state = t.merchant?.state || null;
                const cnpj = t.merchant?.cnpj || null;
                const installmentNumber = t.creditCardMetadata?.installmentNumber || null;
                const totalInstallments = t.creditCardMetadata?.totalInstallments || null;
                const originalPurchaseDate = t.creditCardMetadata?.purchaseDate 
                  ? t.creditCardMetadata.purchaseDate.split('T')[0] 
                  : null;
                let transactionTime = null;
                if (t.date && t.date.includes('T')) {
                  const timePart = t.date.split('T')[1];
                  if (timePart) transactionTime = timePart.split('.')[0];
                }
                return {
                  user_id: user.id,
                  pluggy_account_id: account.id,
                  pluggy_transaction_id: t.id,
                  pluggy_item_id: connection.pluggy_item_id,
                  description: t.description,
                  amount: t.amount,
                  currency_code: 'BRL',
                  transaction_date: t.date.split('T')[0],
                  transaction_time: transactionTime,
                  category: t.category || 'Outros',
                  payment_data: t.paymentData || {},
                  card_last_digits: t.creditCardMetadata?.cardNumber?.slice(-4) || account.number?.slice(-4),
                  merchant_name: t.merchant?.name || null,
                  merchant_cnpj: cnpj,
                  merchant_city: city,
                  merchant_state: state,
                  installment_number: installmentNumber,
                  total_installments: totalInstallments,
                  original_purchase_date: originalPurchaseDate,
                };
              });

              const { error: upsertError } = await supabase
                .from('credit_card_transactions')
                .upsert(formattedBatch, { onConflict: 'pluggy_transaction_id' });

              if (upsertError) {
                console.error(`Error upserting credit batch:`, upsertError);
              }
              totalCount += formattedBatch.length;
            }
          }

          // === BANK (CHECKING) ACCOUNT TRANSACTIONS ===
          const bankAccounts = accounts.filter(a => a.type === 'BANK');
          for (const account of bankAccounts) {
            const transactions = await getTransactions(apiKey, account.id, from, to);
            console.log(`Bank Account ${account.id}: ${transactions.length} transactions to process`);

            for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
              const batch = transactions.slice(i, i + BATCH_SIZE);
              const formattedBatch = batch.map(t => {
                let transactionTime = null;
                if (t.date && t.date.includes('T')) {
                  const timePart = t.date.split('T')[1];
                  if (timePart) transactionTime = timePart.split('.')[0];
                }
                return {
                  user_id: user.id,
                  pluggy_account_id: account.id,
                  pluggy_transaction_id: t.id,
                  pluggy_item_id: connection.pluggy_item_id,
                  description: t.description,
                  amount: t.amount,
                  currency_code: 'BRL',
                  transaction_date: t.date.split('T')[0],
                  transaction_time: transactionTime,
                  category: t.category || null,
                  transaction_type: t.amount >= 0 ? 'CREDIT' : 'DEBIT',
                  payment_data: t.paymentData || {},
                  merchant_name: t.merchant?.name || null,
                  merchant_cnpj: t.merchant?.cnpj || null,
                  merchant_city: t.merchant?.city || null,
                  merchant_state: t.merchant?.state || null,
                };
              });

              const { error: upsertError } = await supabase
                .from('bank_transactions')
                .upsert(formattedBatch, { onConflict: 'pluggy_transaction_id' });

              if (upsertError) {
                console.error(`Error upserting bank batch:`, upsertError);
              }
              totalCount += formattedBatch.length;
            }
          }

          // === INVESTMENT ACCOUNTS ===
          const investmentAccounts = accounts.filter(a => a.type === 'INVESTMENT');
          for (const account of investmentAccounts) {
            const investData = {
              user_id: user.id,
              pluggy_account_id: account.id,
              pluggy_item_id: connection.pluggy_item_id,
              name: account.name,
              type: (account as any).subtype || 'Investimento',
              balance: account.balance,
              currency_code: 'BRL',
              status: 'active',
              last_updated_at: new Date().toISOString(),
            };

            const { error: investError } = await supabase
              .from('investments')
              .upsert(investData, { onConflict: 'pluggy_account_id,user_id' });

            if (investError) {
              console.error(`Error upserting investment:`, investError);
            } else {
              totalCount++;
            }
          }

          // === LOAN ACCOUNTS ===
          const loanAccounts = accounts.filter(a => a.type === 'LOAN');
          for (const account of loanAccounts) {
            const loanData = {
              user_id: user.id,
              pluggy_account_id: account.id,
              pluggy_item_id: connection.pluggy_item_id,
              name: account.name,
              loan_type: (account as any).subtype || 'Empréstimo',
              outstanding_balance: account.balance,
              currency_code: 'BRL',
              status: 'active',
            };

            const { error: loanError } = await supabase
              .from('loans')
              .upsert(loanData, { onConflict: 'pluggy_account_id,user_id' });

            if (loanError) {
              console.error(`Error upserting loan:`, loanError);
            } else {
              totalCount++;
            }
          }

          // Update last sync
          await supabase
            .from('pluggy_connections')
            .update({ last_sync_at: new Date().toISOString() })
            .eq('id', connection.id);
        }

        return new Response(JSON.stringify({ 
          success: true, 
          count: totalCount 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get_connections': {
        // Check if user has any card permissions (explicit access only)
        const { data: cardPermissions } = await supabase
          .from('user_card_permissions')
          .select('id')
          .eq('user_id', user.id)
          .limit(1);
        
        const hasCardPermissions = (cardPermissions?.length || 0) > 0;
        
        // Only users with explicit card permissions can see connections
        // Otherwise, only show own connections
        let connections;
        if (hasCardPermissions) {
          // User has card permissions, show all connections
          const { data } = await supabase
            .from('pluggy_connections')
            .select('*')
            .order('created_at', { ascending: false });
          connections = data;
        } else {
          // No card permissions, only show own connections
          const { data } = await supabase
            .from('pluggy_connections')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
          connections = data;
        }

        return new Response(JSON.stringify({ connections: connections || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'list_pluggy_items': {
        // Note: Pluggy API doesn't support listing all items
        // We can only retrieve items by ID if we have them saved
        console.log('list_pluggy_items: This operation is not supported by Pluggy API');
        
        // Return connections from our database instead
        const { data: dbConnections } = await supabase
          .from('pluggy_connections')
          .select('*')
          .eq('user_id', user.id);
        
        return new Response(JSON.stringify({ 
          items: dbConnections || [],
          message: 'Pluggy API does not support listing all items. Showing saved connections.'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'import_existing_connections': {
        // Since Pluggy doesn't have a list endpoint, we need to update existing connections
        // by checking their status individually
        console.log('Checking existing connections status');
        
        const { data: existingConnections } = await supabase
          .from('pluggy_connections')
          .select('*')
          .eq('user_id', user.id);
        
        if (!existingConnections || existingConnections.length === 0) {
          return new Response(JSON.stringify({ 
            success: true, 
            imported: 0,
            message: 'Nenhuma conexão encontrada. Use o Pluggy Connect para adicionar uma nova conexão.',
            connections: [] 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        // Update status of existing connections
        const updated = [];
        for (const conn of existingConnections) {
          try {
            const item = await getItem(apiKey, conn.pluggy_item_id);
            const { error: updateError } = await supabase
              .from('pluggy_connections')
              .update({ 
                status: item.status,
                connector_name: item.connector?.name || conn.connector_name,
                last_sync_at: new Date().toISOString()
              })
              .eq('id', conn.id);
            
            if (!updateError) {
              updated.push({ ...conn, status: item.status });
            }
          } catch (err) {
            console.log(`Error updating connection ${conn.id}:`, err);
          }
        }
        
        return new Response(JSON.stringify({ 
          success: true, 
          updated: updated.length,
          connections: updated,
          message: `${updated.length} conexões atualizadas.`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'import_by_item_id': {
        console.log('import_by_item_id called with itemId:', itemId);
        
        if (!itemId) {
          return new Response(JSON.stringify({ error: 'itemId is required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Fetch item details from Pluggy API
        const item = await getItem(apiKey, itemId);
        console.log('Pluggy item fetched for import:', JSON.stringify(item));
        
        // Save connection to database
        const connectionData = {
          user_id: user.id,
          pluggy_item_id: itemId,
          connector_name: item.connector?.name || 'Unknown',
          connector_type: item.connector?.type || 'Unknown',
          status: item.status || 'UPDATING',
          last_sync_at: new Date().toISOString(),
        };
        
        const { data: connection, error: upsertError } = await supabase
          .from('pluggy_connections')
          .upsert(connectionData, { onConflict: 'pluggy_item_id' })
          .select()
          .single();

        if (upsertError) {
          console.error('Error saving connection:', upsertError);
          throw new Error(`Failed to save connection: ${upsertError.message}`);
        }
        
        console.log('Connection imported successfully:', connection);

        return new Response(JSON.stringify({ 
          success: true, 
          connection,
          item: {
            id: item.id,
            status: item.status,
            executionStatus: item.executionStatus,
            connector: item.connector
          }
        }), {
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
