import "./style.css";
import { Client, getStateCallbacks } from "colyseus.js";

async function main() {
    const client = new Client("ws://localhost:2567");
    const room = await client.joinOrCreate("my_room", {})
    console.log(room);

}