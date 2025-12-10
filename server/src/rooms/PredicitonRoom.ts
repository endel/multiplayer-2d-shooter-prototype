import { Room, Client } from "@colyseus/core";
import { schema, SchemaType } from "@colyseus/schema";

export const Position = schema({
    x: "number",
    y: "number",
});

export const Player = schema({
    sessionId: "string",
    name: "string",
    position: { type: Position }
});

export const MyRoomState = schema({
    players: { map: Player }
});
export type MyRoomState = SchemaType<typeof MyRoomState>;

export class PredictionRoom extends Room {
    maxClients = 4;
    state = new MyRoomState();

    onCreate(options: any) { }

    onJoin(client: Client, options: { name?: string }) {
        console.log(client.sessionId, "joined!");

        // Add peer to state (triggers onAdd on clients via schema sync)
        const player = new Player();
        player.sessionId = client.sessionId;
        player.name = options.name || `User ${client.sessionId.substring(0, 4)}`;
        this.state.players.set(client.sessionId, player);
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left!");

        // Remove peer from state (triggers onRemove on clients via schema sync)
        this.state.players.delete(client.sessionId);
    }

    onDispose() {
        console.log("room", this.roomId, "disposing...");
    }
}
