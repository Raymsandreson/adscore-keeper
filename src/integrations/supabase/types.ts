export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_category_links: {
        Row: {
          category_id: string
          created_at: string
          id: string
          pluggy_account_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          pluggy_account_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          pluggy_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_briefings: {
        Row: {
          approved_by: string | null
          body_text: string | null
          created_at: string
          created_by: string | null
          creative_type: string | null
          creative_url: string | null
          cta: string | null
          headline: string | null
          id: string
          lead_id: string | null
          lead_name: string | null
          link_description: string | null
          notes: string | null
          promoted_post_id: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          body_text?: string | null
          created_at?: string
          created_by?: string | null
          creative_type?: string | null
          creative_url?: string | null
          cta?: string | null
          headline?: string | null
          id?: string
          lead_id?: string | null
          lead_name?: string | null
          link_description?: string | null
          notes?: string | null
          promoted_post_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          body_text?: string | null
          created_at?: string
          created_by?: string | null
          creative_type?: string | null
          creative_url?: string | null
          cta?: string | null
          headline?: string | null
          id?: string
          lead_id?: string | null
          lead_name?: string | null
          link_description?: string | null
          notes?: string | null
          promoted_post_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_briefings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_briefings_promoted_post_id_fkey"
            columns: ["promoted_post_id"]
            isOneToOne: false
            referencedRelation: "promoted_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_conversation_history: {
        Row: {
          ad_account_id: string | null
          content: string
          created_at: string
          entity_id: string
          entity_name: string | null
          entity_type: string
          id: string
          role: string
        }
        Insert: {
          ad_account_id?: string | null
          content: string
          created_at?: string
          entity_id: string
          entity_name?: string | null
          entity_type?: string
          id?: string
          role: string
        }
        Update: {
          ad_account_id?: string | null
          content?: string
          created_at?: string
          entity_id?: string
          entity_name?: string | null
          entity_type?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      campaign_action_history: {
        Row: {
          action: string
          ad_account_id: string | null
          created_at: string
          entity_id: string
          entity_name: string | null
          entity_type: string
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          action: string
          ad_account_id?: string | null
          created_at?: string
          entity_id: string
          entity_name?: string | null
          entity_type: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          action?: string
          ad_account_id?: string | null
          created_at?: string
          entity_id?: string
          entity_name?: string | null
          entity_type?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: []
      }
      card_assignments: {
        Row: {
          card_last_digits: string
          card_name: string | null
          contact_id: string | null
          cost_account_id: string | null
          created_at: string
          id: string
          lead_id: string | null
          lead_name: string | null
          notes: string | null
          pluggy_account_id: string | null
          updated_at: string
        }
        Insert: {
          card_last_digits: string
          card_name?: string | null
          contact_id?: string | null
          cost_account_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          lead_name?: string | null
          notes?: string | null
          pluggy_account_id?: string | null
          updated_at?: string
        }
        Update: {
          card_last_digits?: string
          card_name?: string | null
          contact_id?: string | null
          cost_account_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          lead_name?: string | null
          notes?: string | null
          pluggy_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_assignments_cost_account_id_fkey"
            columns: ["cost_account_id"]
            isOneToOne: false
            referencedRelation: "cost_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      cat_lead_contacts: {
        Row: {
          cat_lead_id: string
          contact_channel: string
          contact_result: string
          contacted_by: string | null
          created_at: string
          id: string
          next_action: string | null
          next_action_date: string | null
          notes: string | null
          phone_used: string | null
        }
        Insert: {
          cat_lead_id: string
          contact_channel?: string
          contact_result?: string
          contacted_by?: string | null
          created_at?: string
          id?: string
          next_action?: string | null
          next_action_date?: string | null
          notes?: string | null
          phone_used?: string | null
        }
        Update: {
          cat_lead_id?: string
          contact_channel?: string
          contact_result?: string
          contacted_by?: string | null
          created_at?: string
          id?: string
          next_action?: string | null
          next_action_date?: string | null
          notes?: string | null
          phone_used?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cat_lead_contacts_cat_lead_id_fkey"
            columns: ["cat_lead_id"]
            isOneToOne: false
            referencedRelation: "cat_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      cat_leads: {
        Row: {
          agente_causador: string | null
          assigned_to: string | null
          bairro: string | null
          cbo: string | null
          celular_1: string | null
          celular_2: string | null
          celular_3: string | null
          celular_4: string | null
          cep: string | null
          cid_10: string | null
          cnae_empregador: string | null
          cnpj_cei_empregador: string | null
          contact_status: string | null
          cpf: string | null
          created_at: string
          data_acidente: string | null
          data_afastamento: string | null
          data_emissao_cat: string | null
          data_nascimento: string | null
          endereco: string | null
          filiacao_segurado: string | null
          fixo_1: string | null
          fixo_2: string | null
          fixo_3: string | null
          fixo_4: string | null
          id: string
          import_batch_id: string | null
          imported_at: string | null
          indica_obito: boolean | null
          lead_id: string | null
          municipio: string | null
          municipio_empregador: string | null
          natureza_lesao: string | null
          nome_completo: string
          notes: string | null
          origem_cadastramento: string | null
          parte_corpo_atingida: string | null
          priority: string | null
          resultado_celular_1: string | null
          resultado_celular_2: string | null
          resultado_celular_3: string | null
          resultado_celular_4: string | null
          resultado_fixo_1: string | null
          resultado_fixo_2: string | null
          resultado_fixo_3: string | null
          resultado_fixo_4: string | null
          sexo: string | null
          tipo_acidente: string | null
          tipo_empregador: string | null
          uf: string | null
          uf_municipio_acidente: string | null
          uf_municipio_empregador: string | null
          updated_at: string
        }
        Insert: {
          agente_causador?: string | null
          assigned_to?: string | null
          bairro?: string | null
          cbo?: string | null
          celular_1?: string | null
          celular_2?: string | null
          celular_3?: string | null
          celular_4?: string | null
          cep?: string | null
          cid_10?: string | null
          cnae_empregador?: string | null
          cnpj_cei_empregador?: string | null
          contact_status?: string | null
          cpf?: string | null
          created_at?: string
          data_acidente?: string | null
          data_afastamento?: string | null
          data_emissao_cat?: string | null
          data_nascimento?: string | null
          endereco?: string | null
          filiacao_segurado?: string | null
          fixo_1?: string | null
          fixo_2?: string | null
          fixo_3?: string | null
          fixo_4?: string | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string | null
          indica_obito?: boolean | null
          lead_id?: string | null
          municipio?: string | null
          municipio_empregador?: string | null
          natureza_lesao?: string | null
          nome_completo: string
          notes?: string | null
          origem_cadastramento?: string | null
          parte_corpo_atingida?: string | null
          priority?: string | null
          resultado_celular_1?: string | null
          resultado_celular_2?: string | null
          resultado_celular_3?: string | null
          resultado_celular_4?: string | null
          resultado_fixo_1?: string | null
          resultado_fixo_2?: string | null
          resultado_fixo_3?: string | null
          resultado_fixo_4?: string | null
          sexo?: string | null
          tipo_acidente?: string | null
          tipo_empregador?: string | null
          uf?: string | null
          uf_municipio_acidente?: string | null
          uf_municipio_empregador?: string | null
          updated_at?: string
        }
        Update: {
          agente_causador?: string | null
          assigned_to?: string | null
          bairro?: string | null
          cbo?: string | null
          celular_1?: string | null
          celular_2?: string | null
          celular_3?: string | null
          celular_4?: string | null
          cep?: string | null
          cid_10?: string | null
          cnae_empregador?: string | null
          cnpj_cei_empregador?: string | null
          contact_status?: string | null
          cpf?: string | null
          created_at?: string
          data_acidente?: string | null
          data_afastamento?: string | null
          data_emissao_cat?: string | null
          data_nascimento?: string | null
          endereco?: string | null
          filiacao_segurado?: string | null
          fixo_1?: string | null
          fixo_2?: string | null
          fixo_3?: string | null
          fixo_4?: string | null
          id?: string
          import_batch_id?: string | null
          imported_at?: string | null
          indica_obito?: boolean | null
          lead_id?: string | null
          municipio?: string | null
          municipio_empregador?: string | null
          natureza_lesao?: string | null
          nome_completo?: string
          notes?: string | null
          origem_cadastramento?: string | null
          parte_corpo_atingida?: string | null
          priority?: string | null
          resultado_celular_1?: string | null
          resultado_celular_2?: string | null
          resultado_celular_3?: string | null
          resultado_celular_4?: string | null
          resultado_fixo_1?: string | null
          resultado_fixo_2?: string | null
          resultado_fixo_3?: string | null
          resultado_fixo_4?: string | null
          sexo?: string | null
          tipo_acidente?: string | null
          tipo_empregador?: string | null
          uf?: string | null
          uf_municipio_acidente?: string | null
          uf_municipio_empregador?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      category_api_mappings: {
        Row: {
          api_category_name: string
          category_id: string
          created_at: string
          id: string
        }
        Insert: {
          api_category_name: string
          category_id: string
          created_at?: string
          id?: string
        }
        Update: {
          api_category_name?: string
          category_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "category_api_mappings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      cbo_professions: {
        Row: {
          cbo_code: string
          created_at: string
          family_code: string | null
          family_title: string | null
          id: string
          title: string
        }
        Insert: {
          cbo_code: string
          created_at?: string
          family_code?: string | null
          family_title?: string | null
          id?: string
          title: string
        }
        Update: {
          cbo_code?: string
          created_at?: string
          family_code?: string | null
          family_title?: string | null
          id?: string
          title?: string
        }
        Relationships: []
      }
      checklist_stage_links: {
        Row: {
          board_id: string
          checklist_template_id: string
          created_at: string
          display_order: number
          id: string
          stage_id: string
        }
        Insert: {
          board_id: string
          checklist_template_id: string
          created_at?: string
          display_order?: number
          id?: string
          stage_id: string
        }
        Update: {
          board_id?: string
          checklist_template_id?: string
          created_at?: string
          display_order?: number
          id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_stage_links_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "kanban_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_stage_links_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_mandatory: boolean
          items: Json
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_mandatory?: boolean
          items?: Json
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_mandatory?: boolean
          items?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      contact_classifications: {
        Row: {
          color: string
          created_at: string
          display_order: number | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          show_in_workflow: boolean
        }
        Insert: {
          color?: string
          created_at?: string
          display_order?: number | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          show_in_workflow?: boolean
        }
        Update: {
          color?: string
          created_at?: string
          display_order?: number | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          show_in_workflow?: boolean
        }
        Relationships: []
      }
      contact_leads: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          lead_id: string
          notes: string | null
          relationship_to_victim: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          relationship_to_victim?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          relationship_to_victim?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_professions: {
        Row: {
          cbo_code: string
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean | null
          profession_title: string
        }
        Insert: {
          cbo_code: string
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean | null
          profession_title: string
        }
        Update: {
          cbo_code?: string
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean | null
          profession_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_professions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_relationship_types: {
        Row: {
          created_at: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
        }
        Relationships: []
      }
      contact_relationships: {
        Row: {
          contact_id: string
          created_at: string | null
          id: string
          notes: string | null
          related_contact_id: string
          relationship_type: string
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          id?: string
          notes?: string | null
          related_contact_id: string
          relationship_type: string
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          related_contact_id?: string
          relationship_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_relationships_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_relationships_related_contact_id_fkey"
            columns: ["related_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          cep: string | null
          city: string | null
          classification: string | null
          classifications: string[] | null
          converted_to_lead_at: string | null
          created_at: string
          created_by: string | null
          email: string | null
          follow_requested_at: string | null
          follower_status: string | null
          full_name: string
          id: string
          instagram_url: string | null
          instagram_username: string | null
          lead_id: string | null
          neighborhood: string | null
          notes: string | null
          phone: string | null
          profession: string | null
          profession_cbo_code: string | null
          state: string | null
          street: string | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          cep?: string | null
          city?: string | null
          classification?: string | null
          classifications?: string[] | null
          converted_to_lead_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          follow_requested_at?: string | null
          follower_status?: string | null
          full_name: string
          id?: string
          instagram_url?: string | null
          instagram_username?: string | null
          lead_id?: string | null
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          profession?: string | null
          profession_cbo_code?: string | null
          state?: string | null
          street?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          cep?: string | null
          city?: string | null
          classification?: string | null
          classifications?: string[] | null
          converted_to_lead_at?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          follow_requested_at?: string | null
          follower_status?: string | null
          full_name?: string
          id?: string
          instagram_url?: string | null
          instagram_username?: string | null
          lead_id?: string | null
          neighborhood?: string | null
          notes?: string | null
          phone?: string | null
          profession?: string | null
          profession_cbo_code?: string | null
          state?: string | null
          street?: string | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_accounts: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      credit_card_transactions: {
        Row: {
          amount: number
          card_last_digits: string | null
          category: string | null
          created_at: string
          currency_code: string | null
          description: string | null
          id: string
          installment_number: number | null
          merchant_city: string | null
          merchant_cnpj: string | null
          merchant_name: string | null
          merchant_state: string | null
          original_purchase_date: string | null
          payment_data: Json | null
          pluggy_account_id: string
          pluggy_item_id: string | null
          pluggy_transaction_id: string
          purchase_group_id: string | null
          total_installments: number | null
          transaction_date: string
          transaction_time: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          card_last_digits?: string | null
          category?: string | null
          created_at?: string
          currency_code?: string | null
          description?: string | null
          id?: string
          installment_number?: number | null
          merchant_city?: string | null
          merchant_cnpj?: string | null
          merchant_name?: string | null
          merchant_state?: string | null
          original_purchase_date?: string | null
          payment_data?: Json | null
          pluggy_account_id: string
          pluggy_item_id?: string | null
          pluggy_transaction_id: string
          purchase_group_id?: string | null
          total_installments?: number | null
          transaction_date: string
          transaction_time?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          card_last_digits?: string | null
          category?: string | null
          created_at?: string
          currency_code?: string | null
          description?: string | null
          id?: string
          installment_number?: number | null
          merchant_city?: string | null
          merchant_cnpj?: string | null
          merchant_name?: string | null
          merchant_state?: string | null
          original_purchase_date?: string | null
          payment_data?: Json | null
          pluggy_account_id?: string
          pluggy_item_id?: string | null
          pluggy_transaction_id?: string
          purchase_group_id?: string | null
          total_installments?: number | null
          transaction_date?: string
          transaction_time?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dm_history: {
        Row: {
          action_type: string
          author_id: string | null
          comment_id: string | null
          created_at: string
          dm_message: string
          id: string
          instagram_username: string
          original_suggestion: string | null
          user_id: string | null
          was_edited: boolean | null
        }
        Insert: {
          action_type?: string
          author_id?: string | null
          comment_id?: string | null
          created_at?: string
          dm_message: string
          id?: string
          instagram_username: string
          original_suggestion?: string | null
          user_id?: string | null
          was_edited?: boolean | null
        }
        Update: {
          action_type?: string
          author_id?: string | null
          comment_id?: string | null
          created_at?: string
          dm_message?: string
          id?: string
          instagram_username?: string
          original_suggestion?: string | null
          user_id?: string | null
          was_edited?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "dm_history_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "instagram_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_champions: {
        Row: {
          ad_account_id: string | null
          badge_level: string
          comments_count: number | null
          created_at: string
          final_position: number
          id: string
          mentions_count: number | null
          profile_picture_url: string | null
          total_points: number
          user_id: string | null
          username: string
          week_end: string
          week_start: string
        }
        Insert: {
          ad_account_id?: string | null
          badge_level: string
          comments_count?: number | null
          created_at?: string
          final_position: number
          id?: string
          mentions_count?: number | null
          profile_picture_url?: string | null
          total_points: number
          user_id?: string | null
          username: string
          week_end: string
          week_start: string
        }
        Update: {
          ad_account_id?: string | null
          badge_level?: string
          comments_count?: number | null
          created_at?: string
          final_position?: number
          id?: string
          mentions_count?: number | null
          profile_picture_url?: string | null
          total_points?: number
          user_id?: string | null
          username?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      engagement_championship_settings: {
        Row: {
          ad_account_id: string | null
          bronze_threshold: number | null
          created_at: string
          diamond_threshold: number | null
          gold_threshold: number | null
          id: string
          notify_on_new_champion: boolean | null
          notify_on_rank_change: boolean | null
          points_per_comment: number | null
          points_per_mention: number | null
          silver_threshold: number | null
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          bronze_threshold?: number | null
          created_at?: string
          diamond_threshold?: number | null
          gold_threshold?: number | null
          id?: string
          notify_on_new_champion?: boolean | null
          notify_on_rank_change?: boolean | null
          points_per_comment?: number | null
          points_per_mention?: number | null
          silver_threshold?: number | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          bronze_threshold?: number | null
          created_at?: string
          diamond_threshold?: number | null
          gold_threshold?: number | null
          id?: string
          notify_on_new_champion?: boolean | null
          notify_on_rank_change?: boolean | null
          points_per_comment?: number | null
          points_per_mention?: number | null
          silver_threshold?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      engagement_daily_stats: {
        Row: {
          ad_account_id: string | null
          comments_received: number | null
          comments_sent: number | null
          created_at: string
          engagement_rate: number | null
          id: string
          impressions: number | null
          likes_given: number | null
          likes_received: number | null
          new_followers: number | null
          platform: string
          reach: number | null
          replies_sent: number | null
          stat_date: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ad_account_id?: string | null
          comments_received?: number | null
          comments_sent?: number | null
          created_at?: string
          engagement_rate?: number | null
          id?: string
          impressions?: number | null
          likes_given?: number | null
          likes_received?: number | null
          new_followers?: number | null
          platform?: string
          reach?: number | null
          replies_sent?: number | null
          stat_date?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ad_account_id?: string | null
          comments_received?: number | null
          comments_sent?: number | null
          created_at?: string
          engagement_rate?: number | null
          id?: string
          impressions?: number | null
          likes_given?: number | null
          likes_received?: number | null
          new_followers?: number | null
          platform?: string
          reach?: number | null
          replies_sent?: number | null
          stat_date?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      engagement_goals: {
        Row: {
          ad_account_id: string | null
          created_at: string
          current_value: number | null
          end_date: string | null
          goal_type: string
          id: string
          is_active: boolean | null
          period: string
          platform: string
          start_date: string
          target_value: number
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          created_at?: string
          current_value?: number | null
          end_date?: string | null
          goal_type: string
          id?: string
          is_active?: boolean | null
          period?: string
          platform?: string
          start_date?: string
          target_value: number
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          created_at?: string
          current_value?: number | null
          end_date?: string | null
          goal_type?: string
          id?: string
          is_active?: boolean | null
          period?: string
          platform?: string
          start_date?: string
          target_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      engagement_rankings: {
        Row: {
          ad_account_id: string | null
          badge_level: string | null
          comments_count: number | null
          created_at: string
          id: string
          mentions_count: number | null
          previous_rank_position: number | null
          profile_picture_url: string | null
          rank_position: number | null
          total_points: number | null
          updated_at: string
          user_id: string | null
          username: string
          week_end: string
          week_start: string
        }
        Insert: {
          ad_account_id?: string | null
          badge_level?: string | null
          comments_count?: number | null
          created_at?: string
          id?: string
          mentions_count?: number | null
          previous_rank_position?: number | null
          profile_picture_url?: string | null
          rank_position?: number | null
          total_points?: number | null
          updated_at?: string
          user_id?: string | null
          username: string
          week_end: string
          week_start: string
        }
        Update: {
          ad_account_id?: string | null
          badge_level?: string | null
          comments_count?: number | null
          created_at?: string
          id?: string
          mentions_count?: number | null
          previous_rank_position?: number | null
          profile_picture_url?: string | null
          rank_position?: number | null
          total_points?: number | null
          updated_at?: string
          user_id?: string | null
          username?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          color: string | null
          created_at: string
          display_order: number | null
          icon: string | null
          id: string
          is_system: boolean | null
          limit_unit: string | null
          max_limit_per_unit: number | null
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          display_order?: number | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          limit_unit?: string | null
          max_limit_per_unit?: number | null
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          display_order?: number | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          limit_unit?: string | null
          max_limit_per_unit?: number | null
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_form_responses: {
        Row: {
          category: string | null
          city: string | null
          description: string | null
          id: string
          lead_name: string | null
          state: string | null
          submitted_at: string
          token_id: string
          transaction_id: string
        }
        Insert: {
          category?: string | null
          city?: string | null
          description?: string | null
          id?: string
          lead_name?: string | null
          state?: string | null
          submitted_at?: string
          token_id: string
          transaction_id: string
        }
        Update: {
          category?: string | null
          city?: string | null
          description?: string | null
          id?: string
          lead_name?: string | null
          state?: string | null
          submitted_at?: string
          token_id?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_form_responses_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "expense_form_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_form_tokens: {
        Row: {
          card_last_digits: string
          created_at: string
          created_by: string | null
          date_from: string
          date_to: string
          expires_at: string
          id: string
          notes: string | null
          pluggy_account_id: string | null
          submitted_at: string | null
          token: string
          transaction_ids: string[] | null
        }
        Insert: {
          card_last_digits: string
          created_at?: string
          created_by?: string | null
          date_from: string
          date_to: string
          expires_at?: string
          id?: string
          notes?: string | null
          pluggy_account_id?: string | null
          submitted_at?: string | null
          token?: string
          transaction_ids?: string[] | null
        }
        Update: {
          card_last_digits?: string
          created_at?: string
          created_by?: string | null
          date_from?: string
          date_to?: string
          expires_at?: string
          id?: string
          notes?: string | null
          pluggy_account_id?: string | null
          submitted_at?: string | null
          token?: string
          transaction_ids?: string[] | null
        }
        Relationships: []
      }
      external_posts: {
        Row: {
          author_username: string | null
          comments_count: number | null
          created_at: string
          description: string | null
          id: string
          last_fetched_at: string | null
          lead_id: string | null
          metadata: Json | null
          news_links: string[] | null
          notes: string | null
          platform: string
          post_id: string | null
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          author_username?: string | null
          comments_count?: number | null
          created_at?: string
          description?: string | null
          id?: string
          last_fetched_at?: string | null
          lead_id?: string | null
          metadata?: Json | null
          news_links?: string[] | null
          notes?: string | null
          platform?: string
          post_id?: string | null
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          author_username?: string | null
          comments_count?: number | null
          created_at?: string
          description?: string | null
          id?: string
          last_fetched_at?: string | null
          lead_id?: string | null
          metadata?: Json | null
          news_links?: string[] | null
          notes?: string | null
          platform?: string
          post_id?: string | null
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_posts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_history: {
        Row: {
          achieved_value: number
          achievement_percentage: number | null
          ad_account_id: string | null
          created_at: string
          deadline: string
          goal_title: string
          goal_type: string
          id: string
          notes: string | null
          period_end: string | null
          period_start: string | null
          status: string
          target_value: number
          unit: string | null
        }
        Insert: {
          achieved_value: number
          achievement_percentage?: number | null
          ad_account_id?: string | null
          created_at?: string
          deadline: string
          goal_title: string
          goal_type: string
          id?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          target_value: number
          unit?: string | null
        }
        Update: {
          achieved_value?: number
          achievement_percentage?: number | null
          ad_account_id?: string | null
          created_at?: string
          deadline?: string
          goal_title?: string
          goal_type?: string
          id?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          target_value?: number
          unit?: string | null
        }
        Relationships: []
      }
      instagram_accounts: {
        Row: {
          access_token: string
          account_name: string
          created_at: string
          followers_count: number | null
          following_count: number | null
          id: string
          instagram_id: string
          is_active: boolean | null
          last_sync_at: string | null
          media_count: number | null
          profile_picture_url: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          account_name: string
          created_at?: string
          followers_count?: number | null
          following_count?: number | null
          id?: string
          instagram_id: string
          is_active?: boolean | null
          last_sync_at?: string | null
          media_count?: number | null
          profile_picture_url?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          account_name?: string
          created_at?: string
          followers_count?: number | null
          following_count?: number | null
          id?: string
          instagram_id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          media_count?: number | null
          profile_picture_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      instagram_auto_replies: {
        Row: {
          ad_account_id: string | null
          created_at: string
          delay_seconds: number | null
          id: string
          is_active: boolean | null
          last_reply_at: string | null
          max_replies_per_hour: number | null
          name: string
          platform: string
          replies_count: number | null
          reply_templates: string[]
          trigger_keywords: string[] | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          created_at?: string
          delay_seconds?: number | null
          id?: string
          is_active?: boolean | null
          last_reply_at?: string | null
          max_replies_per_hour?: number | null
          name: string
          platform?: string
          replies_count?: number | null
          reply_templates: string[]
          trigger_keywords?: string[] | null
          trigger_type: string
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          created_at?: string
          delay_seconds?: number | null
          id?: string
          is_active?: boolean | null
          last_reply_at?: string | null
          max_replies_per_hour?: number | null
          name?: string
          platform?: string
          replies_count?: number | null
          reply_templates?: string[]
          trigger_keywords?: string[] | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      instagram_comments: {
        Row: {
          ad_account_id: string | null
          author_id: string | null
          author_username: string | null
          comment_id: string | null
          comment_text: string | null
          comment_type: string
          conversation_thread_id: string | null
          created_at: string
          funnel_stage: string | null
          id: string
          metadata: Json | null
          notes: string | null
          parent_comment_id: string | null
          platform: string
          post_id: string | null
          post_url: string | null
          prospect_name: string | null
          replied_at: string | null
          replied_by: string | null
        }
        Insert: {
          ad_account_id?: string | null
          author_id?: string | null
          author_username?: string | null
          comment_id?: string | null
          comment_text?: string | null
          comment_type: string
          conversation_thread_id?: string | null
          created_at?: string
          funnel_stage?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          parent_comment_id?: string | null
          platform?: string
          post_id?: string | null
          post_url?: string | null
          prospect_name?: string | null
          replied_at?: string | null
          replied_by?: string | null
        }
        Update: {
          ad_account_id?: string | null
          author_id?: string | null
          author_username?: string | null
          comment_id?: string | null
          comment_text?: string | null
          comment_type?: string
          conversation_thread_id?: string | null
          created_at?: string
          funnel_stage?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          parent_comment_id?: string | null
          platform?: string
          post_id?: string | null
          post_url?: string | null
          prospect_name?: string | null
          replied_at?: string | null
          replied_by?: string | null
        }
        Relationships: []
      }
      instagram_metrics: {
        Row: {
          account_id: string
          created_at: string
          email_contacts: number | null
          engagement_rate: number | null
          feed_comments: number | null
          feed_likes: number | null
          feed_reach: number | null
          feed_saves: number | null
          feed_shares: number | null
          followers_count: number | null
          following_count: number | null
          id: string
          impressions: number | null
          media_count: number | null
          metric_date: string
          new_followers: number | null
          profile_views: number | null
          reach: number | null
          reels_comments: number | null
          reels_likes: number | null
          reels_saves: number | null
          reels_shares: number | null
          reels_views: number | null
          stories_exits: number | null
          stories_replies: number | null
          stories_views: number | null
          website_clicks: number | null
        }
        Insert: {
          account_id: string
          created_at?: string
          email_contacts?: number | null
          engagement_rate?: number | null
          feed_comments?: number | null
          feed_likes?: number | null
          feed_reach?: number | null
          feed_saves?: number | null
          feed_shares?: number | null
          followers_count?: number | null
          following_count?: number | null
          id?: string
          impressions?: number | null
          media_count?: number | null
          metric_date?: string
          new_followers?: number | null
          profile_views?: number | null
          reach?: number | null
          reels_comments?: number | null
          reels_likes?: number | null
          reels_saves?: number | null
          reels_shares?: number | null
          reels_views?: number | null
          stories_exits?: number | null
          stories_replies?: number | null
          stories_views?: number | null
          website_clicks?: number | null
        }
        Update: {
          account_id?: string
          created_at?: string
          email_contacts?: number | null
          engagement_rate?: number | null
          feed_comments?: number | null
          feed_likes?: number | null
          feed_reach?: number | null
          feed_saves?: number | null
          feed_shares?: number | null
          followers_count?: number | null
          following_count?: number | null
          id?: string
          impressions?: number | null
          media_count?: number | null
          metric_date?: string
          new_followers?: number | null
          profile_views?: number | null
          reach?: number | null
          reels_comments?: number | null
          reels_likes?: number | null
          reels_saves?: number | null
          reels_shares?: number | null
          reels_views?: number | null
          stories_exits?: number | null
          stories_replies?: number | null
          stories_views?: number | null
          website_clicks?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "instagram_metrics_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "instagram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_search_history: {
        Row: {
          apify_run_id: string | null
          completed_at: string | null
          cost_brl: number | null
          cost_usd: number | null
          created_at: string
          created_by: string | null
          id: string
          keywords: string[]
          max_posts: number | null
          min_comments: number | null
          post_urls: string[] | null
          results: Json | null
          results_count: number | null
          status: string | null
        }
        Insert: {
          apify_run_id?: string | null
          completed_at?: string | null
          cost_brl?: number | null
          cost_usd?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          keywords: string[]
          max_posts?: number | null
          min_comments?: number | null
          post_urls?: string[] | null
          results?: Json | null
          results_count?: number | null
          status?: string | null
        }
        Update: {
          apify_run_id?: string | null
          completed_at?: string | null
          cost_brl?: number | null
          cost_usd?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          keywords?: string[]
          max_posts?: number | null
          min_comments?: number | null
          post_urls?: string[] | null
          results?: Json | null
          results_count?: number | null
          status?: string | null
        }
        Relationships: []
      }
      kanban_boards: {
        Row: {
          ad_account_id: string | null
          color: string | null
          created_at: string
          description: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_default: boolean | null
          name: string
          stages: Json
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          stages?: Json
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          stages?: Json
          updated_at?: string
        }
        Relationships: []
      }
      lead_activities: {
        Row: {
          activity_type: string
          assigned_to: string | null
          assigned_to_name: string | null
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          contact_id: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          current_status_notes: string | null
          deadline: string | null
          description: string | null
          id: string
          lead_id: string | null
          lead_name: string | null
          next_steps: string | null
          notes: string | null
          notification_date: string | null
          priority: string | null
          status: string
          title: string
          updated_at: string
          what_was_done: string | null
        }
        Insert: {
          activity_type?: string
          assigned_to?: string | null
          assigned_to_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          current_status_notes?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          lead_id?: string | null
          lead_name?: string | null
          next_steps?: string | null
          notes?: string | null
          notification_date?: string | null
          priority?: string | null
          status?: string
          title: string
          updated_at?: string
          what_was_done?: string | null
        }
        Update: {
          activity_type?: string
          assigned_to?: string | null
          assigned_to_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          current_status_notes?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          lead_id?: string | null
          lead_name?: string | null
          next_steps?: string | null
          notes?: string | null
          notification_date?: string | null
          priority?: string | null
          status?: string
          title?: string
          updated_at?: string
          what_was_done?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_checklist_instances: {
        Row: {
          board_id: string
          checklist_template_id: string
          completed_at: string | null
          created_at: string
          id: string
          is_completed: boolean
          is_readonly: boolean
          items: Json
          lead_id: string
          stage_id: string
          updated_at: string
        }
        Insert: {
          board_id: string
          checklist_template_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          is_readonly?: boolean
          items?: Json
          lead_id: string
          stage_id: string
          updated_at?: string
        }
        Update: {
          board_id?: string
          checklist_template_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          is_readonly?: boolean
          items?: Json
          lead_id?: string
          stage_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_checklist_instances_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "kanban_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_checklist_instances_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_checklist_instances_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_custom_field_values: {
        Row: {
          created_at: string
          field_id: string
          id: string
          lead_id: string
          updated_at: string
          value_boolean: boolean | null
          value_date: string | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          lead_id: string
          updated_at?: string
          value_boolean?: boolean | null
          value_date?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          lead_id?: string
          updated_at?: string
          value_boolean?: boolean | null
          value_date?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "lead_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_custom_field_values_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_custom_fields: {
        Row: {
          ad_account_id: string | null
          created_at: string
          display_order: number | null
          field_name: string
          field_options: string[] | null
          field_type: string
          id: string
          is_required: boolean | null
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          created_at?: string
          display_order?: number | null
          field_name: string
          field_options?: string[] | null
          field_type?: string
          id?: string
          is_required?: boolean | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          created_at?: string
          display_order?: number | null
          field_name?: string
          field_options?: string[] | null
          field_type?: string
          id?: string
          is_required?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      lead_followups: {
        Row: {
          created_at: string
          followup_date: string
          followup_type: string
          id: string
          lead_id: string
          notes: string | null
          outcome: string | null
        }
        Insert: {
          created_at?: string
          followup_date?: string
          followup_type?: string
          id?: string
          lead_id: string
          notes?: string | null
          outcome?: string | null
        }
        Update: {
          created_at?: string
          followup_date?: string
          followup_type?: string
          id?: string
          lead_id?: string
          notes?: string | null
          outcome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_followups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_board_id: string | null
          from_stage: string | null
          id: string
          lead_id: string
          notes: string | null
          to_board_id: string | null
          to_stage: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_board_id?: string | null
          from_stage?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          to_board_id?: string | null
          to_stage: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_board_id?: string | null
          from_stage?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          to_board_id?: string | null
          to_stage?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          accident_address: string | null
          accident_date: string | null
          acolhedor: string | null
          ad_account_id: string | null
          ad_name: string | null
          ad_spend_at_conversion: number | null
          ad_start_date: string | null
          adset_id: string | null
          adset_name: string | null
          became_client_date: string | null
          board_id: string | null
          campaign_id: string | null
          campaign_name: string | null
          case_type: string | null
          city: string | null
          classification_date: string | null
          client_classification: string | null
          company_size_justification: string | null
          contractor_company: string | null
          conversion_value: number | null
          converted_at: string | null
          created_at: string
          created_by: string | null
          creative_id: string | null
          creative_name: string | null
          damage_description: string | null
          facebook_lead_id: string | null
          first_meeting_at: string | null
          first_visit_at: string | null
          followup_count: number | null
          group_link: string | null
          id: string
          instagram_comment_id: string | null
          instagram_username: string | null
          is_follower: boolean | null
          last_edit_summary: string | null
          last_followup_at: string | null
          last_sync_at: string | null
          lead_email: string | null
          lead_name: string | null
          lead_phone: string | null
          legal_viability: string | null
          liability_type: string | null
          main_company: string | null
          neighborhood: string | null
          news_link: string | null
          notes: string | null
          qualified_at: string | null
          sector: string | null
          source: string | null
          state: string | null
          status: string | null
          sync_status: string | null
          updated_at: string
          updated_by: string | null
          victim_age: number | null
          victim_name: string | null
          visit_address: string | null
          visit_city: string | null
          visit_region: string | null
          visit_state: string | null
        }
        Insert: {
          accident_address?: string | null
          accident_date?: string | null
          acolhedor?: string | null
          ad_account_id?: string | null
          ad_name?: string | null
          ad_spend_at_conversion?: number | null
          ad_start_date?: string | null
          adset_id?: string | null
          adset_name?: string | null
          became_client_date?: string | null
          board_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          case_type?: string | null
          city?: string | null
          classification_date?: string | null
          client_classification?: string | null
          company_size_justification?: string | null
          contractor_company?: string | null
          conversion_value?: number | null
          converted_at?: string | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          creative_name?: string | null
          damage_description?: string | null
          facebook_lead_id?: string | null
          first_meeting_at?: string | null
          first_visit_at?: string | null
          followup_count?: number | null
          group_link?: string | null
          id?: string
          instagram_comment_id?: string | null
          instagram_username?: string | null
          is_follower?: boolean | null
          last_edit_summary?: string | null
          last_followup_at?: string | null
          last_sync_at?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          legal_viability?: string | null
          liability_type?: string | null
          main_company?: string | null
          neighborhood?: string | null
          news_link?: string | null
          notes?: string | null
          qualified_at?: string | null
          sector?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          sync_status?: string | null
          updated_at?: string
          updated_by?: string | null
          victim_age?: number | null
          victim_name?: string | null
          visit_address?: string | null
          visit_city?: string | null
          visit_region?: string | null
          visit_state?: string | null
        }
        Update: {
          accident_address?: string | null
          accident_date?: string | null
          acolhedor?: string | null
          ad_account_id?: string | null
          ad_name?: string | null
          ad_spend_at_conversion?: number | null
          ad_start_date?: string | null
          adset_id?: string | null
          adset_name?: string | null
          became_client_date?: string | null
          board_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          case_type?: string | null
          city?: string | null
          classification_date?: string | null
          client_classification?: string | null
          company_size_justification?: string | null
          contractor_company?: string | null
          conversion_value?: number | null
          converted_at?: string | null
          created_at?: string
          created_by?: string | null
          creative_id?: string | null
          creative_name?: string | null
          damage_description?: string | null
          facebook_lead_id?: string | null
          first_meeting_at?: string | null
          first_visit_at?: string | null
          followup_count?: number | null
          group_link?: string | null
          id?: string
          instagram_comment_id?: string | null
          instagram_username?: string | null
          is_follower?: boolean | null
          last_edit_summary?: string | null
          last_followup_at?: string | null
          last_sync_at?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          legal_viability?: string | null
          liability_type?: string | null
          main_company?: string | null
          neighborhood?: string | null
          news_link?: string | null
          notes?: string | null
          qualified_at?: string | null
          sector?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          sync_status?: string | null
          updated_at?: string
          updated_by?: string | null
          victim_age?: number | null
          victim_name?: string | null
          visit_address?: string | null
          visit_city?: string | null
          visit_region?: string | null
          visit_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "kanban_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_instagram_comment_id_fkey"
            columns: ["instagram_comment_id"]
            isOneToOne: false
            referencedRelation: "instagram_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      n8n_automation_logs: {
        Row: {
          action_type: string
          comment_id: string | null
          created_at: string
          error_message: string | null
          id: string
          message_sent: string | null
          metadata: Json | null
          status: string
          user_id: string | null
        }
        Insert: {
          action_type: string
          comment_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_sent?: string | null
          metadata?: Json | null
          status?: string
          user_id?: string | null
        }
        Update: {
          action_type?: string
          comment_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_sent?: string | null
          metadata?: Json | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      n8n_comment_schedules: {
        Row: {
          auto_post: boolean | null
          created_at: string | null
          cron_job_name: string | null
          id: string
          interval_minutes: number
          is_active: boolean | null
          last_run_at: string | null
          max_comments_per_run: number | null
          name: string
          next_run_at: string | null
          tone: string | null
          total_replies: number | null
          total_runs: number | null
          updated_at: string | null
        }
        Insert: {
          auto_post?: boolean | null
          created_at?: string | null
          cron_job_name?: string | null
          id?: string
          interval_minutes?: number
          is_active?: boolean | null
          last_run_at?: string | null
          max_comments_per_run?: number | null
          name: string
          next_run_at?: string | null
          tone?: string | null
          total_replies?: number | null
          total_runs?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_post?: boolean | null
          created_at?: string | null
          cron_job_name?: string | null
          id?: string
          interval_minutes?: number
          is_active?: boolean | null
          last_run_at?: string | null
          max_comments_per_run?: number | null
          name?: string
          next_run_at?: string | null
          tone?: string | null
          total_replies?: number | null
          total_runs?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      outbound_goal_history: {
        Row: {
          achieved_at: string
          achieved_rate: number
          ad_account_id: string | null
          created_at: string
          id: string
          notes: string | null
          period_end: string
          period_start: string
          target_rate: number
          total_replies: number
          total_sent: number
        }
        Insert: {
          achieved_at?: string
          achieved_rate: number
          ad_account_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          period_end: string
          period_start: string
          target_rate: number
          total_replies?: number
          total_sent?: number
        }
        Update: {
          achieved_at?: string
          achieved_rate?: number
          ad_account_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          target_rate?: number
          total_replies?: number
          total_sent?: number
        }
        Relationships: []
      }
      pluggy_connections: {
        Row: {
          connector_name: string | null
          connector_type: string | null
          created_at: string
          custom_name: string | null
          id: string
          last_sync_at: string | null
          pluggy_item_id: string
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connector_name?: string | null
          connector_type?: string | null
          created_at?: string
          custom_name?: string | null
          id?: string
          last_sync_at?: string | null
          pluggy_item_id: string
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connector_name?: string | null
          connector_type?: string | null
          created_at?: string
          custom_name?: string | null
          id?: string
          last_sync_at?: string | null
          pluggy_item_id?: string
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      promoted_posts: {
        Row: {
          ad_account_id: string | null
          ad_id: string | null
          adset_id: string | null
          campaign_id: string | null
          campaign_name: string | null
          clicks: number | null
          comments_count: number | null
          cpc: number | null
          cpm: number | null
          created_at: string
          ctr: number | null
          daily_budget: number | null
          editorial_post_id: string | null
          end_date: string | null
          engagement_rate: number | null
          followers_gained: number | null
          id: string
          impressions: number | null
          last_metrics_sync: string | null
          lead_id: string | null
          lifetime_budget: number | null
          likes_count: number | null
          notes: string | null
          objective: string | null
          placements: string[] | null
          post_id: string | null
          post_platform: string
          post_title: string
          reach: number | null
          saves_count: number | null
          shares_count: number | null
          spend: number | null
          start_date: string | null
          status: string
          targeting_age_max: number | null
          targeting_age_min: number | null
          targeting_custom_audiences: Json | null
          targeting_genders: number[] | null
          targeting_interests: Json | null
          targeting_locations: string[] | null
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          ad_id?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          clicks?: number | null
          comments_count?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          daily_budget?: number | null
          editorial_post_id?: string | null
          end_date?: string | null
          engagement_rate?: number | null
          followers_gained?: number | null
          id?: string
          impressions?: number | null
          last_metrics_sync?: string | null
          lead_id?: string | null
          lifetime_budget?: number | null
          likes_count?: number | null
          notes?: string | null
          objective?: string | null
          placements?: string[] | null
          post_id?: string | null
          post_platform?: string
          post_title: string
          reach?: number | null
          saves_count?: number | null
          shares_count?: number | null
          spend?: number | null
          start_date?: string | null
          status?: string
          targeting_age_max?: number | null
          targeting_age_min?: number | null
          targeting_custom_audiences?: Json | null
          targeting_genders?: number[] | null
          targeting_interests?: Json | null
          targeting_locations?: string[] | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          ad_id?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          clicks?: number | null
          comments_count?: number | null
          cpc?: number | null
          cpm?: number | null
          created_at?: string
          ctr?: number | null
          daily_budget?: number | null
          editorial_post_id?: string | null
          end_date?: string | null
          engagement_rate?: number | null
          followers_gained?: number | null
          id?: string
          impressions?: number | null
          last_metrics_sync?: string | null
          lead_id?: string | null
          lifetime_budget?: number | null
          likes_count?: number | null
          notes?: string | null
          objective?: string | null
          placements?: string[] | null
          post_id?: string | null
          post_platform?: string
          post_title?: string
          reach?: number | null
          saves_count?: number | null
          shares_count?: number | null
          spend?: number | null
          start_date?: string | null
          status?: string
          targeting_age_max?: number | null
          targeting_age_min?: number | null
          targeting_custom_audiences?: Json | null
          targeting_genders?: number[] | null
          targeting_interests?: Json | null
          targeting_locations?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promoted_posts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_groups: {
        Row: {
          card_last_digits: string | null
          category_id: string | null
          created_at: string
          description: string
          id: string
          merchant_cnpj: string | null
          merchant_name: string | null
          original_purchase_date: string
          paid_installments: number
          pending_amount: number
          total_amount: number
          total_installments: number
          updated_at: string
          user_id: string
        }
        Insert: {
          card_last_digits?: string | null
          category_id?: string | null
          created_at?: string
          description: string
          id?: string
          merchant_cnpj?: string | null
          merchant_name?: string | null
          original_purchase_date: string
          paid_installments?: number
          pending_amount?: number
          total_amount: number
          total_installments?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          card_last_digits?: string | null
          category_id?: string | null
          created_at?: string
          description?: string
          id?: string
          merchant_cnpj?: string | null
          merchant_name?: string | null
          original_purchase_date?: string
          paid_installments?: number
          pending_amount?: number
          total_amount?: number
          total_installments?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_groups_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      team_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      transaction_category_overrides: {
        Row: {
          category_id: string
          contact_id: string | null
          cost_account_id: string | null
          created_at: string
          id: string
          lead_id: string | null
          link_acknowledged: boolean
          manual_city: string | null
          manual_state: string | null
          notes: string | null
          transaction_id: string
        }
        Insert: {
          category_id: string
          contact_id?: string | null
          cost_account_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          link_acknowledged?: boolean
          manual_city?: string | null
          manual_state?: string | null
          notes?: string | null
          transaction_id: string
        }
        Update: {
          category_id?: string
          contact_id?: string | null
          cost_account_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          link_acknowledged?: boolean
          manual_city?: string | null
          manual_state?: string | null
          notes?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_category_overrides_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_category_overrides_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_category_overrides_cost_account_id_fkey"
            columns: ["cost_account_id"]
            isOneToOne: false
            referencedRelation: "cost_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_category_overrides_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_category_overrides_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "credit_card_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_activity_log: {
        Row: {
          action_type: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      user_card_permissions: {
        Row: {
          card_last_digits: string
          created_at: string
          granted_by: string | null
          id: string
          pluggy_account_id: string | null
          user_id: string
        }
        Insert: {
          card_last_digits: string
          created_at?: string
          granted_by?: string | null
          id?: string
          pluggy_account_id?: string | null
          user_id: string
        }
        Update: {
          card_last_digits?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          pluggy_account_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          duration_seconds: number | null
          end_reason: string | null
          ended_at: string | null
          id: string
          last_activity_at: string
          started_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number | null
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          last_activity_at?: string
          started_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number | null
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          last_activity_at?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      weekly_evaluations: {
        Row: {
          comments: string | null
          communication_score: number | null
          created_at: string
          evaluated_id: string
          evaluator_id: string
          id: string
          improvements: string | null
          is_self_evaluation: boolean
          overall_score: number | null
          proactivity_score: number | null
          punctuality_score: number | null
          quality_score: number | null
          strengths: string | null
          teamwork_score: number | null
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          comments?: string | null
          communication_score?: number | null
          created_at?: string
          evaluated_id: string
          evaluator_id: string
          id?: string
          improvements?: string | null
          is_self_evaluation?: boolean
          overall_score?: number | null
          proactivity_score?: number | null
          punctuality_score?: number | null
          quality_score?: number | null
          strengths?: string | null
          teamwork_score?: number | null
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          comments?: string | null
          communication_score?: number | null
          created_at?: string
          evaluated_id?: string
          evaluator_id?: string
          id?: string
          improvements?: string | null
          is_self_evaluation?: boolean
          overall_score?: number | null
          proactivity_score?: number | null
          punctuality_score?: number | null
          quality_score?: number | null
          strengths?: string | null
          teamwork_score?: number | null
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      workflow_daily_goals: {
        Row: {
          created_at: string
          goal_date: string
          id: string
          target_dms: number | null
          target_leads: number | null
          target_replies: number | null
          target_session_minutes: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          goal_date?: string
          id?: string
          target_dms?: number | null
          target_leads?: number | null
          target_replies?: number | null
          target_session_minutes?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          goal_date?: string
          id?: string
          target_dms?: number | null
          target_leads?: number | null
          target_replies?: number | null
          target_session_minutes?: number | null
          user_id?: string
        }
        Relationships: []
      }
      workflow_reports: {
        Row: {
          actions_detail: Json | null
          created_at: string
          dms_sent: number
          duration_seconds: number
          ended_at: string
          follows_count: number
          id: string
          leads_created: number
          registrations_count: number
          replies_count: number
          skips_count: number
          started_at: string
          total_comments: number
          user_id: string | null
        }
        Insert: {
          actions_detail?: Json | null
          created_at?: string
          dms_sent?: number
          duration_seconds: number
          ended_at: string
          follows_count?: number
          id?: string
          leads_created?: number
          registrations_count?: number
          replies_count?: number
          skips_count?: number
          started_at: string
          total_comments?: number
          user_id?: string | null
        }
        Update: {
          actions_detail?: Json | null
          created_at?: string
          dms_sent?: number
          duration_seconds?: number
          ended_at?: string
          follows_count?: number
          id?: string
          leads_created?: number
          registrations_count?: number
          replies_count?: number
          skips_count?: number
          started_at?: string
          total_comments?: number
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_view_card: {
        Args: { _card_last_digits: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "member"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
