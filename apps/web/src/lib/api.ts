import type { ApiError } from "@workbench/shared";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  datasetId?: string;
  idempotencyKey?: string;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string>;
  readonly references?: unknown[];
  readonly datasetId?: string;

  constructor(status: number, payload: Partial<ApiError>) {
    super(payload.message ?? "请求失败。");
    this.name = "ApiRequestError";
    this.status = status;
    this.code = payload.code ?? "INTERNAL_ERROR";
    this.fieldErrors = payload.fieldErrors;
    this.references = payload.references;
    this.datasetId = payload.datasetId;
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.body);
  }
  if (options.datasetId) headers.set("x-dataset-id", options.datasetId);
  if (options.idempotencyKey) headers.set("idempotency-key", options.idempotencyKey);
  const response = await fetch(path, { ...options, headers, body });
  if (!response.ok) {
    let payload: Partial<ApiError> = {};
    try {
      payload = (await response.json()) as ApiError;
    } catch {
      payload = { code: "NETWORK_ERROR", message: `请求失败（${response.status}）。` };
    }
    throw new ApiRequestError(response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return "请求失败，请重试。";
}
