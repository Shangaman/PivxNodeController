const STATE = {
  // Allow reads
  READING: 0,
  // A writer is holding the lock
  WRITING: 1,
};

/**
 * Read write lock. Allows for infinite readers XOR 1 writer.  Writers
 * are given precedence. If a writer is pending, readers will have to
 * wait for all writers to finish.
 */
export class RwLock {
  #state = STATE.READING;
  #readers = 0;

  pendingReaders = [];
  pendingWriters = [];

  /**
   * @returns {boolean} Whether or not we should allow reading
   */
  #shouldRead() {
    return this.#state === STATE.READING && this.pendingWriters.length === 0;
  }

  /**
   * @returns {boolean} Whether or not we can write safely
   */
  #canWrite() {
    return this.#state === STATE.READING && this.#readers === 0;
  }

  /**
   * @returns {Promise<void>} resolves when lock is acquired
   */
  read() {
    if (this.#shouldRead()) {
      // Increase reader count
      this.#readers++;
      return Promise.resolve();
    }

    return new Promise((res) => {
      this.pendingReaders.push(res);
    });
  }

  /**
   * @returns {Promise<void>} resolves when lock is acquired
   */
  write() {
    if (this.#canWrite()) {
      this.#state = STATE.WRITING;
      return Promise.resolve();
    }

    // If we weren't able to lock, add us to the locking queue
    return new Promise((res) => {
      this.pendingWriters.push(res);
    });
  }

  /**
   * @returns {void} releases read lock
   */
  releaseRead() {
    this.#readers--;
    this.#handleQueue();
  }

  /**
   * @returns {void} releases write lock
   */
  releaseWrite() {
    this.#state = STATE.READING;
    this.#handleQueue();
  }

  // Pre condition: This should be called after having released a lock
  // We know we can safely remove the WRITE state if needed
  #handleQueue() {
    // if there are no readers, prioritize writers
    if (this.#readers === 0 && this.pendingWriters.length > 0) {
      this.#state = STATE.WRITE;
      // Resolve write promise
      console.log(this.pendingWriters);
      this.pendingWriters.splice(0, 1)[0]();
    } else {
      // Allow reading if no writers are pending
      this.#state = STATE.READING;
      if (this.#shouldRead()) {
        // if we should read, release all the readers

        for (const reader of this.pendingReaders) {
          this.#readers++;
          reader();
        }
        this.pendingReaders = [];
      }
    }
  }
}
