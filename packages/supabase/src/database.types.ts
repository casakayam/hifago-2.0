export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_table: string
          id: string
          note: string | null
        }
        Insert: {
          action: string
          actor_id: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table: string
          id?: string
          note?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_blocks: {
        Row: {
          created_at: string
          end_date: string
          establishment_id: string
          id: string
          source_order_line_id: string
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          establishment_id: string
          id?: string
          source_order_line_id: string
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          establishment_id?: string
          id?: string
          source_order_line_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_blocks_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_blocks_source_order_line_id_fkey"
            columns: ["source_order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_tags: {
        Row: {
          created_at: string
          id: string
          label: Json
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: Json
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: Json
          slug?: string
        }
        Relationships: []
      }
      comm_campaign_targets: {
        Row: {
          account_id: string
          campaign_id: string
          id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          account_id: string
          campaign_id: string
          id?: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          account_id?: string
          campaign_id?: string
          id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "comm_campaign_targets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comm_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comm_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      comm_campaigns: {
        Row: {
          audience: string
          channel: string
          created_at: string
          created_by: string
          id: string
          include_incomplete: boolean
          message_template: string
          status: string
        }
        Insert: {
          audience: string
          channel: string
          created_at?: string
          created_by: string
          id?: string
          include_incomplete?: boolean
          message_template: string
          status?: string
        }
        Update: {
          audience?: string
          channel?: string
          created_at?: string
          created_by?: string
          id?: string
          include_incomplete?: boolean
          message_template?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "comm_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_media: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          sort: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          sort?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          sort?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_media_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_proposals: {
        Row: {
          created_at: string
          establishment_id: string | null
          id: string
          kind: string
          partner_id: string
          payload: Json
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          kind: string
          partner_id: string
          payload: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          kind?: string
          partner_id?: string
          payload?: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "establishment_proposals_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_proposals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_proposals_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      establishments: {
        Row: {
          address: string | null
          created_at: string
          description: Json | null
          id: string
          lat: number | null
          lon: number | null
          name: Json
          operated_directly: boolean
          partner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          description?: Json | null
          id?: string
          lat?: number | null
          lon?: number | null
          name: Json
          operated_directly?: boolean
          partner_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          created_at?: string
          description?: Json | null
          id?: string
          lat?: number | null
          lon?: number | null
          name?: Json
          operated_directly?: boolean
          partner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishments_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          account_id: string | null
          acompte_cop: number
          acompte_pct: number
          app_commission_cop: number
          app_pct: number
          commission_case: string
          created_at: string
          date: string
          id: string
          order_id: string
          price_cop: number
          product_id: string
          qty: number
          referrer_commission_cop: number
          referrer_partner_id: string | null
          referrer_pct: number
          status: string
          total_cop: number
        }
        Insert: {
          account_id?: string | null
          acompte_cop: number
          acompte_pct: number
          app_commission_cop: number
          app_pct: number
          commission_case: string
          created_at?: string
          date: string
          id?: string
          order_id: string
          price_cop: number
          product_id: string
          qty: number
          referrer_commission_cop: number
          referrer_partner_id?: string | null
          referrer_pct: number
          status?: string
          total_cop: number
        }
        Update: {
          account_id?: string | null
          acompte_cop?: number
          acompte_pct?: number
          app_commission_cop?: number
          app_pct?: number
          commission_case?: string
          created_at?: string
          date?: string
          id?: string
          order_id?: string
          price_cop?: number
          product_id?: string
          qty?: number
          referrer_commission_cop?: number
          referrer_partner_id?: string | null
          referrer_pct?: number
          status?: string
          total_cop?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_referrer_partner_id_fkey"
            columns: ["referrer_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          account_id: string | null
          attribution_code: string | null
          attribution_source: string | null
          created_at: string
          holder_email: string | null
          holder_name: string
          holder_phone: string | null
          id: string
          marketing_consent: boolean
          referrer_partner_id: string | null
          status: string
        }
        Insert: {
          account_id?: string | null
          attribution_code?: string | null
          attribution_source?: string | null
          created_at?: string
          holder_email?: string | null
          holder_name: string
          holder_phone?: string | null
          id?: string
          marketing_consent?: boolean
          referrer_partner_id?: string | null
          status?: string
        }
        Update: {
          account_id?: string | null
          attribution_code?: string | null
          attribution_source?: string | null
          created_at?: string
          holder_email?: string | null
          holder_name?: string
          holder_phone?: string | null
          id?: string
          marketing_consent?: boolean
          referrer_partner_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_attribution_code_fkey"
            columns: ["attribution_code"]
            isOneToOne: false
            referencedRelation: "partner_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_referrer_partner_id_fkey"
            columns: ["referrer_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_accounts: {
        Row: {
          created_at: string
          id: string
          partner_id: string | null
          saved_attribution_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          partner_id?: string | null
          saved_attribution_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          partner_id?: string | null
          saved_attribution_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_accounts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_accounts_saved_attribution_code_fkey"
            columns: ["saved_attribution_code"]
            isOneToOne: false
            referencedRelation: "partner_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      partner_capabilities: {
        Row: {
          account_id: string | null
          created_at: string
          establishment_id: string | null
          id: string
          onboarding_completed_at: string | null
          partner_id: string | null
          role: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          establishment_id?: string | null
          id?: string
          onboarding_completed_at?: string | null
          partner_id?: string | null
          role: string
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          establishment_id?: string | null
          id?: string
          onboarding_completed_at?: string | null
          partner_id?: string | null
          role?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_capabilities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_capabilities_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_capabilities_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_codes: {
        Row: {
          active: boolean
          attribution: Json | null
          code: string
          commission_enabled: boolean
          created_at: string
          partner_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          attribution?: Json | null
          code: string
          commission_enabled?: boolean
          created_at?: string
          partner_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          attribution?: Json | null
          code?: string
          commission_enabled?: boolean
          created_at?: string
          partner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_codes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_crm_profile: {
        Row: {
          address: string | null
          bank: Json | null
          barrio: string | null
          commercial_status: string
          created_at: string
          last_contact_at: string | null
          last_payment_at: string | null
          lat: number | null
          lon: number | null
          notes: string | null
          partner_id: string
          rdv_at: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank?: Json | null
          barrio?: string | null
          commercial_status?: string
          created_at?: string
          last_contact_at?: string | null
          last_payment_at?: string | null
          lat?: number | null
          lon?: number | null
          notes?: string | null
          partner_id: string
          rdv_at?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          address?: string | null
          bank?: Json | null
          barrio?: string | null
          commercial_status?: string
          created_at?: string
          last_contact_at?: string | null
          last_payment_at?: string | null
          lat?: number | null
          lon?: number | null
          notes?: string | null
          partner_id?: string
          rdv_at?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_crm_profile_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: true
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_invitations: {
        Row: {
          consumed_at: string | null
          consumed_by_account_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          onboarding_path: string
          partner_hint: Json | null
          partner_id: string | null
          promo_code: string
          status: string
          token_hash: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_by_account_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          onboarding_path: string
          partner_hint?: Json | null
          partner_id?: string | null
          promo_code: string
          status?: string
          token_hash: string
        }
        Update: {
          consumed_at?: string | null
          consumed_by_account_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          onboarding_path?: string
          partner_hint?: Json | null
          partner_id?: string | null
          promo_code?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_invitations_consumed_by_account_id_fkey"
            columns: ["consumed_by_account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_invitations_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_invitations_promo_code_fkey"
            columns: ["promo_code"]
            isOneToOne: false
            referencedRelation: "partner_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      partner_offboarding: {
        Row: {
          capability_revoked_at: string | null
          capability_revoked_by: string | null
          created_at: string
          created_by: string
          id: string
          partner_id: string
          payments_settled_at: string | null
          payments_settled_by: string | null
          payments_settled_note: string | null
          unpublished_at: string | null
          unpublished_by: string | null
        }
        Insert: {
          capability_revoked_at?: string | null
          capability_revoked_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          partner_id: string
          payments_settled_at?: string | null
          payments_settled_by?: string | null
          payments_settled_note?: string | null
          unpublished_at?: string | null
          unpublished_by?: string | null
        }
        Update: {
          capability_revoked_at?: string | null
          capability_revoked_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          partner_id?: string
          payments_settled_at?: string | null
          payments_settled_by?: string | null
          payments_settled_note?: string | null
          unpublished_at?: string | null
          unpublished_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_offboarding_capability_revoked_by_fkey"
            columns: ["capability_revoked_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offboarding_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offboarding_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offboarding_payments_settled_by_fkey"
            columns: ["payments_settled_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offboarding_unpublished_by_fkey"
            columns: ["unpublished_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          created_at: string
          display_name: string
          email: string | null
          entity_type: string
          id: string
          identification_number: string | null
          identification_type: string | null
          legal_name: string | null
          partner_city: string | null
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email?: string | null
          entity_type?: string
          id?: string
          identification_number?: string | null
          identification_type?: string | null
          legal_name?: string | null
          partner_city?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string | null
          entity_type?: string
          id?: string
          identification_number?: string | null
          identification_type?: string | null
          legal_name?: string | null
          partner_city?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pms_reconciliation_entries: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_attempt_at: string | null
          order_line_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          order_line_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          order_line_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_reconciliation_entries_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pms_reconciliation_entries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      product_availability: {
        Row: {
          booked: number
          capacity: number
          date: string
          id: string
          product_id: string
        }
        Insert: {
          booked?: number
          capacity: number
          date: string
          id?: string
          product_id: string
        }
        Update: {
          booked?: number
          capacity?: number
          date?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_availability_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_calendar: {
        Row: {
          closed_slot: string | null
          date: string
          open: boolean
          product_id: string
        }
        Insert: {
          closed_slot?: string | null
          date: string
          open?: boolean
          product_id: string
        }
        Update: {
          closed_slot?: string | null
          date?: string
          open?: boolean
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_calendar_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media: {
        Row: {
          created_at: string
          id: string
          product_id: string
          sort: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          sort?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          sort?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_proposals: {
        Row: {
          created_at: string
          id: string
          kind: string
          partner_id: string
          payload: Json
          product_id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          kind?: string
          partner_id: string
          payload: Json
          product_id: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          partner_id?: string
          payload?: Json
          product_id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_proposals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_proposals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_proposals_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      product_room_types: {
        Row: {
          capacity: number
          created_at: string
          description: Json | null
          id: string
          kind: string
          lobby_category_id: number | null
          lobby_product_id: number | null
          max_qty: number | null
          min_qty: number | null
          name: Json
          price_cop: number
          price_tiers: Json | null
          product_id: string
          quantity: number | null
          sort: number
          stay_rates: Json | null
        }
        Insert: {
          capacity: number
          created_at?: string
          description?: Json | null
          id?: string
          kind: string
          lobby_category_id?: number | null
          lobby_product_id?: number | null
          max_qty?: number | null
          min_qty?: number | null
          name: Json
          price_cop: number
          price_tiers?: Json | null
          product_id: string
          quantity?: number | null
          sort?: number
          stay_rates?: Json | null
        }
        Update: {
          capacity?: number
          created_at?: string
          description?: Json | null
          id?: string
          kind?: string
          lobby_category_id?: number | null
          lobby_product_id?: number | null
          max_qty?: number | null
          min_qty?: number | null
          name?: Json
          price_cop?: number
          price_tiers?: Json | null
          product_id?: string
          quantity?: number | null
          sort?: number
          stay_rates?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "product_room_types_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_slot_rules: {
        Row: {
          capacity: number
          created_at: string
          end_time: string
          id: string
          product_id: string
          slot_duration_minutes: number
          start_time: string
          weekdays: number[]
        }
        Insert: {
          capacity: number
          created_at?: string
          end_time: string
          id?: string
          product_id: string
          slot_duration_minutes: number
          start_time: string
          weekdays: number[]
        }
        Update: {
          capacity?: number
          created_at?: string
          end_time?: string
          id?: string
          product_id?: string
          slot_duration_minutes?: number
          start_time?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "product_slot_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_tag_assignments: {
        Row: {
          created_at: string
          product_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_tag_assignments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "catalog_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          acompte_pct: number
          address: string | null
          calendar_default_open: boolean
          capacity: number | null
          category: string | null
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          description: Json | null
          duration_days: number | null
          duration_minutes: number | null
          establishment_id: string
          external_booking_url: string | null
          id: string
          lat: number | null
          lobby_category_id: number | null
          lobby_product_id: number | null
          lon: number | null
          max_qty: number | null
          max_units: number | null
          min_qty: number | null
          name: Json
          occurrence_date: string | null
          occurrence_type: string | null
          partner_id: string
          price_cop: number | null
          price_label: string | null
          price_tiers: Json | null
          qty_unit: string
          recurrence_end_count: number | null
          recurrence_end_date: string | null
          recurrence_frequency_days: number | null
          referral_pct: number
          schedule: string
          sellable: boolean
          slug: string
          sort: number | null
          start_time: string | null
          stay_rates: Json | null
          type: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          acompte_pct?: number
          address?: string | null
          calendar_default_open?: boolean
          capacity?: number | null
          category?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          description?: Json | null
          duration_days?: number | null
          duration_minutes?: number | null
          establishment_id: string
          external_booking_url?: string | null
          id?: string
          lat?: number | null
          lobby_category_id?: number | null
          lobby_product_id?: number | null
          lon?: number | null
          max_qty?: number | null
          max_units?: number | null
          min_qty?: number | null
          name: Json
          occurrence_date?: string | null
          occurrence_type?: string | null
          partner_id: string
          price_cop?: number | null
          price_label?: string | null
          price_tiers?: Json | null
          qty_unit?: string
          recurrence_end_count?: number | null
          recurrence_end_date?: string | null
          recurrence_frequency_days?: number | null
          referral_pct?: number
          schedule?: string
          sellable?: boolean
          slug: string
          sort?: number | null
          start_time?: string | null
          stay_rates?: Json | null
          type: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          acompte_pct?: number
          address?: string | null
          calendar_default_open?: boolean
          capacity?: number | null
          category?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          description?: Json | null
          duration_days?: number | null
          duration_minutes?: number | null
          establishment_id?: string
          external_booking_url?: string | null
          id?: string
          lat?: number | null
          lobby_category_id?: number | null
          lobby_product_id?: number | null
          lon?: number | null
          max_qty?: number | null
          max_units?: number | null
          min_qty?: number | null
          name?: Json
          occurrence_date?: string | null
          occurrence_type?: string | null
          partner_id?: string
          price_cop?: number | null
          price_label?: string | null
          price_tiers?: Json | null
          qty_unit?: string
          recurrence_end_count?: number | null
          recurrence_end_date?: string | null
          recurrence_frequency_days?: number | null
          referral_pct?: number
          schedule?: string
          sellable?: boolean
          slug?: string
          sort?: number | null
          start_time?: string | null
          stay_rates?: Json | null
          type?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_resource_calendar: {
        Row: {
          booked: number
          capacity: number
          establishment_id: string
          slot_date: string
        }
        Insert: {
          booked?: number
          capacity: number
          establishment_id: string
          slot_date: string
        }
        Update: {
          booked?: number
          capacity?: number
          establishment_id?: string
          slot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_resource_calendar_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      role_agreements: {
        Row: {
          accepted_at: string
          account_id: string
          created_at: string
          document_hash: string | null
          document_version: string
          explicit_consent: boolean
          id: string
          ip: string | null
          partner_id: string
          revoked_at: string | null
          role: string
          signer_name: string
          user_agent: string | null
        }
        Insert: {
          accepted_at?: string
          account_id: string
          created_at?: string
          document_hash?: string | null
          document_version: string
          explicit_consent?: boolean
          id?: string
          ip?: string | null
          partner_id: string
          revoked_at?: string | null
          role: string
          signer_name: string
          user_agent?: string | null
        }
        Update: {
          accepted_at?: string
          account_id?: string
          created_at?: string
          document_hash?: string | null
          document_version?: string
          explicit_consent?: boolean
          id?: string
          ip?: string | null
          partner_id?: string
          revoked_at?: string | null
          role?: string
          signer_name?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_agreements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_agreements_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      room_media: {
        Row: {
          created_at: string
          id: string
          room_type_id: string
          sort: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          room_type_id: string
          sort?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          room_type_id?: string
          sort?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_media_room_type_id_fkey"
            columns: ["room_type_id"]
            isOneToOne: false
            referencedRelation: "product_room_types"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_catalog_media: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_sort?: number
          p_storage_path: string
        }
        Returns: string
      }
      cancel_order: { Args: { p_order_id: string }; Returns: Json }
      check_partner_invitation: { Args: { p_token: string }; Returns: Json }
      consume_partner_invitation: {
        Args: {
          p_document_version: string
          p_ip?: string
          p_signer_name: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      create_campaign: {
        Args: {
          p_audience: string
          p_channel: string
          p_include_incomplete?: boolean
          p_message_template: string
        }
        Returns: Json
      }
      create_establishment: {
        Args: {
          p_address?: string
          p_description?: Json
          p_lat?: number
          p_lon?: number
          p_name: Json
          p_operated_directly?: boolean
          p_partner_id: string
        }
        Returns: string
      }
      create_order: {
        Args: {
          p_attribution_code?: string
          p_attribution_source?: string
          p_holder_email?: string
          p_holder_name: string
          p_holder_phone?: string
          p_lines: Json
          p_marketing_consent?: boolean
        }
        Returns: Json
      }
      create_partner_direct: {
        Args: {
          p_code?: string
          p_commission_enabled?: boolean
          p_crm_profile?: Json
          p_display_name: string
          p_email?: string
          p_entity_type: string
          p_establishment_id?: string
          p_identification_number?: string
          p_identification_type?: string
          p_invitation_expires_days?: number
          p_legal_name?: string
          p_partner_city?: string
          p_phone?: string
          p_roles: string[]
          p_send_invitation?: boolean
        }
        Returns: Json
      }
      create_partner_invitation: {
        Args: {
          p_code: string
          p_expires_days?: number
          p_onboarding_path: string
          p_partner_hint?: Json
        }
        Returns: Json
      }
      delete_product: {
        Args: { p_note?: string; p_product_id: string }
        Returns: undefined
      }
      grant_capability: {
        Args: {
          p_establishment_id?: string
          p_note?: string
          p_partner_id: string
          p_role: string
        }
        Returns: Json
      }
      has_admin_capability: { Args: { uid: string }; Returns: boolean }
      has_capability: {
        Args: { p_establishment_id?: string; p_role: string; uid: string }
        Returns: boolean
      }
      is_admin: { Args: { uid: string }; Returns: boolean }
      list_audience_members: {
        Args: { p_audience: string; p_include_incomplete?: boolean }
        Returns: {
          account_id: string
          email: string
          phone: string
          reachable: boolean
        }[]
      }
      list_clients: {
        Args: {
          p_email?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: {
          client_key: string
          display_name: string
          email: string
          last_order_at: string
          orders_count: number
          phone: string
          total_count: number
        }[]
      }
      log_admin_action: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id: string
          p_entity_table: string
          p_note?: string
        }
        Returns: undefined
      }
      moderate_establishment_proposal: {
        Args: {
          p_corrected_payload?: Json
          p_decision: string
          p_expected_version: number
          p_proposal_id: string
          p_rejection_reason?: string
        }
        Returns: Json
      }
      moderate_product_proposal: {
        Args: {
          p_corrected_payload?: Json
          p_decision: string
          p_expected_version: number
          p_proposal_id: string
          p_rejection_reason?: string
        }
        Returns: Json
      }
      offboarding_attest_payments: {
        Args: { p_note: string; p_offboarding_id: string }
        Returns: Json
      }
      offboarding_revoke_capability: {
        Args: { p_note?: string; p_offboarding_id: string }
        Returns: Json
      }
      offboarding_unpublish: {
        Args: { p_offboarding_id: string }
        Returns: Json
      }
      partner_id_for_account: { Args: { uid: string }; Returns: string }
      process_campaign_batch: {
        Args: { p_batch_size?: number; p_campaign_id: string }
        Returns: Json
      }
      reorder_gallery: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_ordered_media_ids: string[]
        }
        Returns: Json
      }
      resolve_reconciliation_entry: {
        Args: { p_entry_id: string; p_note: string }
        Returns: Json
      }
      revoke_partner_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      set_capability_status: {
        Args: { p_capability_id: string; p_new_status: string; p_note?: string }
        Returns: Json
      }
      set_order_line_status: {
        Args: {
          p_new_status: string
          p_order_line_id: string
          p_reason: string
        }
        Returns: Json
      }
      set_partner_code_active: {
        Args: { p_active: boolean; p_code: string; p_note?: string }
        Returns: Json
      }
      set_product_availability: {
        Args: {
          p_capacity: number
          p_date: string
          p_note?: string
          p_open?: boolean
          p_product_id: string
        }
        Returns: Json
      }
      set_product_sellable: {
        Args: { p_note?: string; p_product_id: string; p_sellable: boolean }
        Returns: undefined
      }
      set_provider_resource_capacity: {
        Args: {
          p_capacity: number
          p_date: string
          p_establishment_id: string
          p_note?: string
        }
        Returns: Json
      }
      start_offboarding: { Args: { p_partner_id: string }; Returns: Json }
      submit_establishment_creation_proposal: {
        Args: { p_payload: Json }
        Returns: Json
      }
      submit_establishment_edit_proposal: {
        Args: { p_establishment_id: string; p_payload: Json }
        Returns: Json
      }
      submit_photos_proposal: {
        Args: { p_product_id: string; p_storage_paths: string[] }
        Returns: Json
      }
      submit_product_proposal: {
        Args: { p_payload: Json; p_product_id: string }
        Returns: Json
      }
      transfer_establishment: {
        Args: {
          p_establishment_id: string
          p_new_partner_id: string
          p_note?: string
        }
        Returns: Json
      }
      update_establishment: {
        Args: {
          p_address?: string
          p_description?: Json
          p_establishment_id: string
          p_lat?: number
          p_lon?: number
          p_name: Json
          p_note?: string
          p_operated_directly?: boolean
        }
        Returns: Json
      }
      withdraw_establishment_proposal: {
        Args: { p_proposal_id: string }
        Returns: Json
      }
      withdraw_product_proposal: {
        Args: { p_proposal_id: string }
        Returns: Json
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

