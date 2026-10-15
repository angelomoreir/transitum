import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renderiza texto", () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeInTheDocument();
  });

  it("fica desativado", () => {
    render(<Button disabled>Guardar</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
