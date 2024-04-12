import express, { Request, Response, NextFunction, Router as ExpressRouter } from "express";
import cors, { CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import { Router, RouterT } from "./router";
import morgan from "morgan";
import { ERPCError, ErrorMap } from "./error";
import { bodyParser } from "./utils/parser";
import { createServer, type IncomingMessage } from "node:http";
import Stream from "stream";
import { WebSocketServer } from "ws";
import { removeWrappingSlashes } from "./utils/removeWrappingSlashes";
import {
  CompiledRoutingEngine,
  Connection,
  HeirarchyEnd,
  RawRoutingEngine,
  compileRouteTree,
  matchPathToEndpoint,
} from "./websocket";
import { transformERPCError } from "./utils/errorHandling";

export interface ServerConstructorOptions {
  /** The port to run the server on */
  port: number;

  /** Whether the server logs to the response object and console when using the default error handler */
  logErrors?: boolean;

  /** Whether the server should automatically start. Defaults to true */
  startAuto?: boolean;

  errorHandler?: (error: Error, req: Request, res: Response) => void;

  defaultHeaders?: {
    /** If true, the server sets the etag header. Defaults to false */
    etag?: boolean;

    /** If true, the server sets the x-powered-by header. Defaults to false */
    xPoweredBy?: boolean;
  };

  /**
   * THe prefix of the api routes if any, this is needed by the websocket router.
   * Ex: "/api"
   */
  apiPrefix?: string;

  defaultMiddleware?: {
    /**
     * If defined, the server loads cors middleware with these options.
     * Defaults to undefined.
     * @see https://expressjs.com/en/resources/middleware/cors.html
     */
    corsOptions?: CorsOptions;

    /** If true, the server loads body-parser. Defaults to true */
    bodyParser?: boolean;

    /** If true, the server loads cookie-parser. Defaults to true */
    cookieParser?: boolean;

    /** If true, the server loads morgan. Defaults to true */
    morgan?: boolean;
  };
}

export class Server {
  private apiPrefix?: string;
  private constructorOptions: ServerConstructorOptions;
  private readonly LOG_ERRORS: boolean;
  private readonly app = express();
  public readonly rootRouter: RouterT<{}>;

  private readonly rawWsRouter: RawRoutingEngine<HeirarchyEnd> = {};
  private compiledWsRouter: CompiledRoutingEngine<HeirarchyEnd>;

  /**
   * Intermediate encapsulates all the working logic of erpc, so it can be attatched to
   * other Express servers (like serving ERPC on /api while a Next.js server runs on /).
   * Example:
   *
   * ```ts
   * server.use("/api", erpc.intermediate);
   * server.get("*", (req, res) => {
   *  return handle(req, res);
   * });
   * ```
   */
  public readonly intermediate: ExpressRouter;

  constructor(opts: ServerConstructorOptions, router?: RouterT<{}>) {
    this.apiPrefix = opts.apiPrefix;
    if (router) {
      this.rawWsRouter = { "/": router.wsRouter };
      this.rootRouter = router;
    } else {
      this.rawWsRouter = {};
      this.rootRouter = Router("/", this.rawWsRouter);
    }

    this.intermediate = ExpressRouter();
    this.constructorOptions = opts;
    this.LOG_ERRORS = !(opts.logErrors === false);

    const { defaultHeaders, defaultMiddleware } = this.constructorOptions;
    if (!(defaultHeaders?.etag === true)) this.app.disable("etag");
    if (!(defaultHeaders?.xPoweredBy === true)) this.app.disable("x-powered-by");

    if (defaultMiddleware?.corsOptions !== undefined) this.intermediate.use(cors(defaultMiddleware.corsOptions));
    if (!(defaultMiddleware?.bodyParser === false)) this.intermediate.use(bodyParser);
    if (!(defaultMiddleware?.cookieParser === false)) this.intermediate.use(cookieParser());
    if (!(defaultMiddleware?.morgan === false)) this.intermediate.use(morgan("common"));

    this.intermediate.use(this.rootRouter.expressRouter);

    /** Error handler */
    this.intermediate.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      if (this.constructorOptions.errorHandler != undefined) {
        return this.constructorOptions.errorHandler(err, req, res);
      }

      if (err !== undefined && this.LOG_ERRORS) console.error(err);
      const { error, status } = transformERPCError(err);
      if (res.statusCode === 200) res.status(status);
      res.json({ success: false, error: this.LOG_ERRORS ? error : undefined });
    });

    this.app.use("/", this.intermediate);

    if (!(opts?.startAuto === false)) {
      this.listen((port) => {
        console.log("Server has started on port", port);
      });
    }
  }

  sub<PathString extends string>(path: PathString) {
    return this.rootRouter.sub(path);
  }

  createWebSocketHandler() {
    const websocketServer = new WebSocketServer({ noServer: true });

    return (req: IncomingMessage, socket: Stream.Duplex, head: Buffer) => {
      if (!this.compiledWsRouter) {
        this.compiledWsRouter = compileRouteTree(this.rawWsRouter["/"] as RawRoutingEngine<HeirarchyEnd>);
      }

      let url = req.url!
      if(this.apiPrefix != undefined && url.startsWith(this.apiPrefix)) url = url.replace(this.apiPrefix, "");

      const [path, queryParams] = url!.split("?");
      const query = queryParams
        ? queryParams.split("&").reduce((acc, curr) => {
            const [key, val] = curr.split("=");
            return { ...acc, [key]: val ?? "true" };
          }, {} as { [key: string]: string })
        : {};

      const endpoint = matchPathToEndpoint(this.compiledWsRouter, removeWrappingSlashes(path).split("/"));

      if (endpoint) {
        websocketServer.handleUpgrade(req, socket, head, (ws, req) => {
          const { handler, validators } = endpoint.getValue();

          handler({ conn: new Connection(ws, req, validators), params: endpoint.variables, query })
            .then(() => {
              ws.send("@scinorandex/erpc -- stabilize");
            })
            .catch((err) => {
              const { error, status } = transformERPCError(err);
              ws.close(4000 + status, JSON.stringify({ error }));
            });
        });
      }
    };
  }

  listen(handler: (port: number) => void) {
    const httpServer = createServer(this.app);

    httpServer.listen(this.constructorOptions.port, () => {
      handler(this.constructorOptions.port);
    });

    httpServer.on("upgrade", this.createWebSocketHandler());
  }
}
