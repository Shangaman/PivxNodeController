import * as dotenv from "dotenv";
dotenv.config();
checkEnv();
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import http from "http";
import https from "https";
import fs from "fs";
import jq from "node-jq";

const app = express();
app.use(cors());
const port = process.env["PORT"] || 3000;
const rpcPort = process.env["RPC_PORT"] || 51473;
const testnetRpcPort = process.env["TESTNET_RPC_PORT"];
const allowedRpcs = process.env["ALLOWED_RPCS"].split(",");
const shield = {
    testnet: [],
    mainnet: [],
};

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

const encodeBase64 = (data) => {
  return Buffer.from(data).toString("base64");
};

async function makeRpc(isTestnet, name, ...params) {
  try {
    const output = await fetch(
      `http://127.0.0.1:${isTestnet ? testnetRpcPort : rpcPort}/`,
      {
        method: "POST",
        headers: {
          "content-type": "text/plain;",
          Authorization:
            "Basic " + encodeBase64(process.env["RPC_CREDENTIALS"]),
        },
        body: JSON.stringify({
          jsonrpc: "1.0",
          id: "pivxRerouter",
          method: name,
          params,
        }),
      }
    );

    const obj = await output.json();
    if (obj.error) {
      const imATeapot = 418;
      return { status: imATeapot, response: obj.error.message };
    } else {
      const ok = 200;
      return { status: ok, response: JSON.stringify(obj.result) };
    }
  } catch (error) {
    if (error.errno === "ECONNREFUSED") {
      return { status: 503, response: "PIVX node was not responsive." };
    }
    console.error(error);
    if (error.name === "AbortError") {
      return "brequbest was aborted'";
    } else {
      return "non u sac";
    }
  }
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
        ...params
      );
      try {
        res
          .status(status)
          .send(
            filter
              ? await jq.run(filter, response, { input: "string" })
              : response
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

app.get('/mainnet/getshieldblocks', async function(req, res) {
    res.send(JSON.stringify(shield["mainnet"]));
});

app.get("/mainnet/:rpc", async (req, res) => handleRequest(false, req, res));
if (testnetRpcPort) {
    app.get('/testnet/getshieldblocks', async function(req, res) {
	res.send(JSON.stringify(shield["testnet"]));
    });
    app.get("/testnet/:rpc", async (req, res) => handleRequest(true, req, res));
}


const server = setupServer(app);

server.listen(port, () => {
  console.log(`Pivx node controller listening on port ${port}`);
});

async function beginShieldSync(isTestnet) {
    shield[isTestnet ? "testnet" : "mainnet"] = JSON.parse(fs.readFileSync(isTestnet ? 'shield.testnet.json' : 'shield.json')) || [];
    const currentShield = shield[isTestnet ? "testnet" : "mainnet"];
    try {
	let block = currentShield.length ? currentShield[currentShield.length - 1] + 1 : 0;
	let { status, response } = await makeRpc(isTestnet, "getblockhash", block);
	let blockHash = JSON.parse(response);
	console.log(block);
	
	while (true) {
	    const { status, response } = await makeRpc(isTestnet, "getblock", blockHash, 2);
	    const { tx, nextblockhash } = JSON.parse(response);
	    if (status === 200) {
		const isShield = !!tx.find(b => b.hex.startsWith("03"));
		if(isShield) {
		    currentShield.push(block);
		}
		blockHash = nextblockhash;
		block += 1;
		if (block % 10000 === 0) {
		    console.error(block);
		    console.error(currentShield);
		}
	    } else {
		throw new Error(response);
	    }
	    if (!nextblockhash) {
		break;
	    }
	}
    } catch (e) {
	console.error(e);
    } finally {
	fs.writeFileSync(isTestnet ? "shield.testnet.json" : "shield.json", JSON.stringify(currentShield));
	setTimeout(() => beginShieldSync(isTestnet), 1000 * 60); // Sync every minute
    }
};
