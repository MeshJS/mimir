import { spawnSync } from "node:child_process";
import { calculateChecksum } from "../utils/calculateChecksum";

export type PythonEntityType = "function" | "class" | "method" | "variable" | "module";

export interface PythonEntity {
    /** Type of the entity */
    entityType: PythonEntityType;
    /** Name of the entity (for module, usually the filename without extension) */
    name: string;
    /** Fully qualified name (e.g., "module.ClassName.method_name") */
    qualifiedName: string;
    /** The extracted code snippet */
    code: string;
    /** Parent class name if this is a method */
    parentContext?: string;
    /** Start line number (1-based) */
    startLine: number;
    /** End line number (1-based) */
    endLine: number;
    /** SHA-256 checksum of the code */
    checksum: string;
    /** Whether the entity is exported (Python has no explicit exports; this is always false for now) */
    isExported: boolean;
    /** Docstring if present */
    docstring?: string;
    /** Function/method parameters as string */
    parameters?: string;
    /** Return type annotation as string */
    returnType?: string;
}

export interface ParsedPythonFile {
    /** File path */
    filepath: string;
    /** All extracted entities */
    entities: PythonEntity[];
    /** Import statements in the file */
    imports: string[];
    /** Module-level docstring */
    moduleDoc?: string;
}

interface PythonAstEntity {
    kind: "function" | "class" | "method" | "variable";
    name: string;
    parent?: string;
    startLine: number;
    endLine: number;
    docstring?: string;
    parameters?: string;
    returnType?: string;
}

interface PythonAstResult {
    imports: string[];
    moduleDoc?: string;
    entities: PythonAstEntity[];
}

const PYTHON_AST_SCRIPT = String.raw`
import ast
import inspect
import json
import sys

def get_parameters_str(node: ast.AST) -> str:
    if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        return ""
    params = []
    args = node.args

    def fmt_arg(a):
        name = a.arg
        if a.annotation is not None:
            name += ": " + ast.unparse(a.annotation)
        return name

    for a in args.posonlyargs:
        params.append(fmt_arg(a))
    if args.posonlyargs:
        params.append("/")
    for a in args.args:
        params.append(fmt_arg(a))
    if args.vararg:
        params.append("*" + args.vararg.arg)
    elif args.kwonlyargs:
        params.append("*")
    for a in args.kwonlyargs:
        params.append(fmt_arg(a))
    if args.kwarg:
        params.append("**" + args.kwarg.arg)

    return "(" + ", ".join(params) + ")"

def main() -> None:
    if len(sys.argv) < 2:
        print("{}", end="")
        return

    filepath = sys.argv[1]
    source = sys.stdin.read()

    try:
        tree = ast.parse(source, filename=filepath)
    except SyntaxError:
        print("{}", end="")
        return

    result = {
        "imports": [],
        "moduleDoc": ast.get_docstring(tree),
        "entities": [],
    }

    # Collect imports and top-level entities
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            seg = ast.get_source_segment(source, node)
            if seg is None:
                seg = ast.unparse(node)
            result["imports"].append(seg)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            entity = {
                "kind": "function",
                "name": node.name,
                "startLine": node.lineno,
                "endLine": node.end_lineno or node.lineno,
                "docstring": ast.get_docstring(node),
                "parameters": get_parameters_str(node),
                "returnType": ast.unparse(node.returns) if node.returns is not None else None,
            }
            result["entities"].append(entity)
        elif isinstance(node, ast.ClassDef):
            class_entity = {
                "kind": "class",
                "name": node.name,
                "startLine": node.lineno,
                "endLine": node.end_lineno or node.lineno,
                "docstring": ast.get_docstring(node),
            }
            result["entities"].append(class_entity)

            # Methods inside the class
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    method_entity = {
                        "kind": "method",
                        "name": item.name,
                        "parent": node.name,
                        "startLine": item.lineno,
                        "endLine": item.end_lineno or item.lineno,
                        "docstring": ast.get_docstring(item),
                        "parameters": get_parameters_str(item),
                        "returnType": ast.unparse(item.returns) if item.returns is not None else None,
                    }
                    result["entities"].append(method_entity)

    print(json.dumps(result), end="")

if __name__ == "__main__":
    main()
`;

export function parsePythonFile(
    filepath: string,
    content: string,
): ParsedPythonFile {
    const filename = filepath.split(/[\\/]/).pop() ?? filepath;
    const moduleName = filename.replace(/\.py$/i, "");

    const astResult = runPythonAstAnalysis(filepath, content);

    const entities: PythonEntity[] = [];

    // Add a module-level entity for overall context
    if (content.trim().length > 0) {
        entities.push({
            entityType: "module",
            name: moduleName,
            qualifiedName: moduleName,
            code: content,
            parentContext: undefined,
            startLine: 1,
            endLine: content.split("\n").length,
            checksum: calculateChecksum(content),
            isExported: false,
            docstring: astResult.moduleDoc,
        });
    }

    for (const e of astResult.entities) {
        const qualifiedName = e.parent
            ? `${moduleName}.${e.parent}.${e.name}`
            : `${moduleName}.${e.name}`;

        const lines = content.split("\n").slice(e.startLine - 1, e.endLine);
        const code = lines.join("\n");

        entities.push({
            entityType: e.kind,
            name: e.name,
            qualifiedName,
            code,
            parentContext: e.parent,
            startLine: e.startLine,
            endLine: e.endLine,
            checksum: calculateChecksum(code),
             isExported: false,
            docstring: e.docstring,
            parameters: e.parameters,
            returnType: e.returnType,
        });
    }

    return {
        filepath,
        entities,
        imports: astResult.imports,
        moduleDoc: astResult.moduleDoc,
    };
}

function runPythonAstAnalysis(filepath: string, content: string): PythonAstResult {
    const proc = spawnSync("python3", ["-c", PYTHON_AST_SCRIPT, filepath], {
        input: content,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
    });

    if (proc.error) {
        throw proc.error;
    }
    if (proc.status !== 0) {
        // Fallback: return empty result if parsing fails
        return { imports: [], moduleDoc: undefined, entities: [] };
    }

    const stdout = proc.stdout?.toString() ?? "";
    if (!stdout.trim()) {
        return { imports: [], moduleDoc: undefined, entities: [] };
    }

    try {
        const parsed = JSON.parse(stdout) as PythonAstResult;
        // Normalize to expected shapes
        parsed.imports = parsed.imports ?? [];
        parsed.entities = parsed.entities ?? [];
        return parsed;
    } catch {
        return { imports: [], moduleDoc: undefined, entities: [] };
    }
}

