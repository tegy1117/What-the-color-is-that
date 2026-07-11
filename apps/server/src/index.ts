import { createGameServer } from "./server";

const port = Number(process.env.PORT ?? 3000);
const { httpServer } = createGameServer();

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`What the color is that? listening on ${port}`);
});

