import type { FastifyInstance } from "fastify";

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_FAILED: 400,
  FILE_REQUIRED: 400,
  FILE_NAME_INVALID: 400,
  NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  FILE_NOT_FOUND: 404,
  AGENT_NOT_FOUND: 404,
  SKILL_NOT_FOUND: 404,
  PRODUCT_NOT_FOUND: 404,
  WORKFLOW_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  RUN_STATE: 409,
  RUN_LIMIT: 429,
  RESULT_STATE: 409,
  RESULT_REMOVED: 409,
  CONNECTOR_NOT_FOUND: 404,
  CONNECTOR_STATE: 409,
  COLLECTION_NOT_FOUND: 404,
  RESOURCE_REFERENCED: 409,
  REVISION_CONFLICT: 409,
  DATASET_CHANGED: 409,
  DATASET_REQUIRED: 400,
  RESTORE_INVALID: 400,
  RESTORE_VERSION_UNSUPPORTED: 400,
  RESTORE_STATE: 409,
  RESTORE_HEALTH_FAILED: 500,
  BACKUP_FAILED: 409,
  DUPLICATE: 409,
  FORBIDDEN: 403,
};

export interface AppError extends Error {
  code: string;
  status?: number;
  fieldErrors?: Record<string, string>;
  references?: unknown[];
  datasetId?: string;
  currentRevision?: number;
}

export function appError(
  code: string,
  message: string,
  extra: Partial<AppError> = {},
): AppError {
  const error = new Error(message) as AppError;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

export function installErrorHandler(app: FastifyInstance, datasetId: () => string): void {
  app.setErrorHandler((error, request, reply) => {
    const typed = error as AppError & { validation?: unknown; statusCode?: number };
    const code = typed.code && STATUS_BY_CODE[typed.code] ? typed.code : typed.validation ? "VALIDATION_FAILED" : "INTERNAL_ERROR";
    const status = typed.status ?? STATUS_BY_CODE[code] ?? 500;
    if (status >= 500) request.log.error(error);
    return reply.code(status).send({
      code,
      message: status >= 500 && code === "INTERNAL_ERROR" ? "本机服务处理失败，请重试。" : typed.message,
      ...(typed.fieldErrors ? { fieldErrors: typed.fieldErrors } : {}),
      ...(typed.references ? { references: typed.references } : {}),
      ...(typed.currentRevision ? { currentRevision: typed.currentRevision } : {}),
      datasetId: typed.datasetId ?? datasetId(),
    });
  });
}
