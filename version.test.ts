import { expect, test } from "bun:test"
import { forkVersion } from "./version"

test("fork revisions preserve upstream identity without colliding with its next patch", () => {
  expect(forkVersion("0.1.2-rc.1", "1")).toBe("0.1.2-rc.1.nyssance.1")
  expect(forkVersion("1.2.3", "2")).toBe("1.2.3-nyssance.2")
})
test("invalid exact versions and revisions are rejected", () => {
  for (const version of ["01.2.3", "1.2.3-01", "1.2.3-rc_1", "1.2.3-", "1.2.3+metadata", "1.2.3; touch x"]) {
    expect(() => forkVersion(version, "1")).toThrow()
  }
  for (const revision of ["0", "01", "-1", "1.5", "1; touch x", "9007199254740992"]) {
    expect(() => forkVersion("1.2.3", revision)).toThrow()
  }
})
