import { commandSchemas, getCliRoutes } from "@firefox-cli/protocol";
import { describe, expect, it } from "vitest";
import { routeParserSpecs, type CliRouteParserRouteId } from "./argv-contracts.js";
import { cliRouteBindings, renderHelp } from "./index.js";
import { cliRouteWantsJsonOutput, findCliRouteBindingForArgv } from "./route-registry.js";

describe("CLI route registry", () => {
  it("binds every protocol CLI route exactly once", () => {
    const protocolRoutes = getCliRoutes();
    const bindingEntries = Object.entries(cliRouteBindings);

    expect(bindingEntries).toHaveLength(protocolRoutes.length);
    expect(new Set(bindingEntries.map(([, binding]) => binding.route.id)).size).toBe(
      protocolRoutes.length,
    );

    for (const route of protocolRoutes) {
      const matches = bindingEntries.filter(([, binding]) => binding.route.id === route.id);
      expect(matches, `Missing or duplicate CLI binding for ${route.id}`).toHaveLength(1);
      expect(matches[0]?.[0]).toBe(route.id);
      expect(matches[0]?.[1].help.length).toBeGreaterThan(0);
      expect(matches[0]?.[1].parser).toBe(routeParserSpecs[route.id as CliRouteParserRouteId]);
      expect(matches[0]?.[1].formatter).toBeDefined();
    }
  });

  it("keeps CLI route bindings aligned with protocol metadata", () => {
    for (const [routeId, binding] of Object.entries(cliRouteBindings)) {
      const protocolRoute = getCliRoutes().find((route) => route.id === routeId);
      expect(protocolRoute, `Unknown bound protocol route ${routeId}`).toBeDefined();
      expect(binding.route).toEqual(protocolRoute);
      expect(commandSchemas[binding.command].cliRoutes.some((route) => route.id === routeId)).toBe(
        true,
      );
    }
  });

  it("classifies JSON output through route parser metadata", () => {
    const cases: readonly { readonly argv: readonly string[]; readonly json: boolean }[] = [
      { argv: ["tab", "--json"], json: true },
      { argv: ["fill", "#token", "--json"], json: false },
      { argv: ["fill", "#token", "value", "--json"], json: true },
      { argv: ["keyboard", "type", "--json"], json: false },
      { argv: ["keyboard", "type", "value", "--json"], json: true },
      { argv: ["select", "#plan", "--json"], json: false },
      { argv: ["select", "#plan", "pro", "--json"], json: true },
      { argv: ["wait", "--download", "--json"], json: true },
    ];

    for (const testCase of cases) {
      const binding = findCliRouteBindingForArgv(testCase.argv);
      expect(binding, testCase.argv.join(" ")).toBeDefined();
      expect(cliRouteWantsJsonOutput(binding as NonNullable<typeof binding>, testCase.argv)).toBe(
        testCase.json,
      );
    }
  });

  it("renders protocol route help from CLI route bindings", () => {
    const help = renderHelp();

    for (const binding of Object.values(cliRouteBindings)) {
      expect(help).toContain(`  ${binding.help}`);
    }
  });
});
