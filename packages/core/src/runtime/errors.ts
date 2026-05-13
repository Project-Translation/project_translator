export const OPERATION_CANCELLED_CODE = "E_OPERATION_CANCELLED";

export class OperationCancelledError extends Error {
  public readonly code = OPERATION_CANCELLED_CODE;

  constructor(message: string = "Operation cancelled") {
    super(message);
    this.name = "OperationCancelledError";
  }
}

export function isOperationCancelledError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "OperationCancelledError" ||
    (error as { code?: string }).code === OPERATION_CANCELLED_CODE
  );
}
