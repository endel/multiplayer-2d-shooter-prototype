import express from "express";
import { createServer } from "http";
import { createEndpoint, createRouter, defineRoom, defineServer } from "colyseus";

import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
import { WebSocketTransport } from "@colyseus/ws-transport";

/**
 * Import your Room files
 */
import { BattleRoyaleRoom } from "./rooms/BattleRoyaleRoom";

const app = express();
const httpServer = createServer(app);

/**
 * Bind your custom express routes here:
 * Read more: https://expressjs.com/en/starter/basic-routing.html
 */
app.get("/hello_world", (req, res) => {
    res.send("It's time to kick ass and chew bubblegum!");
});

/**
 * Use @colyseus/playground
 * (It is not recommended to expose this route in a production environment)
 */
if (process.env.NODE_ENV !== "production") {
    app.use("/playground", playground());
}

/**
 * Use @colyseus/monitor
 * It is recommended to protect this route with a password
 * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
 */
app.use("/monitor", monitor());

export const server = defineServer({
    /**
     * Define your room handlers:
     */
    rooms: {
        battle_royale: defineRoom(BattleRoyaleRoom),
    },

    transport: new WebSocketTransport({
        server: httpServer,
        maxPayload: 12 * 1024, // WebRTC SDP messages can be 3-12KB
    }),

    routes: createRouter({
        hello_world: createEndpoint("/hello_world", { method: "GET" }, async (ctx) => {
            return new Response("Hello world!");
        }),
    }),

});
