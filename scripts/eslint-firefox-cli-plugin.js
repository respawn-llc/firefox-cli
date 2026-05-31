import { builtinModules } from "node:module";
import { posix } from "node:path";

const nodeBuiltins = new Set(
  builtinModules.flatMap((name) =>
    name.startsWith("node:") ? [name, name.slice(5)] : [name, `node:${name}`],
  ),
);
const bunBuiltins = new Set(["bun", "bun:ffi", "bun:jsc", "bun:sqlite", "bun:test"]);
const workspacePackages = new Set([
  "@firefox-cli/cli",
  "@firefox-cli/extension",
  "@firefox-cli/native-host",
  "@firefox-cli/protocol",
  "@firefox-cli/test-support",
]);

export const firefoxCliArchitecture = {
  rules: {
    "no-mutable-exports": {
      meta: {
        type: "problem",
        docs: { description: "Disallow exported mutable bindings." },
        messages: {
          mutableExport:
            "Do not export mutable bindings. Export constants, functions, classes, or immutable factories.",
        },
        schema: [],
      },
      create(context) {
        const mutableBindings = new Set();
        const namedExports = [];
        return {
          VariableDeclaration(node) {
            if (node.kind !== "const" && node.parent.type === "Program") {
              for (const declaration of node.declarations) collectNames(declaration.id, mutableBindings);
            }
          },
          ExportNamedDeclaration(node) {
            if (node.declaration?.type === "VariableDeclaration" && node.declaration.kind !== "const") {
              context.report({ node, messageId: "mutableExport" });
            }
            if (node.source === null && node.declaration === null) {
              for (const specifier of node.specifiers) {
                if (specifier.type === "ExportSpecifier") namedExports.push(specifier);
              }
            }
          },
          "Program:exit"() {
            for (const specifier of namedExports) {
              if (mutableBindings.has(specifierName(specifier.local))) {
                context.report({ node: specifier, messageId: "mutableExport" });
              }
            }
          },
        };
      },
    },
    "no-firefox-platform-outside-extension": {
      meta: {
        type: "problem",
        docs: { description: "Keep WebExtension browser/chrome API access inside the extension package." },
        messages: {
          platformOutsideExtension:
            "Firefox WebExtension APIs belong inside packages/extension/src boundary adapters.",
        },
        schema: [],
      },
      create(context) {
        if (isExtensionSource(context.filename ?? context.getFilename())) return {};
        return {
          MemberExpression(node) {
            if (
              node.object.type === "Identifier" &&
              (node.object.name === "browser" || node.object.name === "chrome")
            ) {
              const scope = context.sourceCode.getScope(node);
              if (!hasLocalBinding(scope, node.object.name)) {
                context.report({ node, messageId: "platformOutsideExtension" });
              }
            }
          },
        };
      },
    },
    "no-node-builtins-in-extension-runtime": {
      meta: {
        type: "problem",
        docs: { description: "Disallow Node/Bun builtins in Firefox extension runtime source." },
        messages: {
          nodeBuiltinInExtension:
            "Node/Bun runtime APIs are not available in Firefox extension runtime source.",
        },
        schema: [],
      },
      create(context) {
        if (!isExtensionRuntime(context.filename ?? context.getFilename())) return {};
        const reportIfBuiltin = (node, source) => {
          if (isNodeOrBunBuiltin(source)) context.report({ node, messageId: "nodeBuiltinInExtension" });
        };
        const checkStaticSource = (node) => reportIfBuiltin(node, node.source?.value);
        return {
          ImportDeclaration: checkStaticSource,
          ExportAllDeclaration: checkStaticSource,
          ExportNamedDeclaration: checkStaticSource,
          ImportExpression(node) {
            reportIfBuiltin(node, node.source.type === "Literal" ? node.source.value : undefined);
          },
          CallExpression(node) {
            if (node.callee.type === "Identifier" && node.callee.name === "require") {
              const [source] = node.arguments;
              reportIfBuiltin(node, source?.type === "Literal" ? source.value : undefined);
            }
          },
        };
      },
    },
    "no-package-boundary-violations": {
      meta: {
        type: "problem",
        docs: { description: "Disallow package imports that violate firefox-cli ownership boundaries." },
        messages: {
          packageBoundary:
            "Respect firefox-cli package ownership boundaries; import public workspace packages instead of crossing into another package internals.",
        },
        schema: [],
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        const currentPackage = packageForFile(filename);
        const check = (node) => {
          if (violatesBoundary(currentPackage, filename, node.source?.value))
            context.report({ node, messageId: "packageBoundary" });
        };
        return { ImportDeclaration: check, ExportAllDeclaration: check, ExportNamedDeclaration: check };
      },
    },
  },
};

function collectNames(pattern, names) {
  if (pattern.type === "Identifier") {
    names.add(pattern.name);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) if (element !== null) collectNames(element, names);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      collectNames(property.type === "RestElement" ? property.argument : property.value, names);
    }
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    collectNames(pattern.left, names);
    return;
  }
  if (pattern.type === "RestElement") collectNames(pattern.argument, names);
}
function specifierName(specifier) {
  return specifier.type === "Identifier" ? specifier.name : String(specifier.value);
}
function hasLocalBinding(scope, name) {
  for (let current = scope; current !== null; current = current.upper) {
    if (current.variables.some((variable) => variable.name === name)) return true;
  }
  return false;
}
function normalized(path) {
  return path.split("\\").join("/");
}
function isExtensionSource(file) {
  return normalized(file).includes("/packages/extension/src/");
}
function isExtensionRuntime(file) {
  const path = normalized(file);
  return (
    path.includes("/packages/extension/src/") &&
    !path.endsWith(".test.ts") &&
    !path.endsWith(".test.tsx") &&
    !path.endsWith(".d.ts")
  );
}
function isNodeOrBunBuiltin(source) {
  return typeof source === "string" && (nodeBuiltins.has(source) || bunBuiltins.has(source));
}
function packageForFile(file) {
  const match = /(?:^|\/)packages\/([^/]+)\//.exec(normalized(file));
  return match ? `@firefox-cli/${match[1]}` : undefined;
}
function violatesBoundary(currentPackage, filename, importValue) {
  if (typeof importValue !== "string") return false;

  const importedPackage = /^@firefox-cli\/[^/]+/.exec(importValue)?.[0];
  if (importedPackage !== undefined && workspacePackages.has(importedPackage)) {
    if (importValue.slice(importedPackage.length).startsWith("/")) return true;
    return violatesPackageOwnership(currentPackage, importedPackage);
  }

  const resolvedImport = importValue.startsWith(".")
    ? normalized(posix.normalize(posix.join(posix.dirname(normalized(filename)), importValue)))
    : normalized(importValue);
  const deepPackage = packageForFile(resolvedImport);
  if (deepPackage !== undefined && resolvedImport.includes("/src/") && deepPackage !== currentPackage) {
    return true;
  }

  return false;
}
function violatesPackageOwnership(currentPackage, importedPackage) {
  if (currentPackage === "@firefox-cli/protocol") return importedPackage !== "@firefox-cli/protocol";
  if (currentPackage === "@firefox-cli/extension")
    return importedPackage === "@firefox-cli/cli" || importedPackage === "@firefox-cli/native-host";
  if (currentPackage === "@firefox-cli/native-host")
    return importedPackage === "@firefox-cli/cli" || importedPackage === "@firefox-cli/extension";
  if (currentPackage === "@firefox-cli/cli") return importedPackage === "@firefox-cli/extension";
  return false;
}
