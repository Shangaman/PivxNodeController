import fs from "fs/promises";
import { makeRpc } from "./rpc.js";

export const shield = {
  testnet: [],
  mainnet: [],
};

const shieldArrayFile = (isTestnet) =>
  isTestnet ? "shield.testnet.json" : "shield.json";
const shieldBinFile = (isTestnet) =>
  isTestnet ? "shield.testnet.bin" : "shield.bin";

async function recoverShieldbin(isTestnet) {
  // If the shield bin was written, but the index was not
  // We would repeat some blocks
  // So we truncate the file based on the last index we have
  const currentShield = shield[isTestnet ? "testnet" : "mainnet"];
  let lastBlock = currentShield.at(-1);
  if (!lastBlock) return;
  const file = await fs.open(shieldBinFile(isTestnet), "r+");
  const buffer = Buffer.alloc(4);
  let blockLength = 0;
  while (true) {
    await file.read(buffer, 0, 4, lastBlock.i + blockLength);
    blockLength += 4;
    const length = buffer.readInt32LE();
    await file.read(buffer, 0, 4, lastBlock.i + blockLength);
    const version = buffer.readUint8();
    blockLength += length;
    if (version === 0x5d) {
      // This is a block footer
      // After this it's the beginning of a new block
      break;
    }
    if (version !== 3) {
      console.error("Warning: Invalid tx", version);
    }
  }
  await file.close();
  await fs.truncate(shieldBinFile(isTestnet), lastBlock.i + blockLength);
}

export async function beginShieldSync(isTestnet) {
  shield[isTestnet ? "testnet" : "mainnet"] =
    JSON.parse(await fs.readFile(shieldArrayFile(isTestnet))) || [];
  const currentShield = shield[isTestnet ? "testnet" : "mainnet"];
  const { size } = await fs.stat(shieldBinFile(isTestnet));

  await recoverShieldbin(isTestnet);

  const file = await fs.open(shieldBinFile(isTestnet), "a");
  const stream = file.createWriteStream();
  let writtenBytes = 0;
  let previousBlock = size;
  try {
    let block = currentShield.length
      ? currentShield[currentShield.length - 1].block + 1
      : 2700501;
    let { status, response } = await makeRpc(isTestnet, "getblockhash", block);
    let blockHash = JSON.parse(response);

    while (true) {
      const { status, response } = await makeRpc(
        isTestnet,
        "getblock",
        blockHash,
        2,
      );
      const { tx, nextblockhash, time, height } = JSON.parse(response);
      if (status === 200) {
        let isShield = false;
        for (const transaction of tx) {
          if (transaction.hex.startsWith("03")) {
            isShield = true;
            const length = Buffer.alloc(4);
            length.writeUint32LE(transaction.hex.length / 2);
            await stream.write(length);
            await stream.write(Buffer.from(transaction.hex, "hex"));
            writtenBytes += transaction.hex.length / 2 + 4;
          }
        }

        if (isShield) {
          const bytes = Buffer.alloc(1 + 4 + 4 + 4);
          // 5d indicates start of new block
          // Other `5d`s are not escaped, this should not
          // be relied upon, it's just confirmation that
          // the stream is being read correctly
          const length = Buffer.alloc(4);
          length.writeUint32LE(1 + 4 + 4);
          length.copy(bytes, 0, 0, bytes.length);
          bytes.writeUint8(0x5d, 4);
          bytes.writeInt32LE(height, 5);
          bytes.writeInt32LE(time, 9);
          writtenBytes += bytes.byteLength;
          await stream.write(bytes);
          currentShield.push({ block, i: previousBlock });
          previousBlock = size + writtenBytes;
        }

        blockHash = nextblockhash;
        block += 1;
        if (block % 10000 === 0) {
          console.error(block);
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
    await fs.writeFile(
      shieldArrayFile(isTestnet),
      JSON.stringify(currentShield),
    );
    await new Promise((res) => {
      stream.close(res);
    });
    setTimeout(() => beginShieldSync(isTestnet), 1000 * 60); // Sync every minute
  }
}

export async function getShieldBinary(isTestnet, startingByte = 0) {
  const buffer = await fs.readFile(shieldBinFile(isTestnet));

  return Uint8Array.prototype.slice.call(buffer, startingByte);
}
9;
