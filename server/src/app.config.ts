import config from "@colyseus/tools";
import { monitor } from "@colyseus/monitor";
import { playground } from "@colyseus/playground";
import { WebSocketTransport } from "@colyseus/ws-transport";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom";
import { PredictionRoom } from "./rooms/PredicitonRoom";
import { BattleRoyaleRoom } from "./rooms/BattleRoyaleRoom";

export default config({

    // WebRTC SDP messages can be 3-12KB
    initializeTransport: (options) => new WebSocketTransport({ ...options, maxPayload: 12 * 1024 }),

    initializeGameServer: (gameServer) => {
        /**
         * Define your room handlers:
         */
        gameServer.define('my_room', MyRoom).filterBy(["schemaVersion"]);
        gameServer.define('prediction_room', PredictionRoom);
        gameServer.define('battle_royale', BattleRoyaleRoom);

    },

    initializeExpress: (app) => {
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
            app.use("/", playground());
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
