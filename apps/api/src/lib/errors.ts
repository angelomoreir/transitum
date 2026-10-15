export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = (message = "Não autenticado") =>
  new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Sem permissões para esta ação") =>
  new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Recurso não encontrado") =>
  new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new AppError(409, "CONFLICT", message);
export const badRequest = (message: string, issues?: unknown) =>
  new AppError(400, "BAD_REQUEST", message, issues);
