import { isRecord } from "./responseShape";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  validate?: (value: unknown) => boolean,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "invalid_response",
      "Sunucudan geçerli bir yanıt alınamadı.",
    );
  }
  if (!response.ok) {
    const error = isRecord(value) ? value : {};
    throw new ApiError(
      response.status,
      typeof error.code === "string" ? error.code : "request_failed",
      typeof error.message === "string" && error.message
        ? error.message
        : "İşlem tamamlanamadı.",
    );
  }
  if (value === null || typeof value !== "object" || (validate && !validate(value))) {
    throw new ApiError(
      response.status,
      "invalid_response",
      "Sunucudan beklenen biçimde veri alınamadı.",
    );
  }
  return value as T;
}
