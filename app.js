import * as dotenv from "dotenv";
dotenv.config();
checkEnv();
import express from "express";
import cors from "cors";
import compression from "compression";
import http from "http";
import https from "https";
import jq from "node-jq";
import { shield, beginShieldSync, getShieldBinary } from "./shield.js";
import { makeRpc } from "./rpc.js";

const app = express();
app.use(compression({ filter: () => true }));
app.use(cors());
const port = process.env["PORT"] || 3000;
const rpcPort = process.env["RPC_PORT"] || 51473;
const testnetRpcPort = process.env["TESTNET_RPC_PORT"];
const allowedRpcs = process.env["ALLOWED_RPCS"].split(",");

function setupServer(app) {
  if (testnetRpcPort) {
    beginShieldSync(true);
  }

  beginShieldSync(false);
  const certificatePath = process.env["HTTPS_CERTIFICATE_PATH"];
  const keyPath = process.env["HTTPS_KEY_PATH"];
  if (!certificatePath || !keyPath) {
    return http.createServer(app);
  }
  const cert = fs.readFileSync(certificatePath);
  const key = fs.readFileSync(keyPath);
  return https.createServer({ cert, key }, app);
}

function checkEnv() {
  if (!process.env["ALLOWED_RPCS"])
    throw new Error("Environment variable ALLOWED_RPCS was not set");
  if (!process.env["RPC_CREDENTIALS"])
    throw new Error("Environment variable RPC_CREDENTIALS was not set");
}

function parseParams(params) {
  return (params ? params.split(",") : [])
    .map((v) => (isNaN(v) ? v : parseInt(v)))
    .map((v) => (v === "true" ? true : v))
    .map((v) => (v === "false" ? false : v));
}

async function handleRequest(isTestnet, req, res) {
  try {
    if (allowedRpcs.includes(req.params["rpc"])) {
      const filter = req.query.filter;
      const params = parseParams(req.query.params);
      const { status, response } = await makeRpc(
        isTestnet,
        req.params["rpc"],
        ...params,
      );
      try {
        res
          .status(status)
          .send(
            filter
              ? await jq.run(filter, response, { input: "string" })
              : response,
          );
      } catch (e) {
        const badRequest = 400;
        res.status(badRequest).send("Bad filter request");
      }
    } else {
      const forbiddenStatus = 403;
      res.status(forbiddenStatus).send("Invalid RPC");
    }
  } catch (e) {
    console.error(e);
    const internalError = 500;
    res.status(internalError).send("Internal app error");
  }
}

app.get("/mainnet/getshieldblocks", async function (req, res) {
  res.send(JSON.stringify(shield["mainnet"].map(({ block }) => block)));
});

app.get("/mainnet/getshielddata", async (req, res) => {
  const startBlock = req.query.startBlock || 0;
  const startingByte = shield["mainnet"]
    // Get the first block that's greater or equal than the requested starting block
    .find(({ block }) => block >= startBlock)?.i;
  console.log(startingByte);
  if (startingByte === undefined) {
    const noContent = 204;
    res.status(noContent).send(Buffer.from([]));
    return;
  }
  const shieldBinary = await getShieldBinary(false, startingByte);
  res.set("X-Content-Length", shieldBinary.length);
  res.send(shieldBinary);
});

app.get("/mainnet/:rpc", async (req, res) => handleRequest(false, req, res));
if (testnetRpcPort) {
  app.get("/testnet/getshieldblocks", async function (req, res) {
    res.send(JSON.stringify(shield["testnet"]));
  });
  app.get("/testnet/:rpc", async (req, res) => handleRequest(true, req, res));
}

const server = setupServer(app);

server.listen(port, () => {
  console.log(`Pivx node controller listening on port ${port}`);
});
