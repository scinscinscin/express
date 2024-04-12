import { z } from "zod";
import { baseProcedure, Server, Connection, wsValidate } from "../lib";

const server = new Server({
  port: 2000,
  defaultMiddleware: {
    bodyParser: true,
    cookieParser: true,
    corsOptions: { credentials: true, origin: "http://localhost:2000" },
  },
});

type Endpoint = {
  Emits: {
    user_joined: { username: string };
    new_message: { contents: string };
  };
  Receives: { send_message: { contents: string } };
};

server.rootRouter.post(
  "/login",
  baseProcedure.input(z.object({ username: z.string(), password: z.string() })),
  async (req, res, { input }) => {
    for (const connection of connections) {
      connection.emit("user_joined", { username: input.username });
    }
    return { success: true };
  }
);

const connections: Connection<Endpoint>[] = [];
server.rootRouter.ws(
  "/gateway",
  wsValidate<Endpoint>({ send_message: z.object({ contents: z.string() }) }),
  async ({ conn, params, query }) => {
    connections.push(conn);
    conn.on("send_message", async (data) => {
      for (const connection of connections) {
        connection.emit("new_message", { contents: data.contents });
      }
    });
  }
);
