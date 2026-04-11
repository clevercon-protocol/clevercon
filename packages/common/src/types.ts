export interface AgentManifest {
  agent_id: string;
  name: string;
  description: string;
  capabilities: string[];
  pricing: {
    model: 'x402' | 'mpp';
    price_per_call: number;
    currency: 'USDC';
  };
  endpoint: string;
  stellar_address: string;
  health_check: string;
}

export interface AgentRecord extends AgentManifest {
  registered_at: string;
  last_seen: string;
  status: 'active' | 'inactive' | 'new';
  /** Stellar address of the user/orchestrator who registered this agent */
  registered_by?: string;
  reputation: {
    score: number;
    total_jobs: number;
    successful_jobs: number;
    failed_jobs: number;
    avg_quality: number;
    avg_latency_ms: number;
    last_updated: string;
  };
}

export interface AgentFeedback {
  agent_id: string;
  job_id: string;
  success: boolean;
  quality_rating: number;
  latency_ms: number;
  timestamp: string;
}

export interface ExecutionStep {
  step_id: number;
  agent_id: string;
  agent_name: string;
  action: string;
  depends_on: number | number[] | null;
  estimated_cost: number;
  payment_method: 'x402' | 'mpp';
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  total_estimated_cost: number;
  reasoning: string;
}

export interface StepResult {
  step_id: number;
  agent_id: string;
  agent_name: string;
  success: boolean;
  output: string | null;
  error: string | null;
  payment: {
    amount: number;
    tx_hash: string | null;
    explorer_url: string | null;
    method: 'x402' | 'mpp';
  };
  quality_rating: number | null;
  latency_ms: number;
  timestamp: string;
}

export interface TaskResult {
  task_id: string;
  task: string;
  status: 'complete' | 'partial' | 'failed';
  steps: StepResult[];
  final_output: string | null;
  total_cost: number;
  total_time_ms: number;
  budget_contract_task_id: number | null;
}
