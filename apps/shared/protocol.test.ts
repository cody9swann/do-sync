import { describe, expect, it } from "vitest"
import { slugifyChannelName } from "./protocol"

describe("slugifyChannelName", () => {
  it("normalizes channel names for stable ids", () => {
    expect(slugifyChannelName("  New Biz!!  ")).toBe("new-biz")
    expect(slugifyChannelName("Release   Notes")).toBe("release-notes")
  })

  it("drops unsupported characters and trims separators", () => {
    expect(slugifyChannelName("@@@General###")).toBe("general")
    expect(slugifyChannelName("---")).toBe("")
  })

  it("caps generated ids at 48 characters", () => {
    expect(slugifyChannelName("a".repeat(80))).toHaveLength(48)
  })
})
