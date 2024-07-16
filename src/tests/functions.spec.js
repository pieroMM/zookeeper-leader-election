const { describe, it } = require("node:test");
const  assert = require("assert");
const { extractId, isValidChildrenPrefix, isValidZNodeName } = require("../zookeeper-leader-election.cjs");

describe("test extract id function", () => {
    it("extract numeric id from a child path", () => {
        assert.strictEqual(extractId("guid-n_000001"), 1);
    });
    it("extract numeric id from a full path", () => {
        assert.strictEqual(extractId("/ELECTION/guid-n_000001"), 1);
    });
    it("return NaN whether input path is invalid or has no numeric suffix", () => {
        assert.strictEqual(extractId("ELECTION/guid-n_000001"), NaN);
        assert.strictEqual(extractId("ELECTION:guid-n_000001"), NaN);
        assert.strictEqual(extractId("qwerty"), NaN);
        assert.strictEqual(extractId("guid-n_00000000n"), NaN);
    });

    it("return NaN whether input path has wrong format", () => {
        assert.strictEqual(extractId("ELECTION/guid-n_000000001"), NaN);
        assert.strictEqual(extractId("ELECTION:guid-n_000000001"), NaN);
    });
})

describe("test isValidZNodeName", () => {
    it("valid zNodeNames", () => {
        assert.strictEqual(isValidZNodeName("/ELECTION"), true);
        assert.strictEqual(isValidZNodeName("/leader-election"), true);
        assert.strictEqual(isValidZNodeName("/LEADER_ELECTION"), true);
    });

    it("invalid zNodeNames", () => {
        assert.strictEqual(isValidZNodeName("ELECTION"), false);
        assert.strictEqual(isValidZNodeName("leader-election"), false);
        assert.strictEqual(isValidZNodeName("LEADER_ELECTION"), false);
        assert.strictEqual(isValidZNodeName("/leader:election"), false);
    });
});

describe("test isValidChildrenPrefix", () => {
    it("valid childrenPrefixes", () => {
        assert.strictEqual(isValidChildrenPrefix("guid-n_"), true);
        assert.strictEqual(isValidChildrenPrefix("children"), true);
        assert.strictEqual(isValidChildrenPrefix("childNode"), true);
    });

    it("invalid childrenPrefixes", () => {
        assert.strictEqual(isValidChildrenPrefix("/guid-n_"), false);
        assert.strictEqual(isValidChildrenPrefix(":guid-n_"), false);
        assert.strictEqual(isValidChildrenPrefix("$child_"), false);
        assert.strictEqual(isValidChildrenPrefix("child_#"), false);
    });
});
