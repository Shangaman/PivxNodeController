import { describe, it, expect, vi } from "vitest";
import { RwLock } from "../../lock.js"; // Adjust this path as needed

describe("RwLock", () => {
  it("allows a single reader to acquire the lock", async () => {
    const lock = new RwLock();
    let readAcquired = false;

    await lock.read();
    readAcquired = true;

    expect(readAcquired).toBe(true);
  });

  it("blocks additional readers if a writer is pending", async () => {
    const lock = new RwLock();
    let read1Acquired = false;
    let read2Acquired = false;

    await lock.read();
    read1Acquired = true;

    const writerPromise = lock.write(); // Writer queued
    const read2Promise = lock.read(); // Reader queued

    // Writer is queued, so the second reader shouldn't acquire the lock yet
    expect(read1Acquired).toBe(true);
    expect(read2Acquired).toBe(false);

    lock.releaseRead();
    await writerPromise; // Writer acquires the lock
    lock.releaseWrite();
    await read2Promise;

    read2Acquired = true;
    expect(read2Acquired).toBe(true);
  });

  it("prioritizes writers over readers", async () => {
    const lock = new RwLock();
    let writerAcquired = false;
    let read2Acquired = false;

    await lock.read(); // First reader acquires lock
    const writerPromise = lock.write().then(() => {
      writerAcquired = true;
    });

    const read2Promise = lock.read().then(() => {
      read2Acquired = true;
    });

    // Release the first reader
    lock.releaseRead();

    // Writer acquires lock before second reader
    await writerPromise;
    expect(writerAcquired).toBe(true);
    expect(read2Acquired).toBe(false);

    lock.releaseWrite();
    await read2Promise;

    // Now the second reader can acquire the lock
    expect(read2Acquired).toBe(true);
  });

  it("allows multiple readers simultaneously", async () => {
    const lock = new RwLock();
    let read1Acquired = false;
    let read2Acquired = false;

    const read1 = lock.read().then(() => {
      read1Acquired = true;
    });

    const read2 = lock.read().then(() => {
      read2Acquired = true;
    });

    await Promise.all([read1, read2]);

    expect(read1Acquired).toBe(true);
    expect(read2Acquired).toBe(true);
  });

  it("blocks readers and writers until write lock is released", async () => {
    const lock = new RwLock();
    let readAcquired = false;
    let writer2Acquired = false;

    // Acquire a write lock
    await lock.write();

    const readPromise = lock.read().then(() => {
      readAcquired = true;
    });

    const writer2Promise = lock.write().then(() => {
      writer2Acquired = true;
      lock.releaseWrite();
    });

    // Release the first write lock
    lock.releaseWrite();

    await Promise.all([readPromise, writer2Promise]);

    expect(readAcquired).toBe(true);
    expect(writer2Acquired).toBe(true);
  });

  it("gives readers precendece", async () => {
    const lock = new RwLock();

    let read = false;
    let written = false;

    await lock.read();

    const writerPromise = lock.write().then(() => {
      written = true;
      expect(read).toBe(false);
      lock.releaseWrite();
    });

    // Even if there are no writers currently holding the lock,
    // Because a writer has requested the lock, we should expect
    // The writer to hold the lock before us
    const readerPromise = lock.read().then(() => {
      read = true;
      expect(written).toBe(true);
      lock.releaseRead();
    });

    lock.releaseRead();
    await Promise.all([writerPromise, readerPromise]);
  });
});
