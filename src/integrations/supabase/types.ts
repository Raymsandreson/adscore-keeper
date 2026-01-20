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
          prospect_classification: string[] | null
          prospect_name: string | null
          replied_at: string | null
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
          prospect_classification?: string[] | null
          prospect_name?: string | null
          replied_at?: string | null
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
          prospect_classification?: string[] | null
          prospect_name?: string | null
          replied_at?: string | null
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
      leads: {
        Row: {
          ad_account_id: string | null
          ad_name: string | null
          ad_spend_at_conversion: number | null
          ad_start_date: string | null
          adset_id: string | null
          adset_name: string | null
          became_client_date: string | null
          campaign_id: string | null
          campaign_name: string | null
          city: string | null
          classification_date: string | null
          client_classification: string | null
          conversion_value: number | null
          converted_at: string | null
          created_at: string
          creative_id: string | null
          creative_name: string | null
          facebook_lead_id: string | null
          id: string
          instagram_comment_id: string | null
          instagram_username: string | null
          is_follower: boolean | null
          last_sync_at: string | null
          lead_email: string | null
          lead_name: string | null
          lead_phone: string | null
          neighborhood: string | null
          notes: string | null
          qualified_at: string | null
          source: string | null
          state: string | null
          status: string | null
          sync_status: string | null
          updated_at: string
        }
        Insert: {
          ad_account_id?: string | null
          ad_name?: string | null
          ad_spend_at_conversion?: number | null
          ad_start_date?: string | null
          adset_id?: string | null
          adset_name?: string | null
          became_client_date?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          city?: string | null
          classification_date?: string | null
          client_classification?: string | null
          conversion_value?: number | null
          converted_at?: string | null
          created_at?: string
          creative_id?: string | null
          creative_name?: string | null
          facebook_lead_id?: string | null
          id?: string
          instagram_comment_id?: string | null
          instagram_username?: string | null
          is_follower?: boolean | null
          last_sync_at?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          neighborhood?: string | null
          notes?: string | null
          qualified_at?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          sync_status?: string | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string | null
          ad_name?: string | null
          ad_spend_at_conversion?: number | null
          ad_start_date?: string | null
          adset_id?: string | null
          adset_name?: string | null
          became_client_date?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          city?: string | null
          classification_date?: string | null
          client_classification?: string | null
          conversion_value?: number | null
          converted_at?: string | null
          created_at?: string
          creative_id?: string | null
          creative_name?: string | null
          facebook_lead_id?: string | null
          id?: string
          instagram_comment_id?: string | null
          instagram_username?: string | null
          is_follower?: boolean | null
          last_sync_at?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          neighborhood?: string | null
          notes?: string | null
          qualified_at?: string | null
          source?: string | null
          state?: string | null
          status?: string | null
          sync_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_instagram_comment_id_fkey"
            columns: ["instagram_comment_id"]
            isOneToOne: false
            referencedRelation: "instagram_comments"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
