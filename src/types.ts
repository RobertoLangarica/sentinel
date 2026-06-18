// Shared contract types for Sentinel. Single source of truth for cross-module
// interfaces (copied from planning/level-2-architecture.md).

import type Database from 'better-sqlite3';

// ─── Workflow / Run ──────────────────────────────────────────────────────────

export type WorkflowState =
  | 'INIT' | 'FETCH_PR' | 'EXTRACT' | 'GUIDANCE'
  | 'GENERATE' | 'APPROVE' | 'POST' | 'DONE' | 'FAILED';

export interface RunRecord {
  id: string;
  prNumber: number;
  repo: string;            // "owner/name"
  headSha?: string;
  model?: string;
  guidance?: string;
  state: WorkflowState;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StepRecord {
  ordinal: number;
  name: WorkflowState;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
}

export interface WorkflowManager {
  createRun(input: { prNumber: number; repo: string; guidance?: string }): RunRecord;
  loadRun(runId: string): RunRecord;
  listRuns(limit?: number): Array<RunRecord & { ageLabel: string }>;
  markStep(runId: string, name: WorkflowState, status: StepRecord['status'], detail?: string): void;
  getNextStep(runId: string): WorkflowState;
  setRunState(runId: string, state: WorkflowState): void;
  recordError(runId: string, message: string): void;
  db: Database.Database;
}

// ─── Knowledge Base ──────────────────────────────────────────────────────────

export type KBCategory = 'constraint' | 'pattern' | 'rule' | 'goal';

export interface KBEntry {
  id?: number;
  category: KBCategory;
  subject?: string;
  content: string;
  source?: string;
  weight?: number;
}

export interface KBQuery {
  category?: KBCategory;
  keyword?: string;
  limit?: number;
}

export interface KnowledgeBase {
  addEntry(runId: string, entry: KBEntry): void;
  addEntries(runId: string, entries: KBEntry[]): void;
  reinforce(runId: string, entry: KBEntry): void;
  query(runId: string, q: KBQuery): KBEntry[];
  all(runId: string): KBEntry[];
  getQueryTool(runId: string): AgentTool;
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

export interface PullRequest {
  number: number;
  repo: string;            // "owner/name"
  title: string;
  body: string;
  headSha: string;
  baseRef: string;
  author: string;
  url: string;
}

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface IssueComment {
  id: number;
  body: string;
  author: string;
  url: string;
}

export interface GitHubClient {
  getPR(prNumber: number): Promise<PullRequest>;
  getDiff(prNumber: number): Promise<string>;
  getChangedFiles(prNumber: number): Promise<ChangedFile[]>;
  findSentinelComment(prNumber: number): Promise<IssueComment | null>;
  createComment(prNumber: number, body: string): Promise<IssueComment>;
  updateComment(commentId: number, body: string): Promise<IssueComment>;
}

// ─── AI ──────────────────────────────────────────────────────────────────────

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: any) => Promise<string> | string;
}

export interface ReviewIssue {
  severity: 'blocking' | 'warning' | 'suggestion' | 'note';
  category?: string;
  file?: string;
  location?: string;
  message: string;
  status: 'open' | 'resolved';
}

export interface GenerateReviewInput {
  pr: PullRequest;
  diff: string;
  changedFiles: ChangedFile[];
  tools: AgentTool[];
  model?: string;
  priorIssues?: ReviewIssue[];
  priorReviewedSha?: string;
}

export interface GeneratedReview {
  markdown: string;
  summary: string;
  issues: ReviewIssue[];
}

export interface ProviderTurn {
  toolCalls?: Array<{ id: string; name: string; input: any }>;
  text?: string;
}

export interface Provider {
  name: string;
  complete(messages: any[], tools: AgentTool[], model?: string): Promise<ProviderTurn>;
}

export interface AIProvider {
  generateReview(input: GenerateReviewInput): Promise<GeneratedReview>;
}

// ─── CLI / Orchestrator ──────────────────────────────────────────────────────

export interface ReviewOptions {
  prNumber?: number;
  resumeRunId?: string;
  guidance?: string;
  interactive: boolean;
  promptGuidance: boolean;
  model?: string;
}

export interface RunResult {
  runId: string;
  state: WorkflowState;
  commentUrl?: string;
  reviewedSha?: string;
  error?: string;
}

// ─── Reporter ────────────────────────────────────────────────────────────────

export type ApprovalChoice = 'approve' | 'edit' | 'regenerate' | 'cancel';

export interface Reporter {
  header(runId: string, prTitle?: string): void;
  step(label: string): { succeed(msg?: string): void; fail(msg?: string): void };
  panel(title: string, body: string): void;
  previewReview(markdown: string): void;
  promptGuidance(): Promise<string | undefined>;
  promptApproval(): Promise<ApprovalChoice>;
  openInEditor(markdown: string): Promise<string>;
  result(opts: { url?: string; sha?: string; failed?: boolean; message?: string }): void;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class DBError extends Error {}
export class GitHubAuthError extends Error {}
export class GitHubExecError extends Error {}
export class ProviderAuthError extends Error {}
export class ProviderError extends Error {}
export class ProviderLoopError extends Error {}
