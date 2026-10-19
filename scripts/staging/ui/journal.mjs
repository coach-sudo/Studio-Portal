import assert from "node:assert/strict";
import {
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  readFileSync,
  existsSync,
  unlinkSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { sha, manifestHash, plan } from "./policy.mjs";
export class UiJournal {
  constructor(directory, executorHash, target) {
    assert.equal(
      realpathSync(directory),
      resolve(directory),
      "Canonical private directory required",
    );
    this.path = join(directory, "ui-journal.jsonl");
    this.lock = join(directory, "ui-run.lock");
    for (const f of [this.path, this.lock])
      if (existsSync(f))
        assert(!lstatSync(f).isSymbolicLink(), "Journal symlink prohibited");
    this.fd = openSync(this.lock, "wx", 0o600);
    this.events = [];
    try {
      if (existsSync(this.path))
        for (const line of readFileSync(this.path, "utf8").trim().split("\n")) {
          const e = JSON.parse(line),
            { hash, ...value } = e;
          assert.equal(e.seq, this.events.length);
          assert.equal(e.previous, this.events.at(-1)?.hash || "");
          assert.equal(sha(value), hash, "Journal hash mismatch");
          this.events.push(e);
        }
      if (this.events.length)
        assert.deepEqual(
          this.events[0].identity,
          { runId: plan.runId, manifestHash, executorHash, target },
          "Journal target/code changed",
        );
      else
        this.append({
          type: "header",
          identity: { runId: plan.runId, manifestHash, executorHash, target },
        });
    } catch (e) {
      this.close();
      throw e;
    }
  }
  append(value) {
    assert(this.fd !== undefined, "Journal closed");
    assert(
      !Object.keys(value).some((k) =>
        ["password", "access_token", "serviceKey", "authorization"].includes(k),
      ),
      "Secret field prohibited",
    );
    const { hash: _h, seq: _s, previous: _p, ...data } = value;
    void _h;
    void _s;
    void _p;
    const e = {
      ...data,
      seq: this.events.length,
      previous: this.events.at(-1)?.hash || "",
    };
    e.hash = sha(e);
    const fd = openSync(this.path, "a", 0o600);
    try {
      writeSync(fd, JSON.stringify(e) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.events.push(e);
    return e;
  }
  find(type, name) {
    return this.events.findLast((e) => e.type === type && e.name === name);
  }
  count(kind) {
    return this.events.filter((e) => e.type === "budget" && e.kind === kind)
      .length;
  }
  reserve(kind, max) {
    assert(this.count(kind) < max, "Budget exceeded: " + kind);
    this.append({ type: "budget", kind });
  }
  close() {
    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
      unlinkSync(this.lock);
    }
  }
}
