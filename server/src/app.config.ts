import config from "@colyseus/tools";
import { defineRoom } from "colyseus";
import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
import { WebSocketTransport } from "@colyseus/ws-transport";

/**
 * Import your Room files
 */
import { BattleRoyaleRoom } from "./rooms/BattleRoyaleRoom";

export default config({

    /**
     * Define your room handlers:
     */
    rooms: {
        battle_royale: defineRoom(BattleRoyaleRoom),
    },

    // WebRTC SDP messages can be 3-12KB
    initializeTransport: (options) => new WebSocketTransport({ ...options, maxPayload: 12 * 1024 }),

    initializeGameServer: (gameServer) => {
        // gameServer.simulateLatency(200);
    },

    initializeExpress: (app) => {
        // app.get("/", (req, res) => {
        //     console.log("EXPRESS DEFAULT ROUTE!");
        //     res.send("Hello World");
        // });

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
    },


    beforeListen: () => {
        /**
         * Before before gameServer.listen() is called.
         */
    }
});
