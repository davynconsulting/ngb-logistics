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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          changed: string[] | null
          id: number
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          record_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          changed?: string[] | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          record_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          changed?: string[] | null
          id?: never
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      containers: {
        Row: {
          condition: string | null
          container_number: string
          created_at: string
          delivery_at: string | null
          delivery_status: Database["public"]["Enums"]["delivery_status"]
          discharge_at: string | null
          empty_return_at: string | null
          gate_out_at: string | null
          id: string
          location_kind: Database["public"]["Enums"]["location_kind"] | null
          location_name: string | null
          operational_status: Database["public"]["Enums"]["shipment_status"]
          return_deadline: string | null
          return_depot: string | null
          return_status: Database["public"]["Enums"]["return_status"]
          seal_number: string | null
          shipment_id: string
          size_type: string | null
          transport_status: Database["public"]["Enums"]["transport_status"]
          updated_at: string
        }
        Insert: {
          condition?: string | null
          container_number: string
          created_at?: string
          delivery_at?: string | null
          delivery_status?: Database["public"]["Enums"]["delivery_status"]
          discharge_at?: string | null
          empty_return_at?: string | null
          gate_out_at?: string | null
          id?: string
          location_kind?: Database["public"]["Enums"]["location_kind"] | null
          location_name?: string | null
          operational_status?: Database["public"]["Enums"]["shipment_status"]
          return_deadline?: string | null
          return_depot?: string | null
          return_status?: Database["public"]["Enums"]["return_status"]
          seal_number?: string | null
          shipment_id: string
          size_type?: string | null
          transport_status?: Database["public"]["Enums"]["transport_status"]
          updated_at?: string
        }
        Update: {
          condition?: string | null
          container_number?: string
          created_at?: string
          delivery_at?: string | null
          delivery_status?: Database["public"]["Enums"]["delivery_status"]
          discharge_at?: string | null
          empty_return_at?: string | null
          gate_out_at?: string | null
          id?: string
          location_kind?: Database["public"]["Enums"]["location_kind"] | null
          location_name?: string | null
          operational_status?: Database["public"]["Enums"]["shipment_status"]
          return_deadline?: string | null
          return_depot?: string | null
          return_status?: Database["public"]["Enums"]["return_status"]
          seal_number?: string | null
          shipment_id?: string
          size_type?: string | null
          transport_status?: Database["public"]["Enums"]["transport_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "containers_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_notes: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          credit_note_number: string
          currency: string
          id: string
          invoice_id: string
          reason: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          credit_note_number: string
          currency: string
          id?: string
          invoice_id: string
          reason: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          credit_note_number?: string
          currency?: string
          id?: string
          invoice_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      document_requirements: {
        Row: {
          client_note: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          due_date: string | null
          id: string
          is_required: boolean
          shipment_id: string
          status: Database["public"]["Enums"]["doc_status"]
          updated_at: string
        }
        Insert: {
          client_note?: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          due_date?: string | null
          id?: string
          is_required?: boolean
          shipment_id: string
          status?: Database["public"]["Enums"]["doc_status"]
          updated_at?: string
        }
        Update: {
          client_note?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          due_date?: string | null
          id?: string
          is_required?: boolean
          shipment_id?: string
          status?: Database["public"]["Enums"]["doc_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_requirements_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          kind: string
          last_number: number
          year: number
        }
        Insert: {
          kind: string
          last_number?: number
          year: number
        }
        Update: {
          kind?: string
          last_number?: number
          year?: number
        }
        Relationships: []
      }
      documents: {
        Row: {
          client_visible: boolean
          container_id: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          id: string
          mime_type: string
          rejection_reason: string | null
          replaces_document_id: string | null
          shipment_id: string
          size_bytes: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string
          verification_status: Database["public"]["Enums"]["verification_status"]
          verified_at: string | null
          verified_by: string | null
          version: number
        }
        Insert: {
          client_visible?: boolean
          container_id?: string | null
          document_type: Database["public"]["Enums"]["document_type"]
          file_name: string
          id?: string
          mime_type: string
          rejection_reason?: string | null
          replaces_document_id?: string | null
          shipment_id: string
          size_bytes: number
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Update: {
          client_visible?: boolean
          container_id?: string | null
          document_type?: Database["public"]["Enums"]["document_type"]
          file_name?: string
          id?: string
          mime_type?: string
          rejection_reason?: string | null
          replaces_document_id?: string | null
          shipment_id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verified_at?: string | null
          verified_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_replaces_document_id_fkey"
            columns: ["replaces_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_contacts: {
        Row: {
          assignment_id: string
          driver_name: string
          driver_phone: string | null
          share_with_client: boolean
        }
        Insert: {
          assignment_id: string
          driver_name: string
          driver_phone?: string | null
          share_with_client?: boolean
        }
        Update: {
          assignment_id?: string
          driver_name?: string
          driver_phone?: string | null
          share_with_client?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "driver_contacts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: true
            referencedRelation: "transport_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      eta_revisions: {
        Row: {
          change_minutes: number | null
          client_visible: boolean
          id: string
          is_material: boolean
          new_eta: string
          notification_state: Database["public"]["Enums"]["notification_state"]
          previous_eta: string | null
          reason: string
          reason_category: Database["public"]["Enums"]["eta_reason_category"]
          revised_at: string
          revised_by: string | null
          shipment_id: string
          threshold_hours: number
        }
        Insert: {
          change_minutes?: number | null
          client_visible?: boolean
          id?: string
          is_material: boolean
          new_eta: string
          notification_state: Database["public"]["Enums"]["notification_state"]
          previous_eta?: string | null
          reason: string
          reason_category: Database["public"]["Enums"]["eta_reason_category"]
          revised_at?: string
          revised_by?: string | null
          shipment_id: string
          threshold_hours: number
        }
        Update: {
          change_minutes?: number | null
          client_visible?: boolean
          id?: string
          is_material?: boolean
          new_eta?: string
          notification_state?: Database["public"]["Enums"]["notification_state"]
          previous_eta?: string | null
          reason?: string
          reason_category?: Database["public"]["Enums"]["eta_reason_category"]
          revised_at?: string
          revised_by?: string | null
          shipment_id?: string
          threshold_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "eta_revisions_revised_by_fkey"
            columns: ["revised_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eta_revisions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      exception_updates: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json | null
          exception_id: string
          id: string
          kind: Database["public"]["Enums"]["exception_update_kind"]
          note: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json | null
          exception_id: string
          id?: string
          kind: Database["public"]["Enums"]["exception_update_kind"]
          note?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json | null
          exception_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["exception_update_kind"]
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exception_updates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_updates_exception_id_fkey"
            columns: ["exception_id"]
            isOneToOne: false
            referencedRelation: "exceptions"
            referencedColumns: ["id"]
          },
        ]
      }
      exceptions: {
        Row: {
          client_message: string | null
          client_visible: boolean
          container_id: string | null
          dedup_key: string | null
          details: string | null
          escalated_at: string | null
          exception_type: Database["public"]["Enums"]["exception_type"]
          id: string
          last_event_id: string | null
          next_action: string | null
          next_follow_up_at: string | null
          opened_at: string
          opened_by: string | null
          owner_id: string | null
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: Database["public"]["Enums"]["exception_severity"]
          shipment_id: string
          sla_rule_id: string | null
          sla_stage: Database["public"]["Enums"]["sla_stage"] | null
          source: Database["public"]["Enums"]["event_source"]
          status: Database["public"]["Enums"]["exception_status"]
          title: string
          updated_at: string
        }
        Insert: {
          client_message?: string | null
          client_visible?: boolean
          container_id?: string | null
          dedup_key?: string | null
          details?: string | null
          escalated_at?: string | null
          exception_type: Database["public"]["Enums"]["exception_type"]
          id?: string
          last_event_id?: string | null
          next_action?: string | null
          next_follow_up_at?: string | null
          opened_at?: string
          opened_by?: string | null
          owner_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["exception_severity"]
          shipment_id: string
          sla_rule_id?: string | null
          sla_stage?: Database["public"]["Enums"]["sla_stage"] | null
          source?: Database["public"]["Enums"]["event_source"]
          status?: Database["public"]["Enums"]["exception_status"]
          title: string
          updated_at?: string
        }
        Update: {
          client_message?: string | null
          client_visible?: boolean
          container_id?: string | null
          dedup_key?: string | null
          details?: string | null
          escalated_at?: string | null
          exception_type?: Database["public"]["Enums"]["exception_type"]
          id?: string
          last_event_id?: string | null
          next_action?: string | null
          next_follow_up_at?: string | null
          opened_at?: string
          opened_by?: string | null
          owner_id?: string | null
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: Database["public"]["Enums"]["exception_severity"]
          shipment_id?: string
          sla_rule_id?: string | null
          sla_stage?: Database["public"]["Enums"]["sla_stage"] | null
          source?: Database["public"]["Enums"]["event_source"]
          status?: Database["public"]["Enums"]["exception_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exceptions_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_last_event_id_fkey"
            columns: ["last_event_id"]
            isOneToOne: false
            referencedRelation: "milestone_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_last_event_id_fkey"
            columns: ["last_event_id"]
            isOneToOne: false
            referencedRelation: "milestone_timeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_sla_rule_id_fkey"
            columns: ["sla_rule_id"]
            isOneToOne: false
            referencedRelation: "sla_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          amount: number | null
          description: string
          id: string
          invoice_id: string
          line_no: number
          quantity: number
          tax_amount: number | null
          tax_rate: number
          unit_price: number
        }
        Insert: {
          amount?: number | null
          description: string
          id?: string
          invoice_id: string
          line_no: number
          quantity: number
          tax_amount?: number | null
          tax_rate?: number
          unit_price: number
        }
        Update: {
          amount?: number | null
          description?: string
          id?: string
          invoice_id?: string
          line_no?: number
          quantity?: number
          tax_amount?: number | null
          tax_rate?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_reminders: {
        Row: {
          balance_due: number
          currency: string
          days_from_due: number
          id: string
          invoice_id: string
          sent_at: string
          stage: number
        }
        Insert: {
          balance_due: number
          currency: string
          days_from_due: number
          id?: string
          invoice_id: string
          sent_at?: string
          stage: number
        }
        Update: {
          balance_due?: number
          currency?: string
          days_from_due?: number
          id?: string
          invoice_id?: string
          sent_at?: string
          stage?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_reminders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_credited: number
          amount_paid: number
          balance_due: number
          client_id: string
          client_note: string | null
          created_at: string
          created_by: string | null
          currency: string
          dispute_reason: string | null
          disputed_at: string | null
          disputed_by: string | null
          due_date: string | null
          id: string
          invoice_number: string | null
          issue_date: string | null
          issued_at: string | null
          issued_by: string | null
          payment_instructions: string | null
          shipment_id: string
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_total: number
          total: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_credited?: number
          amount_paid?: number
          balance_due?: number
          client_id: string
          client_note?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          dispute_reason?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          issued_at?: string | null
          issued_by?: string | null
          payment_instructions?: string | null
          shipment_id: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_credited?: number
          amount_paid?: number
          balance_due?: number
          client_id?: string
          client_note?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          dispute_reason?: string | null
          disputed_at?: string | null
          disputed_by?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          issue_date?: string | null
          issued_at?: string | null
          issued_by?: string | null
          payment_instructions?: string | null
          shipment_id?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_total?: number
          total?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_disputed_by_fkey"
            columns: ["disputed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_catalogue: {
        Row: {
          allowed_roles: Database["public"]["Enums"]["app_role"][]
          client_visible_default: boolean
          label: string
          milestone_type: Database["public"]["Enums"]["milestone_type"]
          requires_customs:
            | Database["public"]["Enums"]["customs_status"][]
            | null
          requires_location: boolean
          requires_operational:
            | Database["public"]["Enums"]["shipment_status"][]
            | null
          requires_overall:
            | Database["public"]["Enums"]["shipment_status"][]
            | null
          scope: string
          sets_customs: Database["public"]["Enums"]["customs_status"] | null
          sets_delivery: Database["public"]["Enums"]["delivery_status"] | null
          sets_operational:
            | Database["public"]["Enums"]["shipment_status"]
            | null
          sets_overall: Database["public"]["Enums"]["shipment_status"] | null
          sets_return: Database["public"]["Enums"]["return_status"] | null
          sets_transport: Database["public"]["Enums"]["transport_status"] | null
          sort_order: number
        }
        Insert: {
          allowed_roles: Database["public"]["Enums"]["app_role"][]
          client_visible_default?: boolean
          label: string
          milestone_type: Database["public"]["Enums"]["milestone_type"]
          requires_customs?:
            | Database["public"]["Enums"]["customs_status"][]
            | null
          requires_location?: boolean
          requires_operational?:
            | Database["public"]["Enums"]["shipment_status"][]
            | null
          requires_overall?:
            | Database["public"]["Enums"]["shipment_status"][]
            | null
          scope: string
          sets_customs?: Database["public"]["Enums"]["customs_status"] | null
          sets_delivery?: Database["public"]["Enums"]["delivery_status"] | null
          sets_operational?:
            | Database["public"]["Enums"]["shipment_status"]
            | null
          sets_overall?: Database["public"]["Enums"]["shipment_status"] | null
          sets_return?: Database["public"]["Enums"]["return_status"] | null
          sets_transport?:
            | Database["public"]["Enums"]["transport_status"]
            | null
          sort_order: number
        }
        Update: {
          allowed_roles?: Database["public"]["Enums"]["app_role"][]
          client_visible_default?: boolean
          label?: string
          milestone_type?: Database["public"]["Enums"]["milestone_type"]
          requires_customs?:
            | Database["public"]["Enums"]["customs_status"][]
            | null
          requires_location?: boolean
          requires_operational?:
            | Database["public"]["Enums"]["shipment_status"][]
            | null
          requires_overall?:
            | Database["public"]["Enums"]["shipment_status"][]
            | null
          scope?: string
          sets_customs?: Database["public"]["Enums"]["customs_status"] | null
          sets_delivery?: Database["public"]["Enums"]["delivery_status"] | null
          sets_operational?:
            | Database["public"]["Enums"]["shipment_status"]
            | null
          sets_overall?: Database["public"]["Enums"]["shipment_status"] | null
          sets_return?: Database["public"]["Enums"]["return_status"] | null
          sets_transport?:
            | Database["public"]["Enums"]["transport_status"]
            | null
          sort_order?: number
        }
        Relationships: []
      }
      milestone_events: {
        Row: {
          batch_id: string
          client_visible: boolean
          container_id: string | null
          correction_of_event_id: string | null
          correction_reason: string | null
          event_at: string
          evidence_document_ids: string[]
          id: string
          idempotency_key: string | null
          is_override: boolean
          is_void: boolean
          location: string | null
          milestone_type: Database["public"]["Enums"]["milestone_type"]
          new_status: string | null
          notification_state: Database["public"]["Enums"]["notification_state"]
          override_reason: string | null
          previous_state: Json | null
          previous_status: string | null
          public_note: string | null
          recorded_at: string
          recorded_by: string | null
          seal_number: string | null
          shipment_id: string
          source: Database["public"]["Enums"]["event_source"]
          status_track: string | null
        }
        Insert: {
          batch_id: string
          client_visible?: boolean
          container_id?: string | null
          correction_of_event_id?: string | null
          correction_reason?: string | null
          event_at: string
          evidence_document_ids?: string[]
          id?: string
          idempotency_key?: string | null
          is_override?: boolean
          is_void?: boolean
          location?: string | null
          milestone_type: Database["public"]["Enums"]["milestone_type"]
          new_status?: string | null
          notification_state?: Database["public"]["Enums"]["notification_state"]
          override_reason?: string | null
          previous_state?: Json | null
          previous_status?: string | null
          public_note?: string | null
          recorded_at?: string
          recorded_by?: string | null
          seal_number?: string | null
          shipment_id: string
          source?: Database["public"]["Enums"]["event_source"]
          status_track?: string | null
        }
        Update: {
          batch_id?: string
          client_visible?: boolean
          container_id?: string | null
          correction_of_event_id?: string | null
          correction_reason?: string | null
          event_at?: string
          evidence_document_ids?: string[]
          id?: string
          idempotency_key?: string | null
          is_override?: boolean
          is_void?: boolean
          location?: string | null
          milestone_type?: Database["public"]["Enums"]["milestone_type"]
          new_status?: string | null
          notification_state?: Database["public"]["Enums"]["notification_state"]
          override_reason?: string | null
          previous_state?: Json | null
          previous_status?: string | null
          public_note?: string | null
          recorded_at?: string
          recorded_by?: string | null
          seal_number?: string | null
          shipment_id?: string
          source?: Database["public"]["Enums"]["event_source"]
          status_track?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "milestone_events_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_events_correction_of_event_id_fkey"
            columns: ["correction_of_event_id"]
            isOneToOne: false
            referencedRelation: "milestone_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_events_correction_of_event_id_fkey"
            columns: ["correction_of_event_id"]
            isOneToOne: false
            referencedRelation: "milestone_timeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      milestone_internal_notes: {
        Row: {
          batch_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
          shipment_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          shipment_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          shipment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestone_internal_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_internal_notes_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempt_count: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          dedup_key: string
          error_code: string | null
          error_detail: string | null
          id: string
          last_attempt_at: string | null
          locked_until: string | null
          next_attempt_at: string
          notification_id: string
          provider_message_id: string | null
          sent_at: string | null
          state: Database["public"]["Enums"]["delivery_state"]
        }
        Insert: {
          attempt_count?: number
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          dedup_key: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          last_attempt_at?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          notification_id: string
          provider_message_id?: string | null
          sent_at?: string | null
          state?: Database["public"]["Enums"]["delivery_state"]
        }
        Update: {
          attempt_count?: number
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          dedup_key?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          last_attempt_at?: string | null
          locked_until?: string | null
          next_attempt_at?: string
          notification_id?: string
          provider_message_id?: string | null
          sent_at?: string | null
          state?: Database["public"]["Enums"]["delivery_state"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_delivery_attempts: {
        Row: {
          attempted_at: string
          delivery_id: string
          error_code: string | null
          error_detail: string | null
          id: string
          ok: boolean
          provider_message_id: string | null
        }
        Insert: {
          attempted_at?: string
          delivery_id: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          ok: boolean
          provider_message_id?: string | null
        }
        Update: {
          attempted_at?: string
          delivery_id?: string
          error_code?: string | null
          error_detail?: string | null
          id?: string
          ok?: boolean
          provider_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_delivery_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "notification_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          consent_at: string | null
          consent_source: string | null
          locale: string
          push_enabled: boolean
          updated_at: string
          user_id: string
          whatsapp_opt_in: boolean
          whatsapp_phone: string | null
        }
        Insert: {
          consent_at?: string | null
          consent_source?: string | null
          locale?: string
          push_enabled?: boolean
          updated_at?: string
          user_id: string
          whatsapp_opt_in?: boolean
          whatsapp_phone?: string | null
        }
        Update: {
          consent_at?: string | null
          consent_source?: string | null
          locale?: string
          push_enabled?: boolean
          updated_at?: string
          user_id?: string
          whatsapp_opt_in?: boolean
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_rules: {
        Row: {
          audience: Database["public"]["Enums"]["notification_audience"]
          description: string
          push: boolean
          template_key: string
          whatsapp: boolean
        }
        Insert: {
          audience: Database["public"]["Enums"]["notification_audience"]
          description: string
          push: boolean
          template_key: string
          whatsapp: boolean
        }
        Update: {
          audience?: Database["public"]["Enums"]["notification_audience"]
          description?: string
          push?: boolean
          template_key?: string
          whatsapp?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          audience: Database["public"]["Enums"]["notification_audience"]
          created_at: string
          event_key: string
          id: string
          payload: Json
          read_at: string | null
          recipient_id: string
          shipment_id: string | null
          template_key: string
        }
        Insert: {
          audience: Database["public"]["Enums"]["notification_audience"]
          created_at?: string
          event_key: string
          id?: string
          payload?: Json
          read_at?: string | null
          recipient_id: string
          shipment_id?: string | null
          template_key: string
        }
        Update: {
          audience?: Database["public"]["Enums"]["notification_audience"]
          created_at?: string
          event_key?: string
          id?: string
          payload?: Json
          read_at?: string | null
          recipient_id?: string
          shipment_id?: string | null
          template_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["template_key"]
          },
        ]
      }
      organizations: {
        Row: {
          account_manager_id: string | null
          billing_address: string | null
          billing_terms_days: number | null
          client_code: string
          created_at: string
          credit_currency: string | null
          credit_limit: number | null
          email: string | null
          id: string
          is_active: boolean
          is_internal: boolean
          legal_name: string
          payment_reminders: boolean
          phone_e164: string | null
          preferred_language: string
          primary_contact_name: string | null
          show_driver_contact: boolean
          tax_id: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          account_manager_id?: string | null
          billing_address?: string | null
          billing_terms_days?: number | null
          client_code: string
          created_at?: string
          credit_currency?: string | null
          credit_limit?: number | null
          email?: string | null
          id?: string
          is_active?: boolean
          is_internal?: boolean
          legal_name: string
          payment_reminders?: boolean
          phone_e164?: string | null
          preferred_language?: string
          primary_contact_name?: string | null
          show_driver_contact?: boolean
          tax_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          account_manager_id?: string | null
          billing_address?: string | null
          billing_terms_days?: number | null
          client_code?: string
          created_at?: string
          credit_currency?: string | null
          credit_limit?: number | null
          email?: string | null
          id?: string
          is_active?: boolean
          is_internal?: boolean
          legal_name?: string
          payment_reminders?: boolean
          phone_e164?: string | null
          preferred_language?: string
          primary_contact_name?: string | null
          show_driver_contact?: boolean
          tax_id?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_account_manager_fk"
            columns: ["account_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_reviews: {
        Row: {
          decision: Database["public"]["Enums"]["payment_decision"]
          payment_id: string
          reason: string | null
          receipt_number: string | null
          reviewed_at: string
          reviewed_by: string | null
        }
        Insert: {
          decision: Database["public"]["Enums"]["payment_decision"]
          payment_id: string
          reason?: string | null
          receipt_number?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Update: {
          decision?: Database["public"]["Enums"]["payment_decision"]
          payment_id?: string
          reason?: string | null
          receipt_number?: string | null
          reviewed_at?: string
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_reviews_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          currency: string
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          receipt_document_id: string | null
          recorded_at: string
          recorded_by: string | null
          transaction_reference: string | null
        }
        Insert: {
          amount: number
          currency: string
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at: string
          receipt_document_id?: string | null
          recorded_at?: string
          recorded_by?: string | null
          transaction_reference?: string | null
        }
        Update: {
          amount?: number
          currency?: string
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          receipt_document_id?: string | null
          recorded_at?: string
          recorded_by?: string | null
          transaction_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_receipt_document_id_fkey"
            columns: ["receipt_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ports: {
        Row: {
          code: string
          country: string
          created_at: string
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          code: string
          country: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          code?: string
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          last_login_at: string | null
          organization_id: string
          phone_e164: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          is_active?: boolean
          last_login_at?: string | null
          organization_id: string
          phone_e164?: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          last_login_at?: string | null
          organization_id?: string
          phone_e164?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          last_success_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          last_success_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      routes: {
        Row: {
          border_crossing: string | null
          checkpoint_alert_hours: number
          code: string
          created_at: string
          destination_city: string
          destination_country: string
          id: string
          is_active: boolean
          name: string
          origin_port_id: string
          transit_estimate_hours: number
        }
        Insert: {
          border_crossing?: string | null
          checkpoint_alert_hours?: number
          code: string
          created_at?: string
          destination_city: string
          destination_country: string
          id?: string
          is_active?: boolean
          name: string
          origin_port_id: string
          transit_estimate_hours: number
        }
        Update: {
          border_crossing?: string | null
          checkpoint_alert_hours?: number
          code?: string
          created_at?: string
          destination_city?: string
          destination_country?: string
          id?: string
          is_active?: boolean
          name?: string
          origin_port_id?: string
          transit_estimate_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "routes_origin_port_id_fkey"
            columns: ["origin_port_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          shipment_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          shipment_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          shipment_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_assignments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          actual_vessel_arrival: string | null
          assigned_ops_user_id: string
          bl_number: string | null
          booking_reference: string | null
          cargo_description: string | null
          client_id: string
          closed_at: string | null
          created_at: string
          created_by: string | null
          current_eta: string | null
          customs_status: Database["public"]["Enums"]["customs_status"]
          delivery_address: string | null
          delivery_status: Database["public"]["Enums"]["delivery_status"]
          destination_city: string
          destination_country: string
          doc_status: Database["public"]["Enums"]["doc_status"]
          eta_reason: string | null
          eta_updated_at: string | null
          finance_status: Database["public"]["Enums"]["finance_status"]
          gross_weight_kg: number | null
          has_open_exception: boolean
          id: string
          origin_port_id: string
          origin_terminal: string | null
          overall_status: Database["public"]["Enums"]["shipment_status"]
          package_count: number | null
          planned_vessel_arrival: string | null
          return_status: Database["public"]["Enums"]["return_status"]
          shipment_reference: string
          shipping_line: string | null
          transport_status: Database["public"]["Enums"]["transport_status"]
          updated_at: string
          vessel_name: string | null
          voyage_number: string | null
        }
        Insert: {
          actual_vessel_arrival?: string | null
          assigned_ops_user_id?: string
          bl_number?: string | null
          booking_reference?: string | null
          cargo_description?: string | null
          client_id: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_eta?: string | null
          customs_status?: Database["public"]["Enums"]["customs_status"]
          delivery_address?: string | null
          delivery_status?: Database["public"]["Enums"]["delivery_status"]
          destination_city: string
          destination_country: string
          doc_status?: Database["public"]["Enums"]["doc_status"]
          eta_reason?: string | null
          eta_updated_at?: string | null
          finance_status?: Database["public"]["Enums"]["finance_status"]
          gross_weight_kg?: number | null
          has_open_exception?: boolean
          id?: string
          origin_port_id: string
          origin_terminal?: string | null
          overall_status?: Database["public"]["Enums"]["shipment_status"]
          package_count?: number | null
          planned_vessel_arrival?: string | null
          return_status?: Database["public"]["Enums"]["return_status"]
          shipment_reference?: string
          shipping_line?: string | null
          transport_status?: Database["public"]["Enums"]["transport_status"]
          updated_at?: string
          vessel_name?: string | null
          voyage_number?: string | null
        }
        Update: {
          actual_vessel_arrival?: string | null
          assigned_ops_user_id?: string
          bl_number?: string | null
          booking_reference?: string | null
          cargo_description?: string | null
          client_id?: string
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          current_eta?: string | null
          customs_status?: Database["public"]["Enums"]["customs_status"]
          delivery_address?: string | null
          delivery_status?: Database["public"]["Enums"]["delivery_status"]
          destination_city?: string
          destination_country?: string
          doc_status?: Database["public"]["Enums"]["doc_status"]
          eta_reason?: string | null
          eta_updated_at?: string | null
          finance_status?: Database["public"]["Enums"]["finance_status"]
          gross_weight_kg?: number | null
          has_open_exception?: boolean
          id?: string
          origin_port_id?: string
          origin_terminal?: string | null
          overall_status?: Database["public"]["Enums"]["shipment_status"]
          package_count?: number | null
          planned_vessel_arrival?: string | null
          return_status?: Database["public"]["Enums"]["return_status"]
          shipment_reference?: string
          shipping_line?: string | null
          transport_status?: Database["public"]["Enums"]["transport_status"]
          updated_at?: string
          vessel_name?: string | null
          voyage_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_assigned_ops_user_id_fkey"
            columns: ["assigned_ops_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_origin_port_id_fkey"
            columns: ["origin_port_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_rules: {
        Row: {
          created_at: string
          description: string | null
          escalate_after_hours: number
          id: string
          is_active: boolean
          port_id: string | null
          route_id: string | null
          severity: Database["public"]["Enums"]["exception_severity"]
          stage: Database["public"]["Enums"]["sla_stage"]
          threshold_hours: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          escalate_after_hours?: number
          id?: string
          is_active?: boolean
          port_id?: string | null
          route_id?: string | null
          severity?: Database["public"]["Enums"]["exception_severity"]
          stage: Database["public"]["Enums"]["sla_stage"]
          threshold_hours: number
        }
        Update: {
          created_at?: string
          description?: string | null
          escalate_after_hours?: number
          id?: string
          is_active?: boolean
          port_id?: string | null
          route_id?: string | null
          severity?: Database["public"]["Enums"]["exception_severity"]
          stage?: Database["public"]["Enums"]["sla_stage"]
          threshold_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "sla_rules_port_id_fkey"
            columns: ["port_id"]
            isOneToOne: false
            referencedRelation: "ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_rules_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_assignment_containers: {
        Row: {
          assignment_id: string
          container_id: string
        }
        Insert: {
          assignment_id: string
          container_id: string
        }
        Update: {
          assignment_id?: string
          container_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_assignment_containers_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "transport_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_assignment_containers_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
        ]
      }
      transport_assignments: {
        Row: {
          actual_loading_at: string | null
          assigned_at: string
          assigned_by: string | null
          border_crossing: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          driver_user_id: string | null
          id: string
          planned_loading_at: string | null
          route_id: string | null
          shipment_id: string
          status: Database["public"]["Enums"]["assignment_status"]
          trailer_registration: string | null
          transit_document_refs: string[]
          transporter_name: string
          truck_registration: string
        }
        Insert: {
          actual_loading_at?: string | null
          assigned_at?: string
          assigned_by?: string | null
          border_crossing?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          driver_user_id?: string | null
          id?: string
          planned_loading_at?: string | null
          route_id?: string | null
          shipment_id: string
          status?: Database["public"]["Enums"]["assignment_status"]
          trailer_registration?: string | null
          transit_document_refs?: string[]
          transporter_name: string
          truck_registration: string
        }
        Update: {
          actual_loading_at?: string | null
          assigned_at?: string
          assigned_by?: string | null
          border_crossing?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          driver_user_id?: string | null
          id?: string
          planned_loading_at?: string | null
          route_id?: string | null
          shipment_id?: string
          status?: Database["public"]["Enums"]["assignment_status"]
          trailer_registration?: string | null
          transit_document_refs?: string[]
          transporter_name?: string
          truck_registration?: string
        }
        Relationships: [
          {
            foreignKeyName: "transport_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_assignments_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_assignments_driver_user_id_fkey"
            columns: ["driver_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_assignments_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transport_assignments_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      milestone_timeline: {
        Row: {
          batch_id: string | null
          client_visible: boolean | null
          container_id: string | null
          corrected_at: string | null
          corrected_by: string | null
          correction_reason: string | null
          event_at: string | null
          evidence_document_ids: string[] | null
          id: string | null
          is_corrected: boolean | null
          is_override: boolean | null
          is_voided: boolean | null
          location: string | null
          milestone_type: Database["public"]["Enums"]["milestone_type"] | null
          new_status: string | null
          original_event_at: string | null
          override_reason: string | null
          previous_status: string | null
          public_note: string | null
          recorded_at: string | null
          recorded_by: string | null
          seal_number: string | null
          shipment_id: string | null
          source: Database["public"]["Enums"]["event_source"] | null
          status_track: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "milestone_events_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_events_recorded_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_events_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_events_recorded_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_events_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      assign_transport: {
        Args: {
          p_border_crossing?: string
          p_container_ids: string[]
          p_driver_name?: string
          p_driver_phone?: string
          p_driver_user_id?: string
          p_override_reason?: string
          p_planned_loading_at?: string
          p_route_id?: string
          p_shipment_id: string
          p_trailer_registration?: string
          p_transit_document_refs?: string[]
          p_transporter_name: string
          p_truck_registration: string
        }
        Returns: string
      }
      cancel_transport_assignment: {
        Args: { p_assignment_id: string; p_reason: string }
        Returns: undefined
      }
      claim_notification_deliveries: {
        Args: { p_ignore_pause?: boolean; p_limit?: number }
        Returns: {
          attempt_count: number
          channel: Database["public"]["Enums"]["notification_channel"]
          delivery_id: string
          locale: string
          notification_id: string
          payload: Json
          recipient_id: string
          shipment_id: string
          subscriptions: Json
          template_key: string
          timezone: string
          whatsapp_phone: string
        }[]
      }
      client_invoice_activity: {
        Args: { p_invoice_number: string }
        Returns: {
          amount: number
          kind: string
          method: Database["public"]["Enums"]["payment_method"]
          number: string
          occurred_at: string
          transaction_reference: string
          verified: boolean
        }[]
      }
      client_invoice_lines: {
        Args: { p_invoice_number: string }
        Returns: {
          amount: number
          description: string
          line_no: number
          quantity: number
          tax_amount: number
          tax_rate: number
          unit_price: number
        }[]
      }
      client_invoices: {
        Args: { p_invoice_number?: string }
        Returns: {
          amount_credited: number
          amount_paid: number
          awaiting_verification: number
          balance_due: number
          client_note: string
          currency: string
          due_date: string
          invoice_number: string
          issue_date: string
          payment_instructions: string
          shipment_reference: string
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_total: number
          total: number
        }[]
      }
      client_receipt: {
        Args: { p_receipt_number: string }
        Returns: {
          amount: number
          balance_due: number
          client_name: string
          client_tax_id: string
          currency: string
          invoice_number: string
          invoice_total: number
          method: Database["public"]["Enums"]["payment_method"]
          paid_at: string
          receipt_number: string
          shipment_reference: string
          transaction_reference: string
          verified_at: string
        }[]
      }
      client_shipment_alerts: {
        Args: { p_shipment_id: string }
        Returns: {
          alert_id: string
          container_number: string
          exception_type: Database["public"]["Enums"]["exception_type"]
          message: string
          opened_at: string
        }[]
      }
      client_timeline: {
        Args: { p_shipment_id: string }
        Returns: {
          batch_id: string
          containers: string[]
          event_at: string
          is_corrected: boolean
          label: string
          location: string
          milestone_type: Database["public"]["Enums"]["milestone_type"]
          public_note: string
        }[]
      }
      client_transport: {
        Args: { p_shipment_id: string }
        Returns: {
          actual_loading_at: string
          assignment_id: string
          border_crossing: string
          containers: string[]
          driver_name: string
          driver_phone: string
          planned_loading_at: string
          route_name: string
          trailer_registration: string
          transit_estimate_hours: number
          transporter_name: string
          truck_registration: string
        }[]
      }
      complete_notification_delivery: {
        Args: {
          p_dead_endpoints?: string[]
          p_delivery_id: string
          p_error_code?: string
          p_error_detail?: string
          p_ok: boolean
          p_permanent?: boolean
          p_provider_message_id?: string
          p_suppress?: boolean
        }
        Returns: undefined
      }
      correct_milestone: {
        Args: {
          p_event_at?: string
          p_event_id: string
          p_location?: string
          p_public_note?: string
          p_reason: string
          p_void?: boolean
        }
        Returns: string
      }
      driver_job_events: {
        Args: { p_assignment_id: string }
        Returns: {
          container_number: string
          event_at: string
          event_id: string
          label: string
          location: string
          milestone_type: Database["public"]["Enums"]["milestone_type"]
          recorded_by_me: boolean
          source: Database["public"]["Enums"]["event_source"]
        }[]
      }
      driver_jobs: {
        Args: never
        Returns: {
          actual_loading_at: string
          assigned_at: string
          assignment_id: string
          border_crossing: string
          cargo_description: string
          client_allows_contact: boolean
          client_name: string
          containers: Json
          delivery_address: string
          destination_city: string
          destination_country: string
          ops_contact_name: string
          ops_contact_phone: string
          planned_loading_at: string
          route_name: string
          share_with_client: boolean
          shipment_id: string
          shipment_reference: string
          trailer_registration: string
          transit_estimate_hours: number
          transporter_name: string
          truck_registration: string
        }[]
      }
      driver_report_problem: {
        Args: {
          p_assignment_id: string
          p_container_ids?: string[]
          p_idempotency_key?: string
          p_message: string
        }
        Returns: string
      }
      escalate_exception: {
        Args: { p_exception_id: string; p_note: string }
        Returns: undefined
      }
      issue_credit_note: {
        Args: {
          p_amount: number
          p_currency: string
          p_invoice_id: string
          p_reason: string
        }
        Returns: string
      }
      issue_invoice: {
        Args: {
          p_due_date?: string
          p_invoice_id: string
          p_issue_date?: string
        }
        Returns: string
      }
      open_exception: {
        Args: {
          p_client_message?: string
          p_client_visible?: boolean
          p_container_id?: string
          p_details?: string
          p_next_action?: string
          p_next_follow_up_at?: string
          p_owner_id?: string
          p_severity?: Database["public"]["Enums"]["exception_severity"]
          p_shipment_id: string
          p_title: string
          p_type: Database["public"]["Enums"]["exception_type"]
        }
        Returns: string
      }
      record_document: {
        Args: {
          p_client_visible?: boolean
          p_container_id?: string
          p_document_id: string
          p_document_type: Database["public"]["Enums"]["document_type"]
          p_file_name: string
          p_replaces_document_id?: string
          p_shipment_id: string
          p_storage_path: string
        }
        Returns: {
          document_id: string
          version: number
        }[]
      }
      record_milestone: {
        Args: {
          p_client_visible?: boolean
          p_container_ids?: string[]
          p_event_at: string
          p_evidence_document_ids?: string[]
          p_idempotency_key?: string
          p_internal_note?: string
          p_location?: string
          p_location_kind?: Database["public"]["Enums"]["location_kind"]
          p_milestone: Database["public"]["Enums"]["milestone_type"]
          p_override_reason?: string
          p_public_note?: string
          p_seal_number?: string
          p_shipment_id: string
        }
        Returns: {
          container_id: string
          event_id: string
          new_status: string
        }[]
      }
      record_payment: {
        Args: {
          p_amount: number
          p_currency: string
          p_invoice_id: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
          p_paid_at: string
          p_reference?: string
        }
        Returns: string
      }
      register_push_subscription: {
        Args: {
          p_auth: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      register_shipment: {
        Args: {
          p_containers: Json
          p_required_documents?: Database["public"]["Enums"]["document_type"][]
          p_shipment: Json
        }
        Returns: {
          shipment_id: string
          shipment_reference: string
        }[]
      }
      resolve_exception: {
        Args: { p_exception_id: string; p_resolution: string }
        Returns: undefined
      }
      retry_notification_delivery: {
        Args: { p_delivery_id: string }
        Returns: undefined
      }
      review_document: {
        Args: {
          p_decision: Database["public"]["Enums"]["verification_status"]
          p_document_id: string
          p_reason?: string
        }
        Returns: undefined
      }
      review_payment: {
        Args: {
          p_decision: Database["public"]["Enums"]["payment_decision"]
          p_payment_id: string
          p_reason?: string
        }
        Returns: string
      }
      revise_eta: {
        Args: {
          p_client_visible?: boolean
          p_new_eta: string
          p_reason: string
          p_reason_category: Database["public"]["Enums"]["eta_reason_category"]
          p_shipment_id: string
        }
        Returns: {
          material: boolean
          minutes_changed: number
          revision_id: string
        }[]
      }
      run_finance_reminders: {
        Args: never
        Returns: {
          overdue: number
          reminders: number
        }[]
      }
      run_sla_scan: {
        Args: never
        Returns: {
          cleared: number
          escalated: number
          opened: number
        }[]
      }
      save_invoice_draft: {
        Args: {
          p_client_note?: string
          p_currency: string
          p_invoice_id: string
          p_lines: Json
          p_payment_instructions?: string
          p_shipment_id: string
        }
        Returns: string
      }
      set_exception_client_message: {
        Args: { p_exception_id: string; p_message: string; p_visible: boolean }
        Returns: undefined
      }
      set_invoice_dispute: {
        Args: { p_invoice_id: string; p_open: boolean; p_reason?: string }
        Returns: undefined
      }
      set_my_contact_sharing: {
        Args: { p_assignment_id: string; p_share: boolean }
        Returns: undefined
      }
      update_exception: {
        Args: {
          p_exception_id: string
          p_next_action?: string
          p_next_follow_up_at?: string
          p_note?: string
          p_owner_id?: string
          p_severity?: Database["public"]["Enums"]["exception_severity"]
        }
        Returns: undefined
      }
      void_invoice: {
        Args: { p_invoice_id: string; p_reason: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "ops_manager"
        | "doc_officer"
        | "clearing_agent"
        | "transport_coord"
        | "driver"
        | "finance"
        | "client"
      assignment_status: "active" | "cancelled"
      customs_status:
        | "not_started"
        | "entry_in_preparation"
        | "submitted"
        | "inspection"
        | "duties_pending"
        | "released"
        | "on_hold"
      delivery_state: "pending" | "sending" | "sent" | "failed" | "suppressed"
      delivery_status:
        | "pending"
        | "offloading"
        | "delivered"
        | "pod_pending"
        | "pod_received"
      doc_status:
        | "missing"
        | "received"
        | "under_review"
        | "complete"
        | "rejected"
      document_type:
        | "bill_of_lading"
        | "commercial_invoice"
        | "packing_list"
        | "certificate_of_origin"
        | "delivery_order"
        | "customs_entry"
        | "release_order"
        | "gate_pass"
        | "transit_document"
        | "proof_of_delivery"
        | "container_return_receipt"
        | "photo"
        | "invoice"
        | "receipt"
        | "other"
      eta_reason_category:
        | "vessel_delay"
        | "port_congestion"
        | "documents"
        | "customs"
        | "truck_availability"
        | "road_conditions"
        | "border_delay"
        | "weather"
        | "client_request"
        | "schedule_confirmed"
        | "other"
      event_source: "staff" | "driver" | "integration" | "system"
      exception_severity: "low" | "medium" | "high" | "critical"
      exception_status: "open" | "resolved"
      exception_type:
        | "document_missing"
        | "vessel_delay"
        | "port_sla_breach"
        | "dispatch_risk"
        | "customs_hold"
        | "transit_update_missing"
        | "transit_overdue"
        | "delivery_discrepancy"
        | "return_overdue"
        | "other"
      exception_update_kind:
        | "opened"
        | "note"
        | "follow_up"
        | "owner"
        | "severity"
        | "escalated"
        | "resolved"
      finance_status:
        | "not_invoiced"
        | "invoiced"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "disputed"
        | "credit_approved"
      invoice_status:
        | "draft"
        | "issued"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "disputed"
        | "void"
      location_kind: "terminal" | "icd" | "in_transit" | "destination" | "depot"
      milestone_type:
        | "shipment_confirmed"
        | "vessel_arrived"
        | "container_discharged"
        | "port_processing_started"
        | "ready_for_dispatch"
        | "truck_assigned"
        | "loading_started"
        | "loaded"
        | "gate_out"
        | "transit_checkpoint"
        | "arrived_at_border"
        | "border_crossed"
        | "arrived"
        | "offloading_started"
        | "delivered"
        | "pod_received"
        | "empty_returned"
        | "customs_entry_prepared"
        | "customs_submitted"
        | "customs_inspection"
        | "customs_duties_pending"
        | "customs_released"
        | "customs_on_hold"
        | "update"
      notification_audience: "client" | "staff"
      notification_channel: "push" | "whatsapp"
      notification_state: "pending" | "sent" | "failed" | "suppressed"
      payment_decision: "verified" | "rejected"
      payment_method:
        | "bank_transfer"
        | "mobile_money"
        | "cash"
        | "card"
        | "other"
      return_status:
        | "not_due"
        | "awaiting_empty_return"
        | "returned"
        | "return_overdue"
        | "dispute"
      shipment_status:
        | "draft"
        | "registered"
        | "awaiting_documents"
        | "vessel_arrived"
        | "container_discharged"
        | "port_processing"
        | "ready_for_dispatch"
        | "truck_assigned"
        | "loading"
        | "loaded"
        | "in_transit"
        | "arrived"
        | "delivered"
        | "container_returned"
        | "operationally_complete"
        | "closed"
      sla_stage:
        | "documents"
        | "port_processing"
        | "dispatch"
        | "transit_update"
        | "transit"
        | "empty_return"
      transport_status:
        | "unassigned"
        | "assigned"
        | "awaiting_loading"
        | "loaded"
        | "in_transit"
        | "at_border"
        | "arrived"
        | "delayed"
      verification_status: "pending" | "verified" | "rejected"
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
      app_role: [
        "admin",
        "ops_manager",
        "doc_officer",
        "clearing_agent",
        "transport_coord",
        "driver",
        "finance",
        "client",
      ],
      assignment_status: ["active", "cancelled"],
      customs_status: [
        "not_started",
        "entry_in_preparation",
        "submitted",
        "inspection",
        "duties_pending",
        "released",
        "on_hold",
      ],
      delivery_state: ["pending", "sending", "sent", "failed", "suppressed"],
      delivery_status: [
        "pending",
        "offloading",
        "delivered",
        "pod_pending",
        "pod_received",
      ],
      doc_status: [
        "missing",
        "received",
        "under_review",
        "complete",
        "rejected",
      ],
      document_type: [
        "bill_of_lading",
        "commercial_invoice",
        "packing_list",
        "certificate_of_origin",
        "delivery_order",
        "customs_entry",
        "release_order",
        "gate_pass",
        "transit_document",
        "proof_of_delivery",
        "container_return_receipt",
        "photo",
        "invoice",
        "receipt",
        "other",
      ],
      eta_reason_category: [
        "vessel_delay",
        "port_congestion",
        "documents",
        "customs",
        "truck_availability",
        "road_conditions",
        "border_delay",
        "weather",
        "client_request",
        "schedule_confirmed",
        "other",
      ],
      event_source: ["staff", "driver", "integration", "system"],
      exception_severity: ["low", "medium", "high", "critical"],
      exception_status: ["open", "resolved"],
      exception_type: [
        "document_missing",
        "vessel_delay",
        "port_sla_breach",
        "dispatch_risk",
        "customs_hold",
        "transit_update_missing",
        "transit_overdue",
        "delivery_discrepancy",
        "return_overdue",
        "other",
      ],
      exception_update_kind: [
        "opened",
        "note",
        "follow_up",
        "owner",
        "severity",
        "escalated",
        "resolved",
      ],
      finance_status: [
        "not_invoiced",
        "invoiced",
        "partially_paid",
        "paid",
        "overdue",
        "disputed",
        "credit_approved",
      ],
      invoice_status: [
        "draft",
        "issued",
        "partially_paid",
        "paid",
        "overdue",
        "disputed",
        "void",
      ],
      location_kind: ["terminal", "icd", "in_transit", "destination", "depot"],
      milestone_type: [
        "shipment_confirmed",
        "vessel_arrived",
        "container_discharged",
        "port_processing_started",
        "ready_for_dispatch",
        "truck_assigned",
        "loading_started",
        "loaded",
        "gate_out",
        "transit_checkpoint",
        "arrived_at_border",
        "border_crossed",
        "arrived",
        "offloading_started",
        "delivered",
        "pod_received",
        "empty_returned",
        "customs_entry_prepared",
        "customs_submitted",
        "customs_inspection",
        "customs_duties_pending",
        "customs_released",
        "customs_on_hold",
        "update",
      ],
      notification_audience: ["client", "staff"],
      notification_channel: ["push", "whatsapp"],
      notification_state: ["pending", "sent", "failed", "suppressed"],
      payment_decision: ["verified", "rejected"],
      payment_method: [
        "bank_transfer",
        "mobile_money",
        "cash",
        "card",
        "other",
      ],
      return_status: [
        "not_due",
        "awaiting_empty_return",
        "returned",
        "return_overdue",
        "dispute",
      ],
      shipment_status: [
        "draft",
        "registered",
        "awaiting_documents",
        "vessel_arrived",
        "container_discharged",
        "port_processing",
        "ready_for_dispatch",
        "truck_assigned",
        "loading",
        "loaded",
        "in_transit",
        "arrived",
        "delivered",
        "container_returned",
        "operationally_complete",
        "closed",
      ],
      sla_stage: [
        "documents",
        "port_processing",
        "dispatch",
        "transit_update",
        "transit",
        "empty_return",
      ],
      transport_status: [
        "unassigned",
        "assigned",
        "awaiting_loading",
        "loaded",
        "in_transit",
        "at_border",
        "arrived",
        "delayed",
      ],
      verification_status: ["pending", "verified", "rejected"],
    },
  },
} as const
