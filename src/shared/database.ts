/**
 * Database types for supabase-js. Hand-written to mirror supabase/migrations until a
 * project is linked; then regenerate with `npm run db:types` (same shape).
 * Only columns clients may read are listed for `rooms` (invite_code_hash is not selectable).
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MemberRole = "host" | "guest";
export type MessageKind = "text" | "image" | "gif" | "sticker" | "file";
export type ControlStatus = "requested" | "approved" | "denied" | "revoked" | "expired" | "ended";

type Table<Row, Insert, Update> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_hue: number;
  created_at: string;
  updated_at: string;
};

export type RoomRow = {
  id: string;
  slug: string;
  name: string;
  host_id: string;
  invite_expires_at: string | null;
  has_open_invite: boolean;
  control_max_seconds: number;
  created_at: string;
};

export type RoomMemberRow = { room_id: string; user_id: string; role: MemberRole; joined_at: string };

export type MessageRow = {
  id: string;
  seq: number;
  room_id: string;
  sender_id: string;
  client_id: string;
  kind: MessageKind;
  body: string | null;
  reply_to: string | null;
  meta: Json;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
};

export type ReactionRow = { message_id: string; user_id: string; emoji: string; room_id: string; created_at: string };
export type ReceiptRow = { room_id: string; user_id: string; delivered_seq: number; read_seq: number; updated_at: string };

export type AttachmentRow = {
  id: string;
  room_id: string;
  message_id: string | null;
  uploader_id: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  file_name: string;
  width: number | null;
  height: number | null;
  created_at: string;
};

export type MomentRow = { id: string; room_id: string; message_id: string; saved_by: string; created_at: string };

export type ControlSessionRow = {
  id: string;
  room_id: string;
  owner_id: string;
  controller_id: string;
  status: ControlStatus;
  requested_at: string;
  decided_at: string | null;
  ended_at: string | null;
  expires_at: string | null;
  end_reason: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, never, Partial<Pick<ProfileRow, "display_name" | "avatar_hue">>>;
      rooms: Table<RoomRow, never, Partial<Pick<RoomRow, "name" | "control_max_seconds">>>;
      room_members: Table<RoomMemberRow, never, never>;
      messages: Table<
        MessageRow,
        Pick<MessageRow, "room_id" | "client_id"> & Partial<Pick<MessageRow, "id" | "kind" | "body" | "reply_to" | "meta">>,
        Partial<Pick<MessageRow, "body" | "deleted_at">>
      >;
      message_reactions: Table<ReactionRow, Pick<ReactionRow, "message_id" | "emoji"> & { room_id?: string }, never>;
      message_receipts: Table<
        ReceiptRow,
        Pick<ReceiptRow, "room_id"> & Partial<Pick<ReceiptRow, "delivered_seq" | "read_seq">>,
        Partial<Pick<ReceiptRow, "delivered_seq" | "read_seq">>
      >;
      attachments: Table<
        AttachmentRow,
        Omit<AttachmentRow, "id" | "uploader_id" | "created_at" | "message_id" | "width" | "height"> &
          Partial<Pick<AttachmentRow, "id" | "message_id" | "width" | "height">>,
        Partial<Pick<AttachmentRow, "message_id">>
      >;
      moments: Table<MomentRow, Pick<MomentRow, "message_id"> & { room_id?: string }, never>;
      control_sessions: Table<ControlSessionRow, never, never>;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_room: {
        Args: { p_name: string };
        Returns: { room_id: string; slug: string; invite_code: string; invite_expires_at: string }[];
      };
      rotate_invite: { Args: { p_room_id: string }; Returns: { invite_code: string; invite_expires_at: string }[] };
      redeem_invite: { Args: { p_code: string }; Returns: { room_id: string; slug: string }[] };
      is_room_member: { Args: { p_room_id: string }; Returns: boolean };
      rate_limit_hit: {
        Args: { p_bucket: string; p_subject: string; p_max: number; p_window_seconds: number };
        Returns: boolean;
      };
      control_request: { Args: { p_room_id: string }; Returns: ControlSessionRow };
      control_transition: {
        Args: { p_session_id: string; p_status: ControlStatus; p_reason?: string };
        Returns: ControlSessionRow;
      };
    };
    Enums: { member_role: MemberRole; message_kind: MessageKind; control_status: ControlStatus };
    CompositeTypes: { [_ in never]: never };
  };
};
