import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button";

describe("buttonVariants", () => {
  // Links styled as buttons use this string directly, with no component to merge classes for them.
  it("lets a variant's border colour replace the base transparent border", () => {
    const classes = buttonVariants({ variant: "outline" }).split(" ");
    expect(classes).toContain("border-border-strong");
    expect(classes).not.toContain("border-transparent");
  });

  it("keeps the transparent border for variants that have no border of their own", () => {
    expect(buttonVariants({ variant: "default" }).split(" ")).toContain("border-transparent");
  });

  it("lets a caller's class win over the variant's", () => {
    expect(buttonVariants({ variant: "outline", className: "mt-3 h-10" }).split(" ")).toEqual(expect.arrayContaining(["mt-3", "h-10"]));
    expect(buttonVariants({ size: "sm", className: "h-10" }).split(" ")).not.toContain("h-7");
  });
});
