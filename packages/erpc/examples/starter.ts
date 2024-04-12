import { z } from "zod";
import { baseProcedure, Server, ERPCError, zodFile } from "../lib";

const server = new Server({
  port: 2000,
  defaultMiddleware: {
    bodyParser: true,
    cookieParser: true,
    corsOptions: { credentials: true, origin: "http://localhost:2000" },
  },
});

const authProcedures = baseProcedure.extend(async (req, res) => {
  // if (typeof req.cookies["authToken"] === "string") return { token: req.cookies["authToken"] };
  // else throw new Error("An auth token was not found");
  return { token: "Example user token" };
});

server.rootRouter.post(
  "/register",
  baseProcedure.input(z.object({ username: z.string(), password: z.string() })),
  async (req, res, locals) => {
    if (Math.random() > 0.5)
      throw new ERPCError({ code: "UNAUTHORIZED", message: "You're unauthorized to access this endpoint" });
    else return { ...locals.input };
  }
);

const userRouter = server.sub("/user/:user_uuid");
userRouter.put(
  "/msg/:msg_uuid",
  authProcedures.input(z.object({ new_content: z.string() })),
  async (req, res, { input }) => {
    return { updatedBy: req.params.user_uuid, uuid: req.params.msg_uuid, content: input.new_content };
  }
);

userRouter.get("/testing", baseProcedure, async (req, res, locals) => {
  return { data: "this is in the testing route" };
});

userRouter.put(
  "/image_upload",
  baseProcedure.input(
    z.object({
      username: z.array(z.string()),
      image_ko: z.array(zodFile("image/jpeg")),
    })
  ),
  async (req, res, { input }) => {
    console.log(input.image_ko[0]);
    //           ^?
  }
);

const messageRouter = userRouter.sub("/message");
messageRouter.post("/create", baseProcedure.input(z.object({ msg_content: z.string() })), async (req, res, {}) => {
  return { good: true };
});
