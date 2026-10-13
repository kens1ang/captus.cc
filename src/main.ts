// Single-process entrypoint for hosts without a free background-worker tier
// (Render free): runs the Fastify server and the BullMQ workers side by side.
// Locally, `npm run dev` + `npm run dev:worker` as separate processes still works.
import "./server.js";
import "./worker.js";
