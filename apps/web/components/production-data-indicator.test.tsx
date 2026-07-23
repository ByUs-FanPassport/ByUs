import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  isLocalProductionData,
  ProductionDataIndicator,
} from "./production-data-indicator";

describe("ProductionDataIndicator", () => {
  it("shows a persistent warning only for localhost connected to Production data", () => {
    expect(isLocalProductionData("http://localhost:3000", "production")).toBe(true);
    expect(isLocalProductionData("https://byus.kr", "production")).toBe(false);
    expect(isLocalProductionData("http://localhost:3000", "development")).toBe(false);

    const { rerender } = render(<ProductionDataIndicator visible />);
    expect(screen.getByRole("status", {
      name: "Localhost is connected to Production data",
    })).toHaveTextContent("PROD DATA");

    rerender(<ProductionDataIndicator visible={false} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
