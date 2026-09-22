import type { ApiErrorShape } from "../domain/model";

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly correlationId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    response: Pick<ApiErrorShape, "code" | "message" | "retryable"> &
      Partial<Pick<ApiErrorShape, "correlationId" | "details">>,
    status: number,
  ) {
    super(response.message);
    this.name = "ApiClientError";
    this.code = response.code;
    this.status = status;
    this.retryable = response.retryable;
    this.correlationId = response.correlationId;
    this.details = response.details;
  }
}

function isApiErrorShape(value: unknown): value is ApiErrorShape {
  if (!value || typeof value !== "object") return false;
  const error = value as Partial<ApiErrorShape>;
  return (
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.retryable === "boolean" &&
    typeof error.correlationId === "string"
  );
}

export async function readApiClientError(
  response: Response,
  fallbackMessage: string,
): Promise<ApiClientError> {
  const payload: unknown = await response.json().catch(() => undefined);
  if (isApiErrorShape(payload))
    return new ApiClientError(payload, response.status);
  return new ApiClientError(
    {
      code: "HTTP_ERROR",
      message: fallbackMessage,
      retryable: response.status >= 500,
    },
    response.status,
  );
}
