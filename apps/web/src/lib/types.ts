export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  verification?: MessageVerification;
}

export interface MessageVerification {
  status: "verified" | "uncertain" | "failed" | "not_verified";
  reason?: string;
  confidence?: number;
  sources?: Array<{
    title?: string;
    url?: string;
    sourceQuality?: string;
    type?: string;
  }>;
}

export interface OrchestratorEvent {
  label: string;
  status: "pending" | "done" | "failed";
}

export interface ApiRequirementItem {
  id: string;
  name: string;
  connected: boolean;
  required: boolean;
}

export interface SystemStatus {
  model: {
    id: string;
    name: string;
    healthy: boolean;
    message?: string;
    modelLoaded?: boolean;
    ready?: boolean;
    state?: string;
  };
  phases: Record<string, boolean | string>;
  pendingApprovals: number;
  embeddingProvider?: string;
    s3?: { state?: string; bucket?: string; message?: string; provider?: string };
  workspace?: {
    provider?: string;
    kind?: string;
    isolation?: string;
  };
  lastSearch?: {
    original_query?: string;
    detected_intent?: string;
    answer_type?: string;
    relationship?: string;
    resolved_entity?: string;
    entity_candidates?: string[];
    generated_queries?: string[];
    sources_consulted?: Array<{ title?: string; url?: string; quality?: string }>;
    evidence_count?: number;
    confidence?: string;
    needs_clarification?: boolean;
    analyzer?: string;
    model_status?: string;
  } | null;
}
