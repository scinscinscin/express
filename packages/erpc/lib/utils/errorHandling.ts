import { ERPCError, ErrorMap } from "../error";

export function transformERPCError(err: Error) {
  if (err instanceof ERPCError) {
    const {
      opts: { message, code: type, customCode },
    } = err;

    return { status: customCode ?? ErrorMap[type], error: { type, message } };
  } else if (err instanceof Error) {
    return { status: 500, error: err.message };
  } else {
    return { status: 500, error: "Unknown internal server error" };
  }
}
