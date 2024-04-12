import { NextFunction, Request, Response, Router } from "express";
import { z, ZodError, ZodType } from "zod";
import { ERPCError } from "./error";
import { Overwrite } from "./utils/types";

type Middleware<Ret, ExistingParams extends Record<string, any>> = (
  req: Request,
  res: Response<unknown, ExistingParams>
) => Promise<Ret>;

export class FinalizedHandler<ReturnType, BodyParameters, PathParameters, QueryParameters> {
  __internal_reflection: {
    return_type: ReturnType;
    body_params: BodyParameters;
    path_parameters: PathParameters;
    query_parameters: QueryParameters;
  };

  constructor(public readonly __middlewares: any) {
    this.__internal_reflection = undefined as any;
  }
}

export type GenerateProcedure<
  Current extends Record<string, any>,
  Previous extends {},
  InputContext extends Record<string, any>
> = {
  extend: <ExtensionType extends Record<string, any>>(
    append: Middleware<ExtensionType, Overwrite<Current, Previous>>
  ) => GenerateProcedure<ExtensionType, Overwrite<Current, Previous>, InputContext>;

  input: <T extends ZodType<any, any, any>>(
    checker: T
  ) => GenerateProcedure<
    { input: z.infer<T> },
    Overwrite<Current, Previous>,
    Overwrite<{ input: z.input<T> }, InputContext>
  >;

  query: <T extends ZodType<any, any, any>>(
    checker: T
  ) => GenerateProcedure<
    { query: z.infer<T> },
    Overwrite<Current, Previous>,
    Overwrite<{ query: z.input<T> }, InputContext>
  >;

  __finalize: <HandlerReturnType, RouteParams = {}>(
    handler: (
      req: Request<RouteParams>,
      res: Response<unknown, Overwrite<Current, Previous>>,
      locals: Overwrite<Current, Previous>
    ) => Promise<HandlerReturnType>
  ) => Router;

  use: <HandlerReturnType, RouteParams = {}>(
    handler: (
      req: Request<RouteParams>,
      res: Response<unknown, Overwrite<Current, Previous>>,
      locals: Overwrite<Current, Previous>
    ) => Promise<HandlerReturnType>
  ) => FinalizedHandler<HandlerReturnType, InputContext["input"], RouteParams, InputContext["query"]>;
};

export function generateProcedure<
  Current extends Record<string, any> /** The type of the object returned by the current middleware */,
  Previous extends {} /** The sum of the object returned by the previous middleware */,
  InputContext extends Record<
    string,
    any
  > /** The third context used exclusively for inputs that will be passed to FinalizedHandlers */
>(
  mw: Middleware<Current, Previous>,
  ctx?: { previous?: Middleware<unknown, any>[] }
): GenerateProcedure<Current, Previous, InputContext> {
  const previous = [...(ctx?.previous ?? ([] as Middleware<unknown, any>[]))];
  previous.push(mw);

  type MergedLocals = Overwrite<Current, Previous>;

  /**
   * Attach another middleware to the current procedure, the properties that the middleware returns is added into the locals object of the response
   */
  function extend<ExtensionType extends Record<string, any>>(append: Middleware<ExtensionType, MergedLocals>) {
    // The middleware that is going to be appended needs to know the sum of the middleware that came before it, so we give it MergedLocals
    // We also need to keep track of the properties it's going to append, which is passed into generateProcedure
    return generateProcedure<ExtensionType, MergedLocals, InputContext>(append, { previous: [...previous] });
  }

  function use<HandlerReturnType, RouteParams = {}>(
    handler: (
      req: Request<RouteParams>,
      res: Response<unknown, MergedLocals>,
      locals: MergedLocals
    ) => Promise<HandlerReturnType>
  ) {
    const middlewares: any[] = previous.map((mwFunction) => {
      return function (req: Request, res: Response, next: NextFunction) {
        mwFunction(req, res as any)
          .then((result) => {
            Object.entries(result as Record<string, any>).forEach(([key, value]) => {
              res.locals[key] = value;
            });

            return next();
          })
          .catch(next); /** Send the error to the root level error handler */
      };
    });

    middlewares.push(function (req: Request<RouteParams>, res: Response, next: NextFunction) {
      handler(req, res as Response<unknown, MergedLocals>, res.locals as MergedLocals)
        .then((result) => {
          res.json({ success: true, result });
        })
        .catch(next);
    });

    return new FinalizedHandler<HandlerReturnType, InputContext["input"], RouteParams, InputContext["query"]>(
      middlewares
    );
  }

  return {
    extend,
    use,

    input: function <T extends ZodType<any, any, any>>(checker: T) {
      const bodyValidator: Middleware<{ input: z.infer<T> }, MergedLocals> = async function (req, res) {
        try {
          return { input: await checker.parseAsync(req.body) };
        } catch (err) {
          // const message = JSON.stringify(JSON.parse((err as ZodError).toString()));
          throw new ERPCError({ code: "BAD_REQUEST", message: err.message });
        }
      };

      return extend(bodyValidator);
    },

    query: function <T extends ZodType<any, any, any>>(checker: T) {
      const queryValidator: Middleware<{ query: z.infer<T> }, MergedLocals> = async function (req, res) {
        try {
          const query =
            typeof req.query.__erpc_query === "string"
              ? JSON.parse(Buffer.from(req.query.__erpc_query, "base64url").toString())
              : req.query;

          return { query: await checker.parseAsync(query) };
        } catch (err) {
          throw new ERPCError({ code: "BAD_REQUEST", message: err.message });
        }
      };

      return extend(queryValidator);
    },

    __finalize: function <HandlerReturnType, RouteParams = {}>(
      handler: (
        req: Request<RouteParams>,
        res: Response<unknown, MergedLocals>,
        locals: MergedLocals
      ) => Promise<HandlerReturnType>
    ) {
      const { __middlewares } = use(handler);
      return Router({ mergeParams: true }).use("/", ...__middlewares);
    },
  };
}

export const baseProcedure = generateProcedure(async (req, res) => ({}));
