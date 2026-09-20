export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      actor_profile_revisions: {
        Row: {
          actor_profile_id: string
          content: Json
          id: string
          published_at: string
          revision_number: number
        }
        Insert: {
          actor_profile_id: string
          content: Json
          id?: string
          published_at?: string
          revision_number: number
        }
        Update: {
          actor_profile_id?: string
          content?: Json
          id?: string
          published_at?: string
          revision_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "actor_profile_revisions_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "actor_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      actor_profiles: {
        Row: {
          bio: string
          created_at: string
          display_name: string
          draft_content: Json
          id: string
          published_revision_id: string | null
          slug: string
          status: Database["public"]["Enums"]["actor_profile_status"]
          student_id: string
          updated_at: string
          version: number
        }
        Insert: {
          bio?: string
          created_at?: string
          display_name: string
          draft_content?: Json
          id?: string
          published_revision_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["actor_profile_status"]
          student_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          bio?: string
          created_at?: string
          display_name?: string
          draft_content?: Json
          id?: string
          published_revision_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["actor_profile_status"]
          student_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "actor_profiles_published_revision_id_fkey"
            columns: ["published_revision_id"]
            isOneToOne: false
            referencedRelation: "actor_profile_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actor_profiles_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: true
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          activity_config: Json
          activity_type: string
          category: string
          created_at: string
          details: string
          due_at: string | null
          group_key: string | null
          help_requested: boolean
          id: string
          lesson_id: string | null
          priority: number
          progress: number
          responses: Json
          status: Database["public"]["Enums"]["assignment_status"]
          student_id: string
          student_response: string
          tags: string[]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          activity_config?: Json
          activity_type?: string
          category?: string
          created_at?: string
          details?: string
          due_at?: string | null
          group_key?: string | null
          help_requested?: boolean
          id?: string
          lesson_id?: string | null
          priority?: number
          progress?: number
          responses?: Json
          status?: Database["public"]["Enums"]["assignment_status"]
          student_id: string
          student_response?: string
          tags?: string[]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          activity_config?: Json
          activity_type?: string
          category?: string
          created_at?: string
          details?: string
          due_at?: string | null
          group_key?: string | null
          help_requested?: boolean
          id?: string
          lesson_id?: string | null
          priority?: number
          progress?: number
          responses?: Json
          status?: Database["public"]["Enums"]["assignment_status"]
          student_id?: string
          student_response?: string
          tags?: string[]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assignments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          after_state: Json | null
          before_state: Json | null
          correlation_id: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          reason: string
          source: string
          studio_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          correlation_id: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          reason: string
          source: string
          studio_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          correlation_id?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          reason?: string
          source?: string
          studio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          kind: string
          label: string
          service_id: string | null
          starts_at: string
          studio_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          kind: string
          label?: string
          service_id?: string | null
          starts_at: string
          studio_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          kind?: string
          label?: string
          service_id?: string | null
          starts_at?: string
          studio_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          active: boolean
          created_at: string
          ends_at_local: string
          id: string
          service_id: string | null
          starts_at_local: string
          studio_id: string
          timezone: string
          updated_at: string
          version: number
          weekday: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          ends_at_local: string
          id?: string
          service_id?: string | null
          starts_at_local: string
          studio_id: string
          timezone?: string
          updated_at?: string
          version?: number
          weekday: number
        }
        Update: {
          active?: boolean
          created_at?: string
          ends_at_local?: string
          id?: string
          service_id?: string | null
          starts_at_local?: string
          studio_id?: string
          timezone?: string
          updated_at?: string
          version?: number
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_rules_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_admin_overrides: {
        Row: {
          booking_id: string | null
          created_at: string
          created_by: string
          id: string
          override_type: string
          reason: string
          student_id: string | null
          studio_id: string
          value: Json
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          created_by: string
          id?: string
          override_type: string
          reason: string
          student_id?: string | null
          studio_id: string
          value: Json
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          created_by?: string
          id?: string
          override_type?: string
          reason?: string
          student_id?: string | null
          studio_id?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "booking_admin_overrides_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_admin_overrides_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_admin_overrides_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_holds: {
        Row: {
          checkout_session_id: string | null
          created_at: string
          ends_at: string
          expires_at: string
          id: string
          offering_id: string | null
          quantity: number
          service_id: string
          starts_at: string
          status: string
          studio_id: string
        }
        Insert: {
          checkout_session_id?: string | null
          created_at?: string
          ends_at: string
          expires_at?: string
          id?: string
          offering_id?: string | null
          quantity?: number
          service_id: string
          starts_at: string
          status?: string
          studio_id: string
        }
        Update: {
          checkout_session_id?: string | null
          created_at?: string
          ends_at?: string
          expires_at?: string
          id?: string
          offering_id?: string | null
          quantity?: number
          service_id?: string
          starts_at?: string
          status?: string
          studio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_holds_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "service_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_holds_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_holds_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_services: {
        Row: {
          auto_charge_balance: boolean
          balance_due_hours: number | null
          balance_due_timing: string
          booking_horizon_days: number
          buffer_after_minutes: number
          buffer_before_minutes: number
          buffer_by_location: Json
          capacity: number
          category: string
          created_at: string
          currency: string
          default_location: string
          deposit_minor: number
          deposit_percentage: number | null
          deposit_type: string
          description: string
          duration_minutes: number
          id: string
          location_options: string[]
          location_price_adjustments: Json
          minimum_notice_hours: number
          name: string
          payment_policies: string[]
          policy: Json
          policy_version: number
          price_minor: number
          published: boolean
          recurrence_options: string[]
          slot_interval_minutes: number
          slug: string
          studio_id: string
          updated_at: string
          version: number
        }
        Insert: {
          auto_charge_balance?: boolean
          balance_due_hours?: number | null
          balance_due_timing?: string
          booking_horizon_days?: number
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          buffer_by_location?: Json
          capacity?: number
          category: string
          created_at?: string
          currency?: string
          default_location?: string
          deposit_minor?: number
          deposit_percentage?: number | null
          deposit_type?: string
          description?: string
          duration_minutes: number
          id?: string
          location_options?: string[]
          location_price_adjustments?: Json
          minimum_notice_hours?: number
          name: string
          payment_policies?: string[]
          policy?: Json
          policy_version?: number
          price_minor?: number
          published?: boolean
          recurrence_options?: string[]
          slot_interval_minutes?: number
          slug: string
          studio_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          auto_charge_balance?: boolean
          balance_due_hours?: number | null
          balance_due_timing?: string
          booking_horizon_days?: number
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          buffer_by_location?: Json
          capacity?: number
          category?: string
          created_at?: string
          currency?: string
          default_location?: string
          deposit_minor?: number
          deposit_percentage?: number | null
          deposit_type?: string
          description?: string
          duration_minutes?: number
          id?: string
          location_options?: string[]
          location_price_adjustments?: Json
          minimum_notice_hours?: number
          name?: string
          payment_policies?: string[]
          policy?: Json
          policy_version?: number
          price_minor?: number
          published?: boolean
          recurrence_options?: string[]
          slot_interval_minutes?: number
          slug?: string
          studio_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_services_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          admin_override: Json
          auto_charge_balance: boolean
          balance_due_at: string | null
          created_at: string
          currency: string
          discount_code_id: string | null
          discount_minor: number
          ends_at: string
          for_minor: boolean
          guardian_email: string | null
          guardian_name: string | null
          guest_email: string
          guest_name: string
          guest_phone: string | null
          hold_ids: string[]
          id: string
          in_person_location: string | null
          installment_count: number | null
          installment_remainder_minor: number
          installments_paid: number
          location: string
          location_confirmed_at: string | null
          manage_token_hash: string
          offering_id: string | null
          paid_minor: number
          payment_policy: string
          payment_status: string
          policy_snapshot: Json
          portal_requested: boolean
          pricing_snapshot: Json
          reference: string
          referral_code: string | null
          reschedule_count: number
          series_id: string | null
          service_id: string
          starts_at: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          student_id: string | null
          studio_id: string
          terms_accepted_at: string | null
          terms_accepted_by_name: string | null
          terms_version: string | null
          timezone: string
          total_minor: number
          updated_at: string
          version: number
        }
        Insert: {
          admin_override?: Json
          auto_charge_balance?: boolean
          balance_due_at?: string | null
          created_at?: string
          currency?: string
          discount_code_id?: string | null
          discount_minor?: number
          ends_at: string
          for_minor?: boolean
          guardian_email?: string | null
          guardian_name?: string | null
          guest_email: string
          guest_name: string
          guest_phone?: string | null
          hold_ids?: string[]
          id?: string
          in_person_location?: string | null
          installment_count?: number | null
          installment_remainder_minor?: number
          installments_paid?: number
          location: string
          location_confirmed_at?: string | null
          manage_token_hash: string
          offering_id?: string | null
          paid_minor?: number
          payment_policy: string
          payment_status?: string
          policy_snapshot: Json
          portal_requested?: boolean
          pricing_snapshot?: Json
          reference: string
          referral_code?: string | null
          reschedule_count?: number
          series_id?: string | null
          service_id: string
          starts_at: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          student_id?: string | null
          studio_id: string
          terms_accepted_at?: string | null
          terms_accepted_by_name?: string | null
          terms_version?: string | null
          timezone: string
          total_minor: number
          updated_at?: string
          version?: number
        }
        Update: {
          admin_override?: Json
          auto_charge_balance?: boolean
          balance_due_at?: string | null
          created_at?: string
          currency?: string
          discount_code_id?: string | null
          discount_minor?: number
          ends_at?: string
          for_minor?: boolean
          guardian_email?: string | null
          guardian_name?: string | null
          guest_email?: string
          guest_name?: string
          guest_phone?: string | null
          hold_ids?: string[]
          id?: string
          in_person_location?: string | null
          installment_count?: number | null
          installment_remainder_minor?: number
          installments_paid?: number
          location?: string
          location_confirmed_at?: string | null
          manage_token_hash?: string
          offering_id?: string | null
          paid_minor?: number
          payment_policy?: string
          payment_status?: string
          policy_snapshot?: Json
          portal_requested?: boolean
          pricing_snapshot?: Json
          reference?: string
          referral_code?: string | null
          reschedule_count?: number
          series_id?: string | null
          service_id?: string
          starts_at?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          student_id?: string | null
          studio_id?: string
          terms_accepted_at?: string | null
          terms_accepted_by_name?: string | null
          terms_version?: string | null
          timezone?: string
          total_minor?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "bookings_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "service_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "recurring_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          calendar_id: string
          id: string
          last_error: string | null
          last_success_at: string | null
          provider_account: string
          status: string
          studio_id: string
          token_secret_ref: string
          updated_at: string
        }
        Insert: {
          calendar_id: string
          id?: string
          last_error?: string | null
          last_success_at?: string | null
          provider_account: string
          status: string
          studio_id: string
          token_secret_ref: string
          updated_at?: string
        }
        Update: {
          calendar_id?: string
          id?: string
          last_error?: string | null
          last_success_at?: string | null
          provider_account?: string
          status?: string
          studio_id?: string
          token_secret_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: true
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_projections: {
        Row: {
          attempts: number
          conference_request_id: string | null
          external_event_id: string | null
          external_version: string | null
          id: string
          last_error: string | null
          last_projected_at: string | null
          lesson_id: string
          next_attempt_at: string | null
          projected_version: number
          status: string
        }
        Insert: {
          attempts?: number
          conference_request_id?: string | null
          external_event_id?: string | null
          external_version?: string | null
          id?: string
          last_error?: string | null
          last_projected_at?: string | null
          lesson_id: string
          next_attempt_at?: string | null
          projected_version?: number
          status?: string
        }
        Update: {
          attempts?: number
          conference_request_id?: string | null
          external_event_id?: string | null
          external_version?: string | null
          id?: string
          last_error?: string | null
          last_projected_at?: string | null
          lesson_id?: string
          next_attempt_at?: string | null
          projected_version?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_projections_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: true
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          author_name: string
          author_role: string
          author_user_id: string | null
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: string
          legacy_key: string | null
          studio_id: string
        }
        Insert: {
          author_name: string
          author_role: string
          author_user_id?: string | null
          body: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_key?: string | null
          studio_id: string
        }
        Update: {
          author_name?: string
          author_role?: string
          author_user_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          legacy_key?: string | null
          studio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_states: {
        Row: {
          conversation_id: string
          draft_body: string
          last_read_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          draft_body?: string
          last_read_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          draft_body?: string
          last_read_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_states_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          kind: string
          last_message_at: string
          offering_id: string | null
          student_id: string | null
          studio_id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          last_message_at?: string
          offering_id?: string | null
          student_id?: string | null
          studio_id: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          last_message_at?: string
          offering_id?: string | null
          student_id?: string | null
          studio_id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "service_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_attempts: {
        Row: {
          created_at: string
          error: string | null
          id: string
          outbox_message_id: string
          provider: string
          provider_reference: string | null
          response: Json
          succeeded: boolean
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          outbox_message_id: string
          provider: string
          provider_reference?: string | null
          response?: Json
          succeeded: boolean
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          outbox_message_id?: string
          provider?: string
          provider_reference?: string | null
          response?: Json
          succeeded?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "delivery_attempts_outbox_message_id_fkey"
            columns: ["outbox_message_id"]
            isOneToOne: false
            referencedRelation: "outbox_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_codes: {
        Row: {
          active: boolean
          amount: number
          code: string
          created_at: string
          currency: string
          description: string
          discount_type: string
          ends_at: string | null
          id: string
          max_redemptions: number | null
          redemption_count: number
          referral_reward_kind: string | null
          restricted_student_id: string | null
          service_ids: string[]
          starts_at: string | null
          studio_id: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          amount: number
          code: string
          created_at?: string
          currency?: string
          description?: string
          discount_type: string
          ends_at?: string | null
          id?: string
          max_redemptions?: number | null
          redemption_count?: number
          referral_reward_kind?: string | null
          restricted_student_id?: string | null
          service_ids?: string[]
          starts_at?: string | null
          studio_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          amount?: number
          code?: string
          created_at?: string
          currency?: string
          description?: string
          discount_type?: string
          ends_at?: string | null
          id?: string
          max_redemptions?: number | null
          redemption_count?: number
          referral_reward_kind?: string | null
          restricted_student_id?: string | null
          service_ids?: string[]
          starts_at?: string | null
          studio_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "discount_codes_restricted_student_id_fkey"
            columns: ["restricted_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_codes_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_redemptions: {
        Row: {
          amount_minor: number
          booking_id: string
          created_at: string
          discount_code_id: string
          id: string
        }
        Insert: {
          amount_minor: number
          booking_id: string
          created_at?: string
          discount_code_id: string
          id?: string
        }
        Update: {
          amount_minor?: number
          booking_id?: string
          created_at?: string
          discount_code_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discount_redemptions_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discount_redemptions_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: false
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          body_template: string
          created_at: string
          id: string
          idempotency_key: string
          name: string
          recipient_count: number
          studio_id: string
          subject_template: string
        }
        Insert: {
          body_template: string
          created_at?: string
          id?: string
          idempotency_key: string
          name: string
          recipient_count?: number
          studio_id: string
          subject_template: string
        }
        Update: {
          body_template?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          name?: string
          recipient_count?: number
          studio_id?: string
          subject_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      file_assets: {
        Row: {
          bucket_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          file_size_bytes: number
          id: string
          metadata: Json
          mime_type: string
          original_name: string
          owner_student_id: string | null
          storage_path: string
          studio_id: string
          uploaded_by: string
          visibility: string
        }
        Insert: {
          bucket_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          file_size_bytes: number
          id?: string
          metadata?: Json
          mime_type: string
          original_name: string
          owner_student_id?: string | null
          storage_path: string
          studio_id: string
          uploaded_by: string
          visibility?: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          file_size_bytes?: number
          id?: string
          metadata?: Json
          mime_type?: string
          original_name?: string
          owner_student_id?: string | null
          storage_path?: string
          studio_id?: string
          uploaded_by?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_assets_owner_student_id_fkey"
            columns: ["owner_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_assets_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          actor_id: string | null
          command: string
          created_at: string
          expires_at: string
          key: string
          request_hash: string
          response: Json | null
        }
        Insert: {
          actor_id?: string | null
          command: string
          created_at?: string
          expires_at?: string
          key: string
          request_hash: string
          response?: Json | null
        }
        Update: {
          actor_id?: string | null
          command?: string
          created_at?: string
          expires_at?: string
          key?: string
          request_hash?: string
          response?: Json | null
        }
        Relationships: []
      }
      integration_imports: {
        Row: {
          confidence: number
          created_at: string
          detected_source: string
          external_id: string
          id: string
          last_error: string | null
          lesson_id: string | null
          matched_by: string | null
          payload: Json
          provider: string
          status: string
          student_id: string | null
          studio_id: string
          updated_at: string
          verification_note: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          detected_source: string
          external_id: string
          id?: string
          last_error?: string | null
          lesson_id?: string | null
          matched_by?: string | null
          payload?: Json
          provider: string
          status?: string
          student_id?: string | null
          studio_id: string
          updated_at?: string
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          detected_source?: string
          external_id?: string
          id?: string
          last_error?: string | null
          lesson_id?: string | null
          matched_by?: string | null
          payload?: Json
          provider?: string
          status?: string
          student_id?: string | null
          studio_id?: string
          updated_at?: string
          verification_note?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_imports_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_imports_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_imports_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_messages: {
        Row: {
          author_role: string
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          lesson_id: string
          student_id: string
        }
        Insert: {
          author_role: string
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          lesson_id: string
          student_id: string
        }
        Update: {
          author_role?: string
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          lesson_id?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_messages_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_messages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_participants: {
        Row: {
          booking_id: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          lesson_id: string
          status: string
          student_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          display_name: string
          email: string
          id?: string
          lesson_id: string
          status?: string
          student_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          lesson_id?: string
          status?: string
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_participants_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_participants_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_participants_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          capacity: number
          created_at: string
          ends_at: string
          id: string
          imported_at: string | null
          join_url: string | null
          location_label: string
          location_type: string
          meeting_provider: string | null
          offering_id: string | null
          package_id: string | null
          paid_minor: number
          payment_status: string
          preparation: Json
          price_minor: number | null
          series_id: string | null
          service_id: string | null
          source_confidence: number | null
          source_external_id: string | null
          source_provider: string
          starts_at: string
          status: Database["public"]["Enums"]["lesson_status"]
          student_id: string | null
          studio_id: string
          topic: string
          updated_at: string
          version: number
        }
        Insert: {
          capacity?: number
          created_at?: string
          ends_at: string
          id?: string
          imported_at?: string | null
          join_url?: string | null
          location_label: string
          location_type: string
          meeting_provider?: string | null
          offering_id?: string | null
          package_id?: string | null
          paid_minor?: number
          payment_status?: string
          preparation?: Json
          price_minor?: number | null
          series_id?: string | null
          service_id?: string | null
          source_confidence?: number | null
          source_external_id?: string | null
          source_provider?: string
          starts_at: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id?: string | null
          studio_id: string
          topic: string
          updated_at?: string
          version?: number
        }
        Update: {
          capacity?: number
          created_at?: string
          ends_at?: string
          id?: string
          imported_at?: string | null
          join_url?: string | null
          location_label?: string
          location_type?: string
          meeting_provider?: string | null
          offering_id?: string | null
          package_id?: string | null
          paid_minor?: number
          payment_status?: string
          preparation?: Json
          price_minor?: number | null
          series_id?: string | null
          service_id?: string | null
          source_confidence?: number | null
          source_external_id?: string | null
          source_provider?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["lesson_status"]
          student_id?: string | null
          studio_id?: string
          topic?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lessons_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "service_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "recurring_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      linked_contacts: {
        Row: {
          can_manage_lessons: boolean
          can_manage_profile: boolean
          can_receive_notifications: boolean
          can_view_finance: boolean
          can_view_schedule: boolean
          can_view_work: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          notification_preferences: Json
          portal_enabled: boolean
          portal_preferences: Json
          relationship_label: string
          relationship_type: string
          student_id: string
          studio_id: string
          timezone: string | null
          timezone_confirmed: boolean
          updated_at: string
          user_id: string | null
          version: number
        }
        Insert: {
          can_manage_lessons?: boolean
          can_manage_profile?: boolean
          can_receive_notifications?: boolean
          can_view_finance?: boolean
          can_view_schedule?: boolean
          can_view_work?: boolean
          created_at?: string
          email: string
          full_name: string
          id?: string
          notification_preferences?: Json
          portal_enabled?: boolean
          portal_preferences?: Json
          relationship_label?: string
          relationship_type?: string
          student_id: string
          studio_id: string
          timezone?: string | null
          timezone_confirmed?: boolean
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Update: {
          can_manage_lessons?: boolean
          can_manage_profile?: boolean
          can_receive_notifications?: boolean
          can_view_finance?: boolean
          can_view_schedule?: boolean
          can_view_work?: boolean
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          notification_preferences?: Json
          portal_enabled?: boolean
          portal_preferences?: Json
          relationship_label?: string
          relationship_type?: string
          student_id?: string
          studio_id?: string
          timezone?: string | null
          timezone_confirmed?: boolean
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "linked_contacts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linked_contacts_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      mailing_list_contacts: {
        Row: {
          created_at: string
          display_name: string
          email: string
          id: string
          studio_id: string
          unsubscribe_token: string
          unsubscribed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string
          email: string
          id?: string
          studio_id: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          studio_id?: string
          unsubscribe_token?: string
          unsubscribed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailing_list_contacts_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      material_links: {
        Row: {
          created_at: string
          id: string
          lesson_id: string | null
          material_id: string
          role: string
          student_id: string | null
          visible_to_student: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id?: string | null
          material_id: string
          role: string
          student_id?: string | null
          visible_to_student?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string | null
          material_id?: string
          role?: string
          student_id?: string | null
          visible_to_student?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "material_links_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_links_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_links_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      materials: {
        Row: {
          approval_status: Database["public"]["Enums"]["approval_status"]
          caption: string
          category: string
          created_at: string
          external_url: string | null
          file_size_bytes: number | null
          id: string
          media_kind: string
          mime_type: string | null
          owner_student_id: string | null
          public_embed: boolean
          sort_order: number
          status: Database["public"]["Enums"]["material_status"]
          storage_path: string | null
          studio_id: string
          thumbnail_path: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["approval_status"]
          caption?: string
          category?: string
          created_at?: string
          external_url?: string | null
          file_size_bytes?: number | null
          id?: string
          media_kind?: string
          mime_type?: string | null
          owner_student_id?: string | null
          public_embed?: boolean
          sort_order?: number
          status?: Database["public"]["Enums"]["material_status"]
          storage_path?: string | null
          studio_id: string
          thumbnail_path?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["approval_status"]
          caption?: string
          category?: string
          created_at?: string
          external_url?: string | null
          file_size_bytes?: number | null
          id?: string
          media_kind?: string
          mime_type?: string | null
          owner_student_id?: string | null
          public_embed?: boolean
          sort_order?: number
          status?: Database["public"]["Enums"]["material_status"]
          storage_path?: string | null
          studio_id?: string
          thumbnail_path?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "materials_owner_student_id_fkey"
            columns: ["owner_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "materials_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          display_name: string
          id: string
          profile_photo_asset_id: string | null
          profile_photo_position: Json
          role: Database["public"]["Enums"]["studio_role"]
          studio_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          profile_photo_asset_id?: string | null
          profile_photo_position?: Json
          role: Database["public"]["Enums"]["studio_role"]
          studio_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          profile_photo_asset_id?: string | null
          profile_photo_position?: Json
          role?: Database["public"]["Enums"]["studio_role"]
          studio_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_profile_photo_asset_id_fkey"
            columns: ["profile_photo_asset_id"]
            isOneToOne: false
            referencedRelation: "file_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          body: string
          body_html: string | null
          category: string
          created_at: string
          id: string
          lesson_id: string
          pinned: boolean
          published_at: string | null
          rich_content: Json
          status: Database["public"]["Enums"]["content_status"]
          student_id: string
          tags: string[]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          body?: string
          body_html?: string | null
          category?: string
          created_at?: string
          id?: string
          lesson_id: string
          pinned?: boolean
          published_at?: string | null
          rich_content?: Json
          status?: Database["public"]["Enums"]["content_status"]
          student_id: string
          tags?: string[]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          body_html?: string | null
          category?: string
          created_at?: string
          id?: string
          lesson_id?: string
          pinned?: boolean
          published_at?: string | null
          rich_content?: Json
          status?: Database["public"]["Enums"]["content_status"]
          student_id?: string
          tags?: string[]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "notes_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_receipts: {
        Row: {
          created_at: string
          event_key: string
          id: string
          read_at: string
          studio_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_key: string
          id?: string
          read_at?: string
          studio_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_key?: string
          id?: string
          read_at?: string
          studio_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_receipts_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      offering_messages: {
        Row: {
          author_name: string
          author_role: string
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          offering_id: string
          studio_id: string
        }
        Insert: {
          author_name: string
          author_role: string
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          offering_id: string
          studio_id: string
        }
        Update: {
          author_name?: string
          author_role?: string
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          offering_id?: string
          studio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offering_messages_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "service_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offering_messages_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_messages: {
        Row: {
          attempts: number
          body: string
          booking_id: string | null
          campaign_id: string | null
          channel: string
          correlation_id: string | null
          created_at: string
          dedupe_key: string | null
          event_key: string | null
          id: string
          last_error: string | null
          lesson_id: string | null
          next_attempt_at: string | null
          priority: number
          recipient: string
          send_at: string
          status: Database["public"]["Enums"]["delivery_status"]
          student_id: string | null
          studio_id: string
          subject: string
          updated_at: string
          version: number
        }
        Insert: {
          attempts?: number
          body: string
          booking_id?: string | null
          campaign_id?: string | null
          channel: string
          correlation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_key?: string | null
          id?: string
          last_error?: string | null
          lesson_id?: string | null
          next_attempt_at?: string | null
          priority?: number
          recipient: string
          send_at?: string
          status?: Database["public"]["Enums"]["delivery_status"]
          student_id?: string | null
          studio_id: string
          subject?: string
          updated_at?: string
          version?: number
        }
        Update: {
          attempts?: number
          body?: string
          booking_id?: string | null
          campaign_id?: string | null
          channel?: string
          correlation_id?: string | null
          created_at?: string
          dedupe_key?: string | null
          event_key?: string | null
          id?: string
          last_error?: string | null
          lesson_id?: string | null
          next_attempt_at?: string | null
          priority?: number
          recipient?: string
          send_at?: string
          status?: Database["public"]["Enums"]["delivery_status"]
          student_id?: string | null
          studio_id?: string
          subject?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "outbox_messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_messages_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_messages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbox_messages_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      package_billing_options: {
        Row: {
          active: boolean
          balance_threshold: number | null
          created_at: string
          definition_id: string
          id: string
          renewal_mode: string
          stripe_price_id: string | null
          studio_id: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          balance_threshold?: number | null
          created_at?: string
          definition_id: string
          id?: string
          renewal_mode: string
          stripe_price_id?: string | null
          studio_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          balance_threshold?: number | null
          created_at?: string
          definition_id?: string
          id?: string
          renewal_mode?: string
          stripe_price_id?: string | null
          studio_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "package_billing_options_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "package_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_billing_options_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      package_credit_entries: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string | null
          kind: Database["public"]["Enums"]["credit_entry_kind"]
          lesson_id: string | null
          package_id: string
          quantity: number
          reason: string
          reverses_entry_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          kind: Database["public"]["Enums"]["credit_entry_kind"]
          lesson_id?: string | null
          package_id: string
          quantity: number
          reason: string
          reverses_entry_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          kind?: Database["public"]["Enums"]["credit_entry_kind"]
          lesson_id?: string | null
          package_id?: string
          quantity?: number
          reason?: string
          reverses_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_credit_entries_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_credit_entries_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_credit_entries_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: true
            referencedRelation: "package_credit_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      package_definitions: {
        Row: {
          active: boolean
          base_price_minor: number | null
          created_at: string
          currency: string
          delivery_format: string | null
          description: string
          direct_purchase: boolean
          discount_basis_points: number
          discount_minor: number
          discount_type: string
          eligible_service_ids: string[]
          expiration_days: number | null
          giftable: boolean
          id: string
          meeting_providers: string[]
          name: string
          price_minor: number
          pricing_service_id: string | null
          pricing_service_version: number | null
          pricing_status: string
          recurring_eligible: boolean
          session_count: number
          session_duration_minutes: number
          stripe_price_id: string | null
          studio_id: string
          updated_at: string
          version: number
          visibility: string
        }
        Insert: {
          active?: boolean
          base_price_minor?: number | null
          created_at?: string
          currency?: string
          delivery_format?: string | null
          description?: string
          direct_purchase?: boolean
          discount_basis_points?: number
          discount_minor?: number
          discount_type?: string
          eligible_service_ids?: string[]
          expiration_days?: number | null
          giftable?: boolean
          id?: string
          meeting_providers?: string[]
          name: string
          price_minor: number
          pricing_service_id?: string | null
          pricing_service_version?: number | null
          pricing_status?: string
          recurring_eligible?: boolean
          session_count: number
          session_duration_minutes: number
          stripe_price_id?: string | null
          studio_id: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Update: {
          active?: boolean
          base_price_minor?: number | null
          created_at?: string
          currency?: string
          delivery_format?: string | null
          description?: string
          direct_purchase?: boolean
          discount_basis_points?: number
          discount_minor?: number
          discount_type?: string
          eligible_service_ids?: string[]
          expiration_days?: number | null
          giftable?: boolean
          id?: string
          meeting_providers?: string[]
          name?: string
          price_minor?: number
          pricing_service_id?: string | null
          pricing_service_version?: number | null
          pricing_status?: string
          recurring_eligible?: boolean
          session_count?: number
          session_duration_minutes?: number
          stripe_price_id?: string | null
          studio_id?: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_definitions_pricing_service_id_fkey"
            columns: ["pricing_service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_definitions_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      package_gifts: {
        Row: {
          claim_token_hash: string
          claimed_student_id: string | null
          created_at: string
          definition_id: string
          deliver_at: string | null
          expires_at: string
          id: string
          message: string
          package_id: string | null
          purchaser_email: string
          purchaser_name: string
          purchaser_user_id: string | null
          recipient_email: string
          recipient_name: string
          status: string
          stripe_checkout_session_id: string | null
          studio_id: string
          updated_at: string
        }
        Insert: {
          claim_token_hash: string
          claimed_student_id?: string | null
          created_at?: string
          definition_id: string
          deliver_at?: string | null
          expires_at: string
          id?: string
          message?: string
          package_id?: string | null
          purchaser_email: string
          purchaser_name: string
          purchaser_user_id?: string | null
          recipient_email: string
          recipient_name: string
          status?: string
          stripe_checkout_session_id?: string | null
          studio_id: string
          updated_at?: string
        }
        Update: {
          claim_token_hash?: string
          claimed_student_id?: string | null
          created_at?: string
          definition_id?: string
          deliver_at?: string | null
          expires_at?: string
          id?: string
          message?: string
          package_id?: string | null
          purchaser_email?: string
          purchaser_name?: string
          purchaser_user_id?: string | null
          recipient_email?: string
          recipient_name?: string
          status?: string
          stripe_checkout_session_id?: string | null
          studio_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_gifts_claimed_student_id_fkey"
            columns: ["claimed_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_gifts_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "package_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_gifts_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_gifts_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      package_subscriptions: {
        Row: {
          accepted_at: string
          auto_apply: boolean
          balance_threshold: number | null
          billing_option_id: string
          created_at: string
          definition_id: string
          id: string
          last_invoice_id: string | null
          next_billing_at: string | null
          package_id: string | null
          renewal_attempt_key: string | null
          renewal_claimed_at: string | null
          renewal_in_flight: boolean
          renewal_mode: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          student_id: string
          studio_id: string
          updated_at: string
          version: number
        }
        Insert: {
          accepted_at?: string
          auto_apply?: boolean
          balance_threshold?: number | null
          billing_option_id: string
          created_at?: string
          definition_id: string
          id?: string
          last_invoice_id?: string | null
          next_billing_at?: string | null
          package_id?: string | null
          renewal_attempt_key?: string | null
          renewal_claimed_at?: string | null
          renewal_in_flight?: boolean
          renewal_mode: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          student_id: string
          studio_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          accepted_at?: string
          auto_apply?: boolean
          balance_threshold?: number | null
          billing_option_id?: string
          created_at?: string
          definition_id?: string
          id?: string
          last_invoice_id?: string | null
          next_billing_at?: string | null
          package_id?: string | null
          renewal_attempt_key?: string | null
          renewal_claimed_at?: string | null
          renewal_in_flight?: boolean
          renewal_mode?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          student_id?: string
          studio_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "package_subscriptions_billing_option_id_fkey"
            columns: ["billing_option_id"]
            isOneToOne: false
            referencedRelation: "package_billing_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_subscriptions_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "package_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_subscriptions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_subscriptions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_subscriptions_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          auto_apply: boolean
          created_at: string
          credit_quantity: number
          currency: string
          definition_id: string | null
          expires_at: string | null
          id: string
          name: string
          price_minor: number
          stripe_price_id: string | null
          student_id: string
          updated_at: string
          version: number
        }
        Insert: {
          auto_apply?: boolean
          created_at?: string
          credit_quantity?: number
          currency?: string
          definition_id?: string | null
          expires_at?: string | null
          id?: string
          name: string
          price_minor?: number
          stripe_price_id?: string | null
          student_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          auto_apply?: boolean
          created_at?: string
          credit_quantity?: number
          currency?: string
          definition_id?: string | null
          expires_at?: string | null
          id?: string
          name?: string
          price_minor?: number
          stripe_price_id?: string | null
          student_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "packages_definition_id_fkey"
            columns: ["definition_id"]
            isOneToOne: false
            referencedRelation: "package_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_entries: {
        Row: {
          amount_minor: number
          created_at: string
          created_by: string | null
          currency: string
          external_reference: string | null
          id: string
          kind: Database["public"]["Enums"]["payment_entry_kind"]
          package_id: string | null
          reason: string
          student_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          created_by?: string | null
          currency?: string
          external_reference?: string | null
          id?: string
          kind: Database["public"]["Enums"]["payment_entry_kind"]
          package_id?: string | null
          reason: string
          student_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          created_by?: string | null
          currency?: string
          external_reference?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["payment_entry_kind"]
          package_id?: string | null
          reason?: string
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_entries_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_entries_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_accounts: {
        Row: {
          account_type: string
          created_at: string
          email: string
          id: string
          instructions_sent_at: string | null
          linked_contact_id: string | null
          must_change_password: boolean
          student_id: string
          studio_id: string
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          account_type: string
          created_at?: string
          email: string
          id?: string
          instructions_sent_at?: string | null
          linked_contact_id?: string | null
          must_change_password?: boolean
          student_id: string
          studio_id: string
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          account_type?: string
          created_at?: string
          email?: string
          id?: string
          instructions_sent_at?: string | null
          linked_contact_id?: string | null
          must_change_password?: boolean
          student_id?: string
          studio_id?: string
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_accounts_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "linked_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_accounts_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_accounts_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_submissions: {
        Row: {
          actor_profile_id: string
          approval_status: Database["public"]["Enums"]["approval_status"]
          coach_note: string | null
          created_at: string
          id: string
          material_id: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          actor_profile_id: string
          approval_status?: Database["public"]["Enums"]["approval_status"]
          coach_note?: string | null
          created_at?: string
          id?: string
          material_id?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          actor_profile_id?: string
          approval_status?: Database["public"]["Enums"]["approval_status"]
          coach_note?: string | null
          created_at?: string
          id?: string
          material_id?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_submissions_actor_profile_id_fkey"
            columns: ["actor_profile_id"]
            isOneToOne: false
            referencedRelation: "actor_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_submissions_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materials"
            referencedColumns: ["id"]
          },
        ]
      }
      public_endpoint_rate_limits: {
        Row: {
          key: string
          request_count: number
          updated_at: string
          window_ends_at: string
        }
        Insert: {
          key: string
          request_count?: number
          updated_at?: string
          window_ends_at: string
        }
        Update: {
          key?: string
          request_count?: number
          updated_at?: string
          window_ends_at?: string
        }
        Relationships: []
      }
      recommendations: {
        Row: {
          created_at: string
          dedupe_key: string
          due_at: string | null
          entity_id: string | null
          entity_type: string
          evidence: Json
          explanation: string
          id: string
          reason_code: string
          requires_confirmation: boolean
          status: string
          student_id: string | null
          studio_id: string
          suggested_action: string
          title: string
          updated_at: string
          urgency: number
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          due_at?: string | null
          entity_id?: string | null
          entity_type: string
          evidence?: Json
          explanation: string
          id?: string
          reason_code: string
          requires_confirmation?: boolean
          status?: string
          student_id?: string | null
          studio_id: string
          suggested_action: string
          title: string
          updated_at?: string
          urgency: number
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          due_at?: string | null
          entity_id?: string | null
          entity_type?: string
          evidence?: Json
          explanation?: string
          id?: string
          reason_code?: string
          requires_confirmation?: boolean
          status?: string
          student_id?: string | null
          studio_id?: string
          suggested_action?: string
          title?: string
          updated_at?: string
          urgency?: number
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_series: {
        Row: {
          cadence: string
          created_at: string
          discount_minor: number
          ends_on: string | null
          id: string
          kind: string
          meeting_provider: string | null
          next_billing_at: string | null
          occurrence_count: number | null
          paused_at: string | null
          payment_policy: string
          price_minor: number | null
          recurrence_rule: Json
          service_id: string | null
          starts_on: string
          status: string
          stripe_subscription_id: string | null
          student_can_modify: boolean
          student_id: string | null
          studio_id: string
          updated_at: string
          version: number
        }
        Insert: {
          cadence: string
          created_at?: string
          discount_minor?: number
          ends_on?: string | null
          id?: string
          kind: string
          meeting_provider?: string | null
          next_billing_at?: string | null
          occurrence_count?: number | null
          paused_at?: string | null
          payment_policy: string
          price_minor?: number | null
          recurrence_rule?: Json
          service_id?: string | null
          starts_on: string
          status?: string
          stripe_subscription_id?: string | null
          student_can_modify?: boolean
          student_id?: string | null
          studio_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          cadence?: string
          created_at?: string
          discount_minor?: number
          ends_on?: string | null
          id?: string
          kind?: string
          meeting_provider?: string | null
          next_billing_at?: string | null
          occurrence_count?: number | null
          paused_at?: string | null
          payment_policy?: string
          price_minor?: number | null
          recurrence_rule?: Json
          service_id?: string | null
          starts_on?: string
          status?: string
          stripe_subscription_id?: string | null
          student_can_modify?: boolean
          student_id?: string | null
          studio_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurring_series_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_series_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_series_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_rewards: {
        Row: {
          created_at: string
          discount_code_id: string
          earned_booking_id: string
          id: string
          kind: string
          referral_id: string
        }
        Insert: {
          created_at?: string
          discount_code_id: string
          earned_booking_id: string
          id?: string
          kind: string
          referral_id: string
        }
        Update: {
          created_at?: string
          discount_code_id?: string
          earned_booking_id?: string
          id?: string
          kind?: string
          referral_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_discount_code_id_fkey"
            columns: ["discount_code_id"]
            isOneToOne: true
            referencedRelation: "discount_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_earned_booking_id_fkey"
            columns: ["earned_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          created_at: string
          id: string
          referred_email: string
          referred_student_id: string
          referrer_student_id: string
          source_booking_id: string
          studio_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          referred_email: string
          referred_student_id: string
          referrer_student_id: string
          source_booking_id: string
          studio_id: string
        }
        Update: {
          created_at?: string
          id?: string
          referred_email?: string
          referred_student_id?: string
          referrer_student_id?: string
          source_booking_id?: string
          studio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referred_student_id_fkey"
            columns: ["referred_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_student_id_fkey"
            columns: ["referrer_student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_source_booking_id_fkey"
            columns: ["source_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      service_offerings: {
        Row: {
          capacity: number
          created_at: string
          description: string | null
          ends_at: string
          enrolled: number
          enrollment_closes_at: string
          id: string
          lesson_ids: string[]
          meeting_url: string | null
          published: boolean
          resource_links: Json
          service_id: string
          starts_at: string
          studio_id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          capacity: number
          created_at?: string
          description?: string | null
          ends_at: string
          enrolled?: number
          enrollment_closes_at: string
          id?: string
          lesson_ids?: string[]
          meeting_url?: string | null
          published?: boolean
          resource_links?: Json
          service_id: string
          starts_at: string
          studio_id: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          capacity?: number
          created_at?: string
          description?: string | null
          ends_at?: string
          enrolled?: number
          enrollment_closes_at?: string
          id?: string
          lesson_ids?: string[]
          meeting_url?: string | null
          published?: boolean
          resource_links?: Json
          service_id?: string
          starts_at?: string
          studio_id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_offerings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_offerings_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      student_pricing_rules: {
        Row: {
          active: boolean
          created_at: string
          deposit_minor: number | null
          ends_at: string | null
          id: string
          location_price_adjustments: Json
          price_minor: number
          reason: string
          service_id: string | null
          starts_at: string
          student_id: string
          studio_id: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          deposit_minor?: number | null
          ends_at?: string | null
          id?: string
          location_price_adjustments?: Json
          price_minor: number
          reason: string
          service_id?: string | null
          starts_at?: string
          student_id: string
          studio_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          deposit_minor?: number | null
          ends_at?: string | null
          id?: string
          location_price_adjustments?: Json
          price_minor?: number
          reason?: string
          service_id?: string | null
          starts_at?: string
          student_id?: string
          studio_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "student_pricing_rules_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_pricing_rules_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_pricing_rules_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      student_relationships: {
        Row: {
          can_manage_lessons: boolean
          can_manage_profile: boolean
          can_view_finance: boolean
          can_view_schedule: boolean
          can_view_work: boolean
          created_at: string
          id: string
          linked_contact_id: string | null
          relationship: string
          student_id: string
          user_id: string
        }
        Insert: {
          can_manage_lessons?: boolean
          can_manage_profile?: boolean
          can_view_finance?: boolean
          can_view_schedule?: boolean
          can_view_work?: boolean
          created_at?: string
          id?: string
          linked_contact_id?: string | null
          relationship: string
          student_id: string
          user_id: string
        }
        Update: {
          can_manage_lessons?: boolean
          can_manage_profile?: boolean
          can_view_finance?: boolean
          can_view_schedule?: boolean
          can_view_work?: boolean
          created_at?: string
          id?: string
          linked_contact_id?: string | null
          relationship?: string
          student_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_relationships_linked_contact_id_fkey"
            columns: ["linked_contact_id"]
            isOneToOne: false
            referencedRelation: "linked_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_relationships_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          account_balance_minor: number
          actor_page_eligible: boolean
          created_at: string
          default_duration_minutes: number | null
          default_meeting_provider: string | null
          default_rate_minor: number | null
          deleted_at: string | null
          deleted_by: string | null
          drive_folder_url: string | null
          email: string | null
          focus_area: string | null
          full_name: string
          goals: string
          guardian_email: string | null
          guardian_name: string | null
          id: string
          internal_notes: string
          is_minor: boolean
          last_contact_at: string | null
          lead_source: string | null
          notification_preferences: Json
          payment_method_summary: Json
          phone: string | null
          portal_enabled: boolean
          portal_preferences: Json
          portal_username: string | null
          preferred_name: string | null
          profile_photo_asset_id: string | null
          profile_photo_position: Json
          pronouns: string | null
          referral_code: string
          special_pricing_enabled: boolean
          status: Database["public"]["Enums"]["student_status"]
          stripe_customer_id: string | null
          studio_id: string
          tags: string[]
          timezone: string
          timezone_confirmed: boolean
          updated_at: string
          user_id: string | null
          version: number
        }
        Insert: {
          account_balance_minor?: number
          actor_page_eligible?: boolean
          created_at?: string
          default_duration_minutes?: number | null
          default_meeting_provider?: string | null
          default_rate_minor?: number | null
          deleted_at?: string | null
          deleted_by?: string | null
          drive_folder_url?: string | null
          email?: string | null
          focus_area?: string | null
          full_name: string
          goals?: string
          guardian_email?: string | null
          guardian_name?: string | null
          id?: string
          internal_notes?: string
          is_minor?: boolean
          last_contact_at?: string | null
          lead_source?: string | null
          notification_preferences?: Json
          payment_method_summary?: Json
          phone?: string | null
          portal_enabled?: boolean
          portal_preferences?: Json
          portal_username?: string | null
          preferred_name?: string | null
          profile_photo_asset_id?: string | null
          profile_photo_position?: Json
          pronouns?: string | null
          referral_code?: string
          special_pricing_enabled?: boolean
          status?: Database["public"]["Enums"]["student_status"]
          stripe_customer_id?: string | null
          studio_id: string
          tags?: string[]
          timezone?: string
          timezone_confirmed?: boolean
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Update: {
          account_balance_minor?: number
          actor_page_eligible?: boolean
          created_at?: string
          default_duration_minutes?: number | null
          default_meeting_provider?: string | null
          default_rate_minor?: number | null
          deleted_at?: string | null
          deleted_by?: string | null
          drive_folder_url?: string | null
          email?: string | null
          focus_area?: string | null
          full_name?: string
          goals?: string
          guardian_email?: string | null
          guardian_name?: string | null
          id?: string
          internal_notes?: string
          is_minor?: boolean
          last_contact_at?: string | null
          lead_source?: string | null
          notification_preferences?: Json
          payment_method_summary?: Json
          phone?: string | null
          portal_enabled?: boolean
          portal_preferences?: Json
          portal_username?: string | null
          preferred_name?: string | null
          profile_photo_asset_id?: string | null
          profile_photo_position?: Json
          pronouns?: string | null
          referral_code?: string
          special_pricing_enabled?: boolean
          status?: Database["public"]["Enums"]["student_status"]
          stripe_customer_id?: string | null
          studio_id?: string
          tags?: string[]
          timezone?: string
          timezone_confirmed?: boolean
          updated_at?: string
          user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "students_profile_photo_asset_id_fkey"
            columns: ["profile_photo_asset_id"]
            isOneToOne: false
            referencedRelation: "file_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      studios: {
        Row: {
          created_at: string
          id: string
          name: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_conflicts: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          external_payload: Json
          id: string
          internal_version: number
          resolved_at: string | null
          source: string
          status: string
          studio_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          external_payload: Json
          id?: string
          internal_version: number
          resolved_at?: string | null
          source: string
          status?: string
          studio_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          external_payload?: Json
          id?: string
          internal_version?: number
          resolved_at?: string | null
          source?: string
          status?: string
          studio_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_conflicts_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      terms_acceptances: {
        Row: {
          accepted_as_guardian: boolean
          accepted_at: string
          accepted_by_email: string
          accepted_by_name: string
          booking_id: string | null
          id: string
          ip_hash: string | null
          student_id: string | null
          studio_id: string
          user_agent: string | null
          user_id: string | null
          version: string
        }
        Insert: {
          accepted_as_guardian?: boolean
          accepted_at?: string
          accepted_by_email: string
          accepted_by_name: string
          booking_id?: string | null
          id?: string
          ip_hash?: string | null
          student_id?: string | null
          studio_id: string
          user_agent?: string | null
          user_id?: string | null
          version: string
        }
        Update: {
          accepted_as_guardian?: boolean
          accepted_at?: string
          accepted_by_email?: string
          accepted_by_name?: string
          booking_id?: string | null
          id?: string
          ip_hash?: string | null
          student_id?: string | null
          studio_id?: string
          user_agent?: string | null
          user_id?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "terms_acceptances_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_acceptances_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terms_acceptances_studio_id_fkey"
            columns: ["studio_id"]
            isOneToOne: false
            referencedRelation: "studios"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          error: string | null
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          provider: string
          received_at: string
          status: string
        }
        Insert: {
          error?: string | null
          event_type: string
          id: string
          payload: Json
          processed_at?: string | null
          provider: string
          received_at?: string
          status?: string
        }
        Update: {
          error?: string | null
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          provider?: string
          received_at?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      published_actor_profiles: {
        Row: {
          content: Json | null
          display_name: string | null
          published_at: string | null
          slug: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      campaign_delivery_stats: {
        Args: { p_studio_id: string }
        Returns: {
          cancelled_count: number
          created_at: string
          failed_count: number
          id: string
          name: string
          queued_count: number
          recipient_count: number
          sent_count: number
          subject_template: string
        }[]
      }
      can_access_lesson: {
        Args: {
          target_lesson: string
          target_student: string
          target_studio: string
        }
        Returns: boolean
      }
      can_access_student: { Args: { target_student: string }; Returns: boolean }
      can_manage_student_lessons: {
        Args: { target_student: string }
        Returns: boolean
      }
      can_manage_student_profile: {
        Args: { target_student: string }
        Returns: boolean
      }
      can_view_student_finance: {
        Args: { target_student: string }
        Returns: boolean
      }
      can_view_student_schedule: {
        Args: { target_student: string }
        Returns: boolean
      }
      can_view_student_work: {
        Args: { target_student: string }
        Returns: boolean
      }
      claim_booking_discount:
        | {
            Args: {
              target_code: string
              target_service: string
              target_studio: string
              target_subtotal: number
            }
            Returns: {
              code_id: string
              discount_minor: number
            }[]
          }
        | {
            Args: {
              target_code: string
              target_recurrence: string
              target_service: string
              target_student: string
              target_studio: string
              target_subtotal: number
            }
            Returns: {
              code_id: string
              discount_minor: number
            }[]
          }
      claim_booking_reminders: {
        Args: { batch_size?: number }
        Returns: {
          attempts: number
          body: string
          booking_id: string | null
          campaign_id: string | null
          channel: string
          correlation_id: string | null
          created_at: string
          dedupe_key: string | null
          event_key: string | null
          id: string
          last_error: string | null
          lesson_id: string | null
          next_attempt_at: string | null
          priority: number
          recipient: string
          send_at: string
          status: Database["public"]["Enums"]["delivery_status"]
          student_id: string | null
          studio_id: string
          subject: string
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "outbox_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_calendar_projections: {
        Args: { batch_size?: number }
        Returns: {
          lesson: Json
          projection: Json
        }[]
      }
      claim_outbox_messages: {
        Args: { batch_size?: number }
        Returns: {
          attempts: number
          body: string
          booking_id: string | null
          campaign_id: string | null
          channel: string
          correlation_id: string | null
          created_at: string
          dedupe_key: string | null
          event_key: string | null
          id: string
          last_error: string | null
          lesson_id: string | null
          next_attempt_at: string | null
          priority: number
          recipient: string
          send_at: string
          status: Database["public"]["Enums"]["delivery_status"]
          student_id: string | null
          studio_id: string
          subject: string
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "outbox_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_package_auto_renewals: {
        Args: { batch_size?: number }
        Returns: {
          accepted_at: string
          auto_apply: boolean
          balance_threshold: number | null
          billing_option_id: string
          created_at: string
          definition_id: string
          id: string
          last_invoice_id: string | null
          next_billing_at: string | null
          package_id: string | null
          renewal_attempt_key: string | null
          renewal_claimed_at: string | null
          renewal_in_flight: boolean
          renewal_mode: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          student_id: string
          studio_id: string
          updated_at: string
          version: number
        }[]
        SetofOptions: {
          from: "*"
          to: "package_subscriptions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_package_gift: {
        Args: {
          apply_automatically?: boolean
          target_gift: string
          target_student: string
        }
        Returns: Json
      }
      claim_portal_access_by_verified_email: {
        Args: { target_email: string; target_user: string }
        Returns: Json
      }
      claim_public_rate_limit: {
        Args: {
          target_key: string
          target_limit: number
          target_window_seconds: number
        }
        Returns: boolean
      }
      cleanup_transient_studio_data: { Args: never; Returns: Json }
      command_apply_lesson_credit: {
        Args: {
          entry_idempotency_key: string
          entry_reason: string
          requested_package: string
          target_lesson: string
        }
        Returns: Json
      }
      command_approve_outbox: {
        Args: {
          correlation_id: string
          expected_version: number
          idempotency_key: string
          message_id: string
          reason: string
        }
        Returns: Json
      }
      command_change_lesson_state: {
        Args: {
          p_action: string
          p_ends_at?: string
          p_expected_version: number
          p_lesson_id: string
          p_queue_calendar?: boolean
          p_starts_at?: string
        }
        Returns: Json
      }
      command_complete_lesson: {
        Args: {
          correlation_id: string
          expected_version: number
          idempotency_key: string
          lesson_id: string
          reason: string
        }
        Returns: Json
      }
      command_create_lesson: {
        Args: {
          ends_at: string
          location_label: string
          location_type: string
          occurrence_count: number
          recurrence: string
          starts_at: string
          student_email: string
          student_name: string
          target_student: string
          target_studio: string
          timezone: string
          topic: string
        }
        Returns: Json
      }
      command_create_service_offering: {
        Args: {
          enrollment_closes: string
          first_start: string
          occurrence_total?: number
          offering_title: string
          publish_now?: boolean
          seat_capacity: number
          target_service: string
        }
        Returns: {
          capacity: number
          created_at: string
          description: string | null
          ends_at: string
          enrolled: number
          enrollment_closes_at: string
          id: string
          lesson_ids: string[]
          meeting_url: string | null
          published: boolean
          resource_links: Json
          service_id: string
          starts_at: string
          studio_id: string
          title: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "service_offerings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      command_make_lesson_recurring: {
        Args: {
          p_cadence: string
          p_expected_version: number
          p_lesson_id: string
          p_occurrence_count: number
          p_timezone: string
        }
        Returns: Json
      }
      command_remove_student: {
        Args: {
          expected_version: number
          removed_by: string
          target_student: string
        }
        Returns: Json
      }
      command_transition: {
        Args: {
          correlation_id: string
          entity_id: string
          entity_type: string
          expected_version: number
          idempotency_key: string
          next_status: string
          reason: string
        }
        Returns: Json
      }
      command_update_lesson_details: {
        Args: {
          expected_version: number
          next_join_url: string
          next_location_label: string
          next_location_type: string
          next_topic: string
          target_lesson: string
        }
        Returns: {
          capacity: number
          created_at: string
          ends_at: string
          id: string
          imported_at: string | null
          join_url: string | null
          location_label: string
          location_type: string
          meeting_provider: string | null
          offering_id: string | null
          package_id: string | null
          paid_minor: number
          payment_status: string
          preparation: Json
          price_minor: number | null
          series_id: string | null
          service_id: string | null
          source_confidence: number | null
          source_external_id: string | null
          source_provider: string
          starts_at: string
          status: Database["public"]["Enums"]["lesson_status"]
          student_id: string | null
          studio_id: string
          topic: string
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "lessons"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_booking: {
        Args: {
          amount_paid: number
          provider_reference: string
          target_booking: string
          target_hold: string
        }
        Returns: Json
      }
      create_booking_hold: {
        Args: {
          target_end: string
          target_offering: string
          target_service: string
          target_start: string
        }
        Returns: {
          checkout_session_id: string | null
          created_at: string
          ends_at: string
          expires_at: string
          id: string
          offering_id: string | null
          quantity: number
          service_id: string
          starts_at: string
          status: string
          studio_id: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_holds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_booking_series_holds: {
        Args: { target_service: string; target_starts: string[] }
        Returns: string[]
      }
      current_campaign_contacts: {
        Args: { p_studio_id: string }
        Returns: {
          display_name: string
          email: string
        }[]
      }
      expire_booking_holds: { Args: never; Returns: number }
      expire_delinquent_booking: {
        Args: { target_booking: string }
        Returns: Json
      }
      extend_ongoing_series: { Args: never; Returns: number }
      finalize_booking_cancellation: {
        Args: {
          correlation_id: string
          expected_version: number
          refund_amount: number
          refund_reference: string
          target_booking: string
          target_status: string
        }
        Returns: Json
      }
      finalize_subscription_termination: {
        Args: {
          cutoff: string
          installments_complete: boolean
          subscription_id: string
        }
        Returns: Json
      }
      is_studio_coach: { Args: { target_studio: string }; Returns: boolean }
      lesson_payment_status_from_booking: {
        Args: { value: string }
        Returns: string
      }
      merge_studio_students: {
        Args: { keep_student_id: string; remove_student_id: string }
        Returns: Json
      }
      package_credit_balance: {
        Args: { target_package: string }
        Returns: number
      }
      process_stripe_checkout: {
        Args: {
          amount_minor: number
          currency: string
          event_id: string
          event_payload: Json
          event_type: string
          package_id: string
          session_id: string
          student_id: string
        }
        Returns: Json
      }
      queue_email_campaign: {
        Args: {
          p_base_url: string
          p_body_template: string
          p_idempotency_key: string
          p_name: string
          p_studio_id: string
          p_subject_template: string
        }
        Returns: Json
      }
      refund_package_gift: { Args: { target_gift: string }; Returns: Json }
      release_booking_discount: {
        Args: { target_code: string }
        Returns: undefined
      }
      release_offering_seat: {
        Args: { target_offering: string }
        Returns: number
      }
      render_campaign_text: {
        Args: {
          p_email: string
          p_full_name: string
          p_portal_url: string
          p_studio_name: string
          p_template: string
          p_unsubscribe_url: string
        }
        Returns: string
      }
      reschedule_booking_occurrences: {
        Args: {
          change_scope?: string
          expected_version: number
          next_end: string
          next_start: string
          target_booking: string
        }
        Returns: {
          admin_override: Json
          auto_charge_balance: boolean
          balance_due_at: string | null
          created_at: string
          currency: string
          discount_code_id: string | null
          discount_minor: number
          ends_at: string
          for_minor: boolean
          guardian_email: string | null
          guardian_name: string | null
          guest_email: string
          guest_name: string
          guest_phone: string | null
          hold_ids: string[]
          id: string
          in_person_location: string | null
          installment_count: number | null
          installment_remainder_minor: number
          installments_paid: number
          location: string
          location_confirmed_at: string | null
          manage_token_hash: string
          offering_id: string | null
          paid_minor: number
          payment_policy: string
          payment_status: string
          policy_snapshot: Json
          portal_requested: boolean
          pricing_snapshot: Json
          reference: string
          referral_code: string | null
          reschedule_count: number
          series_id: string | null
          service_id: string
          starts_at: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          student_id: string | null
          studio_id: string
          terms_accepted_at: string | null
          terms_accepted_by_name: string | null
          terms_version: string | null
          timezone: string
          total_minor: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_package_credit_for_lesson: {
        Args: { p_lesson_id: string; p_package_id?: string; p_reason?: string }
        Returns: string
      }
      student_payment_balance: {
        Args: { target_student: string }
        Returns: number
      }
      studio_storage_health: { Args: never; Returns: Json }
      sync_future_contact_details: {
        Args: {
          p_contact_kind?: string
          p_new_email: string
          p_new_name: string
          p_new_phone?: string
          p_old_email: string
          p_old_name: string
          p_old_phone?: string
          p_student_id: string
        }
        Returns: number
      }
    }
    Enums: {
      actor_profile_status:
        | "draft"
        | "review_requested"
        | "changes_requested"
        | "approved"
        | "published"
        | "archived"
      approval_status:
        | "not_public"
        | "pending_review"
        | "changes_requested"
        | "approved"
        | "removed"
      assignment_status: "assigned" | "in_progress" | "completed" | "reopened"
      content_status: "draft" | "published" | "archived"
      credit_entry_kind:
        | "purchase"
        | "reservation"
        | "consumption"
        | "release"
        | "adjustment"
        | "expiration"
      delivery_status:
        | "draft"
        | "approved"
        | "queued"
        | "sending"
        | "sent"
        | "failed"
        | "cancelled"
      lesson_status:
        | "draft"
        | "scheduled"
        | "completed"
        | "cancelled"
        | "late_cancelled"
        | "no_show"
      material_status: "active" | "vaulted" | "archived"
      payment_entry_kind: "payment" | "refund" | "adjustment"
      reader_request_status:
        | "submitted"
        | "coach_review"
        | "approved"
        | "queued"
        | "sent"
        | "fulfilled"
        | "cancelled"
      student_status: "lead" | "active" | "paused" | "alumni" | "inactive"
      studio_role: "coach" | "student" | "guardian"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      actor_profile_status: [
        "draft",
        "review_requested",
        "changes_requested",
        "approved",
        "published",
        "archived",
      ],
      approval_status: [
        "not_public",
        "pending_review",
        "changes_requested",
        "approved",
        "removed",
      ],
      assignment_status: ["assigned", "in_progress", "completed", "reopened"],
      content_status: ["draft", "published", "archived"],
      credit_entry_kind: [
        "purchase",
        "reservation",
        "consumption",
        "release",
        "adjustment",
        "expiration",
      ],
      delivery_status: [
        "draft",
        "approved",
        "queued",
        "sending",
        "sent",
        "failed",
        "cancelled",
      ],
      lesson_status: [
        "draft",
        "scheduled",
        "completed",
        "cancelled",
        "late_cancelled",
        "no_show",
      ],
      material_status: ["active", "vaulted", "archived"],
      payment_entry_kind: ["payment", "refund", "adjustment"],
      reader_request_status: [
        "submitted",
        "coach_review",
        "approved",
        "queued",
        "sent",
        "fulfilled",
        "cancelled",
      ],
      student_status: ["lead", "active", "paused", "alumni", "inactive"],
      studio_role: ["coach", "student", "guardian"],
    },
  },
} as const
