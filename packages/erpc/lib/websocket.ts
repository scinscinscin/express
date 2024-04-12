import { IncomingMessage } from "node:http";
import { z } from "zod";
import { WebSocket, RawData } from "ws";
import { removeWrappingSlashes } from "./utils/removeWrappingSlashes";

const reqValidator = z.object({ eventName: z.string(), data: z.any() });

export class Connection<Params extends { Emits: { [key: string]: any }; Receives: { [key: string]: any } }> {
  socketEventHandlerMap: Map<string, (data: any) => Promise<void>> = new Map();

  public constructor(
    public readonly socket: WebSocket,
    public readonly req: IncomingMessage,
    validators: { [key: string]: z.AnyZodObject }
  ) {
    this.socket.on("message", async (data: RawData) => {
      const stringified = data.toString();

      try {
        const { eventName, data } = await reqValidator.parseAsync(JSON.parse(stringified));
        const handler = this.socketEventHandlerMap.get(eventName);
        if (!handler) throw new Error(`Could not find a eventHandler for event: ${eventName}`);

        const parsedData = await validators[eventName].parseAsync(data);
        await handler(parsedData);
      } catch (err) {}
    });
  }

  emit<T extends keyof Params["Emits"]>(eventName: T, data: Params["Emits"][T]) {
    this.socket.send(JSON.stringify({ eventName, data }));
  }

  on<T extends keyof Params["Receives"]>(eventName: T, handler: (data: Params["Receives"][T]) => Promise<void>) {
    this.socketEventHandlerMap.set(eventName as string, handler);
  }
}

export type WSValidatorReturnType<Receives, Emits> = {
  validators: { [key in keyof Receives]: z.ZodType<Receives[key], z.ZodTypeDef, Receives[key]> };
  Receives: Receives;
  Emits: Emits;
};

export function wsValidationBuilder<Receives extends { [key: string]: any }>(validators: {
  [key in keyof Receives]: z.ZodType<Receives[key]>;
}) {
  return {
    emits<Emits extends { [key: string]: any }>(): WSValidatorReturnType<Receives, Emits> {
      return { validators, Receives: {} as Receives, Emits: {} as Emits };
    },
  };
}

export function wsValidate<T extends { Receives: { [key: string]: any }; Emits: { [key: string]: any } }>(validators: {
  [key in keyof T["Receives"]]: z.ZodType<T["Receives"][key]>;
}): WSValidatorReturnType<T["Receives"], T["Emits"]> {
  return { validators, Receives: {} as T["Receives"], Emits: {} as T["Emits"] };
}

export type HeirarchyEnd = {
  validators: { [key: string]: z.AnyZodObject };
  handler: (ctx: {
    conn: Connection<{ Emits: { [key: string]: any }; Receives: { [key: string]: any } }>;
    params: { [key: string]: any };
    query: { [key: string]: any };
  }) => Promise<void>;
};

/**
 * A human friendly interface representing routes
 */
export interface RawRoutingEngine<T> {
  [key: string]: RawRoutingEngine<T> | (() => T);
}

export type CompiledRoutingEngine<T> = [string[], CompiledRoutingEngine<T> | (() => T)][];

/**
 * Compiles a RawRoutingEngine object into CompiledRoutingEngine
 */
export const compileRouteTree = <T>(h: RawRoutingEngine<T>): CompiledRoutingEngine<T> => {
  return Object.entries(h).map(([path, subroute]) => {
    const pathSegments = removeWrappingSlashes(path).split("/");
    const val = typeof subroute === "function" ? subroute : compileRouteTree(subroute);
    return [pathSegments, val];
  });
};

const getIndexHandler = <T>(c: CompiledRoutingEngine<T>): (() => T) | null => {
  const indexSubrouter = c.find((sr) => sr[0][0] === "");
  if (!indexSubrouter) return null;
  if (typeof indexSubrouter[1] === "function") return indexSubrouter[1];
  else return getIndexHandler(indexSubrouter[1]);
};

type Matched<T> = { variables: { [key: string]: string }; getValue: () => T };

/**
 * A sketchy reimplementation of express' routing engine.
 * @param heirarchy - a compiled routing heirarchy
 * @param segments - path segments
 **/
export const matchPathToEndpoint = function <T>(
  heirarchy: CompiledRoutingEngine<T>,
  segments: string[]
): Matched<T> | null {
  checkSubrouters: for (const [path, subrouter] of heirarchy) {
    // if template has more segments than what needs to be matched, use next template
    if (path.length > segments.length) continue;
    // if segments has more parts then path,j then subrouter cannot be a function
    if (path.length < segments.length && typeof subrouter === "function") continue;

    const variables: { [key: string]: string } = {};

    checkPathSegments: for (let i = 0; i < path.length; i++) {
      const x = path[i],
        y = segments[i];

      // direct match, check the next path segment
      if (x === y) continue checkPathSegments;
      // x is a path variable, save it then apply y to it before checking the next path segment
      else if (x.startsWith(":")) {
        variables[x.slice(1, x.length)] = y;
        continue checkPathSegments;
      }

      // failed to match, then try the next subrouter
      else continue checkSubrouters;
    }

    // is a direct match
    if (path.length === segments.length) {
      if (typeof subrouter === "function") return { variables, getValue: subrouter };
      const indexHandler = getIndexHandler(subrouter);
      if (indexHandler) return { variables, getValue: indexHandler };
    }

    // segments has more parts to it
    else if (path.length < segments.length) {
      // get parts of segment not matched by current router
      const remainingSegments = segments.slice(path.length, segments.length);
      if (typeof subrouter !== "function") {
        const fn = matchPathToEndpoint(subrouter, remainingSegments);
        if (fn != null) {
          const { getValue: handler, variables: subrouterVars } = fn;
          return { variables: { ...variables, ...subrouterVars }, getValue: handler };
        }
      }
    }
  }

  // none matched so return null
  return null;
};
