export const ErrorMap = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
};

export type ErrorType = keyof typeof ErrorMap;

export interface ERPCErrorOptions {
  code: ErrorType;
  message: string;
  customCode?: number;
}

export class ERPCError extends Error {
  constructor(public readonly opts: ERPCErrorOptions) {
    super(opts.message);
  }
}
