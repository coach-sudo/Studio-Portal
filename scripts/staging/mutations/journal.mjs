import {
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  readFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import process from "node:process";
import assert from "node:assert/strict";
import { sha, manifestHash } from "./policy.mjs";
export class Journal {
  constructor(directory, codeHash) {
    this.path = join(directory, "mutation-journal.jsonl");
    this.lock = join(directory, "mutation.lock");
    this.fd = openSync(this.lock, "wx", 0o600);
    writeSync(
      this.fd,
      JSON.stringify({
        pid: process.pid,
        host: hostname(),
        codeHash,
        manifestHash,
        startedAt: new Date().toISOString(),
      }),
    );
    fsyncSync(this.fd);
    this.events = [];
    try {
      if (existsSync(this.path)) {
        for (const line of readFileSync(this.path, "utf8").trim().split("\n")) {
          const e = JSON.parse(line);
          const { hash, ...value } = e;
          assert.equal(value.previous, this.events.at(-1)?.hash || "");
          assert.equal(sha(value), hash, "Journal corruption");
          this.events.push(e);
        }
        assert.equal(this.events[0].manifestHash, manifestHash);
        assert.equal(
          this.events[0].codeHash,
          codeHash,
          "Executor changed since run began",
        );
      } else this.append({ type: "header", manifestHash, codeHash });
    } catch {
      this.close();
      throw Error("Private journal invalid; recovery review required");
    }
  }
  append(value) {
    value = { ...value };
    delete value.hash;
    delete value.previous;
    delete value.seq;
    const entry = {
      ...value,
      seq: this.events.length,
      previous: this.events.at(-1)?.hash || "",
    };
    entry.hash = sha(entry);
    const fd = openSync(this.path, "a", 0o600);
    try {
      writeSync(fd, JSON.stringify(entry) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.events.push(entry);
    return entry;
  }
  find(type, name) {
    return this.events.findLast((x) => x.type === type && x.name === name);
  }
  close() {
    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
      unlinkSync(this.lock);
    }
  }
}
