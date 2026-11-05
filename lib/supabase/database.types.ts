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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      review_document: {
        Args: {
          p_decision: Database["public"]["Enums"]["verification_status"]
          p_document_id: string
          p_reason?: string
        }
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
      customs_status:
        | "not_started"
        | "entry_in_preparation"
        | "submitted"
        | "inspection"
        | "duties_pending"
        | "released"
        | "on_hold"
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
      finance_status:
        | "not_invoiced"
        | "invoiced"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "disputed"
        | "credit_approved"
      location_kind: "terminal" | "icd" | "in_transit" | "destination" | "depot"
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
      customs_status: [
        "not_started",
        "entry_in_preparation",
        "submitted",
        "inspection",
        "duties_pending",
        "released",
        "on_hold",
      ],
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
      finance_status: [
        "not_invoiced",
        "invoiced",
        "partially_paid",
        "paid",
        "overdue",
        "disputed",
        "credit_approved",
      ],
      location_kind: ["terminal", "icd", "in_transit", "destination", "depot"],
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
