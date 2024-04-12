import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:2000/gateway", {});
// const ws = new WebSocket("ws://localhost:6666/user/scinorandex/post/post_uuid", {});
ws.on("open", () => {
  console.log("Client has connected with server");

  ws.send(
    JSON.stringify({
      eventName: "send_message",
      data: { contents: "Hello World!" },
    })
  );

  ws.on("message", (data) => {
    console.log(data.toString());
  });
});
