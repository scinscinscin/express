import { Router as ExpressRouter, type Request, type Response } from "express";
import type { RouteParameters } from "express-serve-static-core";
import { generateProcedure } from "./middleware";
import { Overwrite } from "./utils/types";
import { z } from "zod";
import { Connection, HeirarchyEnd, RawRoutingEngine } from "./websocket";

type HTTPMethodProviderType<PathParams extends {}> = <
  Current extends Record<string, any>,
  Previous extends {},
  InputContext extends Record<string, any>,
  EndpointPath extends string,
  HandlerReturnType
>(
  path: EndpointPath,
  mw: ReturnType<typeof generateProcedure<Current, Previous, InputContext>>,
  handler: (
    req: Request<Overwrite<RouteParameters<EndpointPath>, PathParams>>,
    res: Response<unknown, Overwrite<Current, Previous>>,
    locals: Overwrite<Current, Previous>
  ) => Promise<HandlerReturnType>
) => void;

export interface RouterT<PathParams extends {}> {
  expressRouter: ExpressRouter;
  wsRouter: WebSocketRouter;
  sub: <PathString extends string>(path: PathString) => RouterT<Overwrite<RouteParameters<PathString>, PathParams>>;
  merge: <SubPathParams extends {}>(subrouter: RouterT<SubPathParams>) => RouterT<PathParams>;
  subroutedAt: () => string;
  get: HTTPMethodProviderType<PathParams>;
  post: HTTPMethodProviderType<PathParams>;
  put: HTTPMethodProviderType<PathParams>;
  patch: HTTPMethodProviderType<PathParams>;
  delete: HTTPMethodProviderType<PathParams>;
  ws: WebsocketEndpointProviderType<PathParams>;
}

type WebsocketEndpointProviderType<PathParams extends {}> = <
  EndpointPath extends string,
  Emits extends { [key: string]: any },
  Receives extends { [key: string]: any }
>(
  path: EndpointPath,
  validators: {
    validators: {
      [key in keyof Receives]: z.ZodType<Receives[key]>;
    };
    Emits: Emits;
    Receives: Receives;
  },
  handler: (ctx: {
    params: Overwrite<RouteParameters<EndpointPath>, PathParams>;
    query: { [key: string]: any };
    conn: Connection<{ Emits: Emits; Receives: Receives }>;
  }) => Promise<void>
) => void;

export type WebSocketRouter = RawRoutingEngine<HeirarchyEnd>;
export function Router<PathParams extends {}>(path: string, parentWsRouter: WebSocketRouter): RouterT<PathParams> {
  const expressRouter = ExpressRouter({ mergeParams: true });
  const wsRouter: WebSocketRouter = {};
  parentWsRouter[path] = wsRouter;

  return {
    expressRouter,
    wsRouter,
    subroutedAt: () => path,
    sub: function <PathString extends string>(subRouterPath: PathString) {
      const router = Router<Overwrite<RouteParameters<PathString>, PathParams>>(subRouterPath, wsRouter);
      this.expressRouter.use(subRouterPath, router.expressRouter);
      return router;
    },

    merge: function (subrouter) {
      this.expressRouter.use(subrouter.subroutedAt(), subrouter.expressRouter);
      return this;
    },

    get: (p, mw, handler) => expressRouter.get(p, mw.__finalize(handler)),
    post: (p, mw, handler) => expressRouter.post(p, mw.__finalize(handler)),
    put: (p, mw, handler) => expressRouter.put(p, mw.__finalize(handler)),
    patch: (p, mw, handler) => expressRouter.patch(p, mw.__finalize(handler)),
    delete: (p, mw, handler) => expressRouter.delete(p, mw.__finalize(handler)),

    /**
     * Create a websocket endpoint
     * @param path The path to attach the websocket handler to
     * @param handler
     */
    ws: (path, { validators }, handler) => {
      // @ts-ignore
      wsRouter[path] = () => ({ validators, handler });
    },
  };
}
